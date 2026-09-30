/**
 * Contador de resultado das consultas ao Fabric — a linha de base para saber se
 * uma correção no DAX gerado funcionou.
 *
 * Existe porque `agent_lesson` guarda lições agregadas, não tentativas: dava para
 * ver QUAIS erros acontecem, nunca em QUE proporção. Sem denominador não há
 * "de X% para Y%".
 *
 * **A métrica nunca pode derrubar uma consulta**: toda escrita é best-effort e
 * engolida. Falhar em medir é aceitável; falhar em responder não é.
 *
 * Não grava o DAX nem o texto do erro — só a categoria. Nomes de tabela e coluna
 * do negócio não precisam virar arquivo de telemetria.
 */
import { appendFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FabricStatus } from '../../core/fabric.js';

export type QueryOutcome =
  | 'ok'
  | 'column_not_found'
  | 'table_not_found'
  | 'type_mismatch'
  | 'syntax_error'
  | 'function_error'
  | 'other_dax_error'
  | 'unauthorized'
  | 'throttled'
  | 'unavailable';

export interface QueryMetric {
  ts: string;
  op: 'executeDax' | 'listWorkspaces' | 'listDatasets';
  outcome: QueryOutcome;
  ms: number;
  datasetId?: string;
}

/**
 * Padrões extraídos das mensagens reais em `agent_lesson` (2026-09-28), não da
 * documentação: o Power BI descreve o mesmo defeito de formas diferentes, e
 * coluna inexistente aparece em duas redações distintas.
 */
const DAX_PATTERNS: [RegExp, QueryOutcome][] = [
  // O nome vem envolto em `<oii>…</oii>` e às vezes há `in table '…'` no meio —
  // por isso nada de `[^']*` entre as aspas: as internas quebrariam o casamento.
  [
    /column .* cannot be found|either the column .* doesn'?t exist|the value for .* cannot be determined/i,
    'column_not_found',
  ],
  // Duas redações para nome inventado: `Cannot find table` e, medido ao vivo,
  // `Failed to resolve name '…'. It is not a valid table, variable, or function name.`
  [/cannot find table|failed to resolve name/i, 'table_not_found'],
  [/comparison operations do not support/i, 'type_mismatch'],
  [/the syntax for .* is incorrect/i, 'syntax_error'],
  [/the search text provided to function/i, 'function_error'],
];

/**
 * Categoria do resultado. Classifica pela **mensagem**, não pelo status HTTP:
 * o executeQueries devolve erro de DAX com HTTP 200 em alguns casos (resultado
 * com mais de uma tabela, por exemplo), e olhar só o código perderia esses.
 */
export function classifyOutcome(status: FabricStatus, error?: string): QueryOutcome {
  if (status === 'ok') return 'ok';
  if (status === 'unauthorized') return 'unauthorized';
  if (status === 'throttled') return 'throttled';
  if (status === 'unavailable') return 'unavailable';
  const msg = error ?? '';
  for (const [re, outcome] of DAX_PATTERNS) if (re.test(msg)) return outcome;
  return 'other_dax_error';
}

/** `at` existe para o teste apontar para um tmpdir e não sujar o `~/.nio` real. */
export const metricsDir = (at?: string): string => at ?? join(homedir(), '.nio', 'metrics');
const fileFor = (dir: string, d: Date): string =>
  join(dir, `fabric-${d.toISOString().slice(0, 10)}.jsonl`);

/** `NIO_METRICS=0` desliga — testes setam isso para não sujar o disco. */
function enabled(): boolean {
  return process.env.NIO_METRICS !== '0';
}

/** Anexa uma linha. Best-effort: qualquer falha é engolida de propósito. */
export function recordQuery(m: QueryMetric, at?: string): void {
  if (!enabled()) return;
  try {
    const dir = metricsDir(at);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(fileFor(dir, new Date()), JSON.stringify(m) + '\n', 'utf8');
  } catch {
    /* medir não pode quebrar consultar */
  }
}

/** Lê os registros dos últimos `dias`. Linha corrompida é pulada, não derruba a leitura. */
export function readMetrics(dias = 30, at?: string): QueryMetric[] {
  const dir = metricsDir(at);
  if (!existsSync(dir)) return [];
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const out: QueryMetric[] = [];
  try {
    for (const nome of readdirSync(dir).filter(
      (f) => f.startsWith('fabric-') && f.endsWith('.jsonl'),
    )) {
      for (const linha of readFileSync(join(dir, nome), 'utf8').split('\n')) {
        if (!linha.trim()) continue;
        try {
          const m = JSON.parse(linha) as QueryMetric;
          if (Date.parse(m.ts) >= corte) out.push(m);
        } catch {
          /* linha truncada por escrita concorrente — ignora */
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}

export interface OutcomeSummary {
  total: number;
  porOutcome: Record<string, number>;
  taxaErro: number;
  msP50: number;
  msP95: number;
}

function percentil(ordenados: readonly number[], p: number): number {
  if (ordenados.length === 0) return 0;
  const i = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return ordenados[i]!;
}

/** Agrega para a comparação antes/depois. Só `executeDax` — é onde o DAX falha. */
export function summarize(metrics: readonly QueryMetric[]): OutcomeSummary {
  const consultas = metrics.filter((m) => m.op === 'executeDax');
  const porOutcome: Record<string, number> = {};
  for (const m of consultas) porOutcome[m.outcome] = (porOutcome[m.outcome] ?? 0) + 1;
  const erros = consultas.length - (porOutcome.ok ?? 0);
  const ms = consultas.map((m) => m.ms).sort((a, b) => a - b);
  return {
    total: consultas.length,
    porOutcome,
    taxaErro: consultas.length === 0 ? 0 : erros / consultas.length,
    msP50: percentil(ms, 50),
    msP95: percentil(ms, 95),
  };
}
