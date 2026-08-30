import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSkillDocs } from './skills.js';

/**
 * Patterns do harness — a parte que **precisa de IA**. O CLI não raciocina sobre o
 * código, então dispara um agente **headless** (`claude -p` / `codex exec`), com
 * consentimento, pra analisar o repo e escrever `docs/_patterns.md`. Best-effort.
 */

export const PATTERNS_REL = 'docs/_patterns.md';

export function patternsPath(cwd: string): string {
  return join(cwd, PATTERNS_REL);
}

export function patternsExist(cwd: string): boolean {
  return existsSync(patternsPath(cwd));
}

/** Prompt da análise: corpo da skill `detect-patterns` (fonte única) ou fallback embutido. */
const FALLBACK_PROMPT = `Analise ESTE repositório e escreva \`${PATTERNS_REL}\` (arquivo único, sobrescreva se existir) com os PADRÕES REAIS já usados no código: estrutura de pastas/camadas, convenções de naming, stack/libs e como são usadas, e padrões de estado/dados/erros/testes. Baseie-se SÓ no que existe — não invente nem recomende. Seja conciso (poucas dezenas de linhas): é contexto pra outros agentes, não pode inflar. Não toque em nenhum outro arquivo.`;

function analysisPrompt(): string {
  try {
    const doc = readSkillDocs().find((d) => d.id === 'detect-patterns' && d.type === 'skill');
    if (doc?.content.trim()) return doc.content.trim();
  } catch {
    /* skill ausente do cache → fallback */
  }
  return FALLBACK_PROMPT;
}

/** Existe um binário no PATH (via `--version`)? */
function hasBin(bin: string): boolean {
  try {
    const r = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    return !r.error;
  } catch {
    return false;
  }
}

export interface AnalysisOutcome {
  ran: boolean;
  ok?: boolean;
  agent?: 'claude' | 'codex';
  reason?: string;
}

/**
 * Roda a análise de patterns headless no `cwd`. Prefere `claude`, cai pro `codex`;
 * sem nenhum no PATH, não roda (retorna `ran:false`). Nunca lança.
 */
export function runPatternsAnalysis(cwd: string): AnalysisOutcome {
  const prompt = analysisPrompt();

  // stdin ignorado (o prompt vai por arg) — evita o agente ficar esperando stdin.
  const stdio: ['ignore', 'inherit', 'inherit'] = ['ignore', 'inherit', 'inherit'];

  if (hasBin('claude')) {
    const r = spawnSync('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], {
      cwd,
      stdio,
    });
    return { ran: true, ok: !r.error && r.status === 0, agent: 'claude' };
  }
  if (hasBin('codex')) {
    const r = spawnSync('codex', ['exec', prompt], { cwd, stdio });
    return { ran: true, ok: !r.error && r.status === 0, agent: 'codex' };
  }
  return { ran: false, reason: 'sem `claude` nem `codex` no PATH pra rodar a análise' };
}
