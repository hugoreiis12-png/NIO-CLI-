/**
 * `DaxGenerator` apoiado no Qwen local — traduz pergunta em DAX. Duas partes:
 * montagem do prompt e extração do DAX (**puras, testáveis**) + um invólucro fino de IO
 * que converte as exceções do `qwenComplete` no contrato nunca-lança do `RagResult`.
 *
 * O system prompt carrega os limites que **verificamos** na API, pra o modelo parar de
 * repetir os erros que vimos em produção: `EVALUATE` exigindo expressão de tabela e
 * `SELECT…FROM $System` (DMV) não existir no `executeQueries`.
 */
import type { RagResult } from '../core/rag.js';
import type { DaxGenerator, GenerateRequest } from './dax-rag.js';
import { qwenComplete } from '../lib/exec/qwen-client.js';

/** Regras derivadas dos limites reais do endpoint — não de suposição. */
const SYSTEM = [
  'Você escreve consultas DAX para a API executeQueries do Power BI/Fabric.',
  'Responda APENAS com a consulta DAX, sem explicação, sem markdown, sem comentários.',
  '',
  'Regras obrigatórias do endpoint:',
  '- Só DAX. `SELECT ... FROM $System...` (DMV/XMLA) NÃO funciona aqui e retorna 400.',
  '- `EVALUATE` exige uma expressão de TABELA. Um escalar precisa ser embrulhado:',
  '  errado: `EVALUATE COUNTROWS(\'Vendas\')`',
  '  certo:  `EVALUATE ROW("Linhas", COUNTROWS(\'Vendas\'))`',
  '- Uma única consulta por chamada, retornando UMA tabela.',
  '- Teto de 100k linhas: use TOPN/SUMMARIZECOLUMNS em vez de varrer a tabela inteira.',
  '- Para listar metadados do modelo use as funções INFO (ex.: `EVALUATE INFO.TABLES()`).',
].join('\n');

/** Instrução do Nível 1: adaptar um DAX validado, preservando a estrutura que funciona. */
function adaptSection(template: { dax: string; questionNorm: string }): string {
  return [
    'Uma consulta parecida JÁ FOI VALIDADA neste mesmo modelo semântico:',
    `pergunta anterior: ${template.questionNorm}`,
    'DAX que funcionou:',
    template.dax,
    '',
    'Adapte esse DAX para a nova pergunta, mudando SOMENTE o que ela exige',
    '(métrica, dimensão, período, filtros). Preserve a estrutura e os nomes que já funcionam.',
    'Se a nova pergunta pedir algo que esse DAX não cobre, escreva uma consulta nova.',
  ].join('\n');
}

/** Monta o prompt do usuário. Puro — a ordem das seções é o contrato testado. */
export function buildDaxPrompt(req: GenerateRequest): string {
  const parts: string[] = [];
  if (req.docs?.length) {
    parts.push('Documentação relevante:', req.docs.join('\n---\n'), '');
  }
  if (req.template) {
    parts.push(adaptSection(req.template), '');
  }
  if (req.previousError) {
    parts.push(
      'A tentativa anterior FALHOU com este erro do Power BI — corrija a causa:',
      req.previousError,
      '',
    );
  }
  parts.push(`Pergunta: ${req.question}`);
  return parts.join('\n');
}

/** Tira cercas markdown e rótulos que o modelo às vezes adiciona. Puro. */
export function extractDax(raw: string): string {
  const fenced = raw.match(/```(?:dax)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  return body.replace(/^(?:dax|consulta|query)\s*:\s*/i, '').trim();
}

/**
 * Gerador de produção. `qwenComplete` **lança** (QwenError) — aqui isso vira
 * `RagResult`, porque o orquestrador depende do contrato nunca-lança.
 */
export function createDaxGenerator(complete = qwenComplete): DaxGenerator {
  return async (req: GenerateRequest): Promise<RagResult<string>> => {
    try {
      const text = await complete(buildDaxPrompt(req), { system: SYSTEM });
      const dax = extractDax(text);
      if (!dax) return { status: 'failed', error: 'modelo devolveu resposta vazia' };
      return { status: 'ok', data: dax };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const offline = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|abort/i.test(message);
      return { status: offline ? 'unavailable' : 'failed', error: message };
    }
  };
}
