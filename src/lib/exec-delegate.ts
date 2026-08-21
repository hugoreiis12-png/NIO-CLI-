import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { skillsDir } from './skills.js';
import { homePath } from '../brand.js';
import { HARNESS_RULES_REL, HARNESS_PATTERNS_REL } from './harness.js';
import {
  DEFAULT_ENGINE,
  engineArgs,
  engineMissingError,
  resolveEngineBin,
  type Engine,
} from './exec-engines.js';

/**
 * Delegação de execução: roda o agente local escolhido (assinatura, sem API) num worktree já
 * criado pelo `/implement` e **mede** o resultado (tamanho + lint/build/testes). O
 * julgamento fica com o Opus — este módulo só executa e reporta fatos.
 */

export type JobState = 'running' | 'done' | 'failed';

export interface CheckResult {
  ok: boolean;
  output: string;
}

export interface ExecJob {
  id: string;
  state: JobState;
  worktree: string;
  engine: Engine;
  exitCode: number | null;
  summary: string;
  checks: Record<string, CheckResult>;
  changed: string[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const jobs = new Map<string, ExecJob>();

function jobsDir(): string {
  return homePath('exec-jobs');
}

function jobPath(id: string): string {
  return join(jobsDir(), `${id}.json`);
}

/** Persiste o job — o servidor MCP pode reiniciar entre chamadas. */
function save(job: ExecJob): ExecJob {
  jobs.set(job.id, job);
  try {
    mkdirSync(jobsDir(), { recursive: true });
    writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + '\n', 'utf8');
  } catch {
    /* best-effort */
  }
  return job;
}

export function getJob(id: string): ExecJob | null {
  const mem = jobs.get(id);
  if (mem) return mem;
  try {
    return JSON.parse(readFileSync(jobPath(id), 'utf8')) as ExecJob;
  } catch {
    return null;
  }
}

/** Preâmbulo que ancora o agente de execução no harness do repo. */
function buildPrompt(instruction: string): string {
  return [
    'Implemente a tarefa abaixo NESTE worktree.',
    `Antes de codar: leia AGENTS.md, ${HARNESS_RULES_REL} e ${HARNESS_PATTERNS_REL} e SIGA-OS.`,
    'Regras: mudança mínima; nada de libs/estilos fora do harness.',
    'Limites: arquivo <300 linhas, função <30 linhas, comentário <=1 linha.',
    'Rode lint/build/testes do repo. NÃO commite — deixe o trabalho staged.',
    '',
    instruction,
  ].join('\n');
}

/** Roda o hook de tamanho (mesma lógica do commit) sobre o que está staged. */
function checkSize(worktree: string): CheckResult {
  let script: string;
  try {
    script = join(skillsDir(), 'hooks', 'dev', 'check-code-size.py');
  } catch {
    return { ok: true, output: 'skills indisponíveis — check pulado' };
  }
  if (!existsSync(script)) return { ok: true, output: 'check-code-size ausente — pulado' };

  spawnSync('git', ['add', '-A'], { cwd: worktree, stdio: 'ignore' });
  const r = spawnSync('python3', [script], {
    cwd: worktree,
    input: JSON.stringify({ tool_input: { command: 'git commit' } }),
    encoding: 'utf8',
  });
  if (r.error) return { ok: true, output: 'python3 ausente — pulado' };
  return { ok: r.status === 0, output: (r.stderr || '').trim() || 'ok' };
}

/** Scripts de qualidade que existem no package.json. */
function npmScripts(worktree: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(worktree, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return ['lint', 'build', 'test'].filter((s) => pkg.scripts?.[s]);
  } catch {
    return [];
  }
}

function runScript(worktree: string, script: string): CheckResult {
  const r = spawnSync('npm', ['run', script, '--silent'], { cwd: worktree, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: !r.error && r.status === 0, output: out.slice(-1500) || 'ok' };
}

function changedFiles(worktree: string): string[] {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' });
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

/** Checks determinísticos — sem LLM, pra o Opus não gastar ciclo com o mecânico. */
function runChecks(worktree: string): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = { size: checkSize(worktree) };
  for (const s of npmScripts(worktree)) checks[s] = runScript(worktree, s);
  return checks;
}

function finish(job: ExecJob): ExecJob {
  return save({ ...job, finishedAt: new Date().toISOString() });
}

interface SpawnOpts {
  echo?: boolean;
  onDone?: (job: ExecJob) => void;
}

function spawnEngine(job: ExecJob, bin: string, prompt: string, opts: SpawnOpts = {}): void {
  const child = spawn(bin, engineArgs(job.engine, prompt), {
    cwd: job.worktree,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  const collect = (d: Buffer): void => {
    const s = d.toString();
    out += s;
    if (opts.echo) process.stderr.write(s); // stdout fica pro JSON final
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  child.on('error', (e) => opts.onDone?.(finish({ ...job, state: 'failed', error: e.message })));
  child.on('close', (code) =>
    opts.onDone?.(
      finish({
        ...job,
        state: code === 0 ? 'done' : 'failed',
        exitCode: code,
        summary: out.trim().slice(-2000),
        checks: runChecks(job.worktree),
        changed: changedFiles(job.worktree),
      }),
    ),
  );
}

function newJob(worktree: string, engine: Engine): ExecJob {
  return {
    id: randomUUID().slice(0, 8),
    state: 'running',
    worktree,
    engine,
    exitCode: null,
    summary: '',
    checks: {},
    changed: [],
    startedAt: new Date().toISOString(),
  };
}

/** Prepara o job: resolve o binário e persiste. Devolve o job já falho se não achar. */
function prepare(worktree: string, engine: Engine): { job: ExecJob; bin: string } | ExecJob {
  const job = newJob(worktree, engine);
  const bin = resolveEngineBin(engine);
  if (!bin) {
    return finish({ ...job, state: 'failed', error: engineMissingError(engine) });
  }
  return { job, bin: save(job) && bin };
}

/** Background: devolve na hora (uso do MCP, que é processo longo). */
export function startExec(opts: {
  worktree: string;
  instruction: string;
  engine?: Engine;
}): ExecJob {
  const p = prepare(opts.worktree, opts.engine ?? DEFAULT_ENGINE);
  if ('state' in p) return p;
  spawnEngine(p.job, p.bin, buildPrompt(opts.instruction), { onDone: () => undefined });
  return p.job;
}

/** Bloqueante: aguarda o fim (uso do CLI, que é processo curto). `echo` streama pro stderr. */
export function runExec(opts: {
  worktree: string;
  instruction: string;
  engine?: Engine;
  echo?: boolean;
}): Promise<ExecJob> {
  return new Promise((resolve) => {
    const p = prepare(opts.worktree, opts.engine ?? DEFAULT_ENGINE);
    if ('state' in p) return resolve(p);
    spawnEngine(p.job, p.bin, buildPrompt(opts.instruction), { echo: opts.echo, onDone: resolve });
  });
}
