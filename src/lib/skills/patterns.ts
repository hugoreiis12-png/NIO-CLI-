import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSkillDocs } from './skills.js';
import { stripFence } from '../exec/plan-delegate.js';
import { QWEN_ENGINE, qwenComplete } from '../exec/qwen-client.js';

/**
 * Patterns do harness — a parte que **precisa de IA**. O CLI não raciocina sobre o
 * código, então dispara o **Qwen vLLM local** (API direta, sem binário externo), com
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
const FALLBACK_PROMPT = `Analise ESTE repositório e produza o conteúdo de \`${PATTERNS_REL}\` (arquivo único) com os PADRÕES REAIS já usados no código: estrutura de pastas/camadas, convenções de naming, stack/libs e como são usadas, e padrões de estado/dados/erros/testes. Baseie-se SÓ no que existe — não invente nem recomende. Seja conciso (poucas dezenas de linhas): é contexto pra outros agentes, não pode inflar. Você NÃO tem acesso ao filesystem: devolva APENAS o markdown final do arquivo, sem cercas de código e sem comentários — quem chama gravará o arquivo.`;

function analysisPrompt(): string {
  try {
    const doc = readSkillDocs().find((d) => d.id === 'detect-patterns' && d.type === 'skill');
    if (doc?.content.trim()) return doc.content.trim();
  } catch {
    /* skill ausente do cache → fallback */
  }
  return FALLBACK_PROMPT;
}

export interface AnalysisOutcome {
  ran: boolean;
  ok?: boolean;
  agent?: string;
  reason?: string;
}

/**
 * Roda a análise de patterns headless no `cwd` via Qwen. Nunca lança — falha do
 * engine vira `ran:true, ok:false` e o caller desenha.
 */
export async function runPatternsAnalysis(cwd: string): Promise<AnalysisOutcome> {
  try {
    const text = await qwenComplete(analysisPrompt());
    const markdown = stripFence(text);
    if (!markdown) {
      return { ran: true, ok: false, agent: QWEN_ENGINE, reason: 'engine não devolveu markdown' };
    }
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(patternsPath(cwd), `${markdown}\n`, 'utf8');
    return { ran: true, ok: true, agent: QWEN_ENGINE };
  } catch (e) {
    return { ran: true, ok: false, agent: QWEN_ENGINE, reason: (e as Error).message };
  }
}