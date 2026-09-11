import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { skillsDir } from '../skills/skills.js';
import { homePath } from '../../brand.js';
import { HARNESS_RULES_REL, HARNESS_PATTERNS_REL } from '../clients/harness.js';
import {
  QWEN_ENGINE,
  qwenComplete,
  parseFileBlocks,
} from './qwen-client.js';

/**
 * Delegação de execução: roda o **Qwen vLLM local** (API direta, sem binário externo)
 * num worktree já criado pelo `/implement` e **mede** o resultado (tamanho + lint/build/testes).
 * O julgamento fica com o Opus — este módulo só executa e reporta fatos.
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
  engine: string;
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

/** Preâmbulo que ancora o Qwen no harness e pede os arquivos em blocos parseáveis. */
function buildPrompt(instruction: string): string {
  return [
    'Implemente a tarefa abaixo NESTE worktree (pastas e arquivos relativos à raiz do trabalho).',
    `Antes de codar: leia AGENTS.md, ${HARNESS_RULES_REL} e ${HARNESS_PATTERNS_REL} e SIGA-OS.`,
    'Regras: mudança mínima; nada de libs/estilos fora do harness.',
    'Limites: arquivo <300 linhas, função <30 linhas, comentário <=1 linha.',
    'Rode lint/build/testes do repo. NÃO commite — deixe o trabalho staged.',
    '',
    'Você NÃO tem acesso ao filesystem: devolva APENAS os arquivos a criar/alterar, cada um ' +
      'neste formato exato, nessa ordem (sem texto fora dos blocos, sem cercas de código):',
    '',
    '<<<FILE caminho/relativo.ext>>>',
    '<conteúdo completo do arquivo>',
    '<<<END_FILE>>>',
    '',
    'Se a tarefa não exigir código, responda com texto puro explicando o porquê.',
    '',
    '## Tarefa',
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

/** Caminho seguro dentro do worktree: recusa subir além da raiz. */
function resolveRel(worktree: string, rel: string): string {
  const dest = resolve(worktree, rel);
  if (dest !== worktree && !dest.startsWith(worktree + sep)) {
    throw new Error(`caminho fora do worktree: ${rel}`);
  }
  return dest;
}

/** Aplica os blocos `<<<FILE>>>` da resposta no worktree. Devolve os paths escritos. */
function applyBlocks(worktree: string, text: string): string[] {
  const blocks = parseFileBlocks(text);
  if (blocks.length === 0) {
    throw new Error('resposta sem blocos <<<FILE>>> — nada aplicado');
  }
  const written: string[] = [];
  for (const b of blocks) {
    const dest = resolveRel(worktree, b.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, b.content, 'utf8');
    written.push(b.path);
  }
  return written;
}

interface EngineOpts {
  echo?: boolean;
  onDone?: (job: ExecJob) => void;
}

async function runEngine(job: ExecJob, prompt: string, opts: EngineOpts = {}): Promise<ExecJob> {
  try {
    const text = await qwenComplete(prompt);
    if (opts.echo) process.stderr.write(text);
    applyBlocks(job.worktree, text);
    const done = finish({
      ...job,
      state: 'done',
      exitCode: 0,
      summary: text.trim().slice(-2000),
      checks: runChecks(job.worktree),
      changed: changedFiles(job.worktree),
    });
    opts.onDone?.(done);
    return done;
  } catch (e) {
    const failed = finish({
      ...job,
      state: 'failed',
      exitCode: 1,
      error: (e as Error).message,
    });
    opts.onDone?.(failed);
    return failed;
  }
}

function newJob(worktree: string): ExecJob {
  return {
    id: randomUUID().slice(0, 8),
    state: 'running',
    worktree,
    engine: QWEN_ENGINE,
    exitCode: null,
    summary: '',
    checks: {},
    changed: [],
    startedAt: new Date().toISOString(),
  };
}

/** Background: devolve na hora (uso do MCP, que é processo longo). */
export function startExec(opts: {
  worktree: string;
  instruction: string;
}): ExecJob {
  const job = save(newJob(opts.worktree));
  void runEngine(job, buildPrompt(opts.instruction));
  return job;
}

/** Bloqueante: aguarda o fim (uso do CLI, que é processo curto). `echo` streama pro stderr. */
export function runExec(opts: {
  worktree: string;
  instruction: string;
  echo?: boolean;
}): Promise<ExecJob> {
  const job = save(newJob(opts.worktree));
  return runEngine(job, buildPrompt(opts.instruction), { echo: opts.echo });
}