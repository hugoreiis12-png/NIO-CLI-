/**
 * `nio fabric schema sync` e `nio fabric rag status` — o acervo de grounding do RAG
 * de DAX. O corpus é o **schema do modelo semântico** (lido via `INFO.VIEW.*` por
 * REST), não documentação genérica: o que evita `Cannot find table 'X'` é saber os
 * nomes reais do modelo.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { createFabricGateway } from "../../adapters/fabric/client.js";
import { createLocalEmbedder, embedderStatus } from "../../adapters/embed/local-embedder.js";
import {
  createDocIndexRepository,
  countChunks,
  countMeasuresWithExpression,
  pruneOldRefs,
} from "../../adapters/pg/doc-index-repository.js";
import { ingestSchema } from "../../app/schema-ingest.js";
import { schemaRepo } from "../../app/schema-chunker.js";

/** Ids do modelo a sincronizar — do env, como as tools `nio_fabric_*`. */
function target(): { workspaceId?: string; datasetId?: string } {
  return {
    workspaceId: process.env.NIO_FABRIC_WORKSPACE?.trim() || undefined,
    datasetId: process.env.NIO_FABRIC_DATASET?.trim() || undefined,
  };
}

function requireTarget(): { workspaceId: string; datasetId: string } | null {
  const { workspaceId, datasetId } = target();
  if (workspaceId && datasetId) return { workspaceId, datasetId };
  console.error(
    `${c.yellow(sym.warn)} defina NIO_FABRIC_WORKSPACE e NIO_FABRIC_DATASET em ~/.nio/config.env`,
  );
  return null;
}

async function runSchemaSync(opts: { force?: boolean; prune?: boolean }): Promise<void> {
  const ids = requireTarget();
  if (!ids) {
    process.exitCode = 1;
    return;
  }

  console.log(c.dim("  lendo o schema do modelo (INFO.VIEW.*)…"));
  const out = await ingestSchema(
    { fabric: createFabricGateway(), embedder: createLocalEmbedder(), index: createDocIndexRepository() },
    { ...ids, force: opts.force },
  );

  if (out.status !== "ok" || !out.data) {
    console.error(`${c.red(sym.err)} ${out.error ?? "falha ao sincronizar o schema"}`);
    if (out.status === "unconfigured") {
      console.error(c.dim("  o embedder local não está instalado — veja `nio fabric rag status`"));
    }
    process.exitCode = 1;
    return;
  }

  const r = out.data;
  if (r.unchanged) {
    console.log(`${c.green(sym.ok)} schema inalterado (ref ${c.dim(r.ref)}) — nada a reembedar`);
    return;
  }
  console.log(
    `${c.green(sym.ok)} schema indexado: ${c.cyan(String(r.tables))} tabelas · ` +
      `${c.cyan(String(r.measures))} medidas · ${c.cyan(String(r.chunks))} chunks ` +
      `(${r.inserted} novos) ${c.dim(`ref ${r.ref}`)}`,
  );

  if (opts.prune) {
    const gone = await pruneOldRefs(schemaRepo(ids.datasetId), r.ref);
    if (gone.status === "ok") console.log(c.dim(`  versões antigas removidas: ${gone.data ?? 0} chunks`));
  }
}

async function runRagStatus(): Promise<void> {
  // 1. embedder (optionalDependency — pode simplesmente não estar instalado)
  const emb = await embedderStatus();
  if (emb.status === "ok") {
    console.log(`${c.green(sym.ok)} embedder local: ${c.cyan(emb.data ?? "")}`);
  } else {
    console.log(`${c.yellow(sym.warn)} embedder local: ${emb.error ?? emb.status}`);
  }

  // 2. acervo indexado para o modelo configurado
  const { datasetId } = target();
  if (!datasetId) {
    console.log(c.dim("  NIO_FABRIC_DATASET não definido — acervo não verificado"));
    return;
  }
  const repo = schemaRepo(datasetId);
  const count = await countChunks(repo);
  if (count.status !== "ok") {
    console.log(`${c.red(sym.err)} acervo: ${count.error ?? count.status}`);
    process.exitCode = 1;
    return;
  }
  const n = count.data ?? 0;
  if (n === 0) {
    console.log(`${c.yellow(sym.warn)} acervo vazio — rode \`nio fabric schema sync\``);
    return;
  }
  const refs = await createDocIndexRepository().indexedRefs(repo);
  const versoes = refs.status === "ok" ? (refs.data ?? []).length : 0;
  console.log(
    `${c.green(sym.ok)} acervo: ${c.cyan(String(n))} chunks do modelo ` +
      `${c.dim(datasetId)}${versoes > 1 ? c.dim(` (${versoes} versões — use --prune)`) : ""}`,
  );

  await reportMeasureExpressions(repo);
}

/**
 * As fórmulas das medidas são o que permite ao modelo **conferir** um cálculo em vez de
 * só chamar a medida. Elas não vêm do `INFO.VIEW.MEASURES()` (medido: `[Expression]`
 * nulo) e dependem de configuração do tenant — dizer isso é melhor que o agente
 * responder "não consigo" sem explicar.
 */
async function reportMeasureExpressions(repo: string): Promise<void> {
  const medidas = await countMeasuresWithExpression(repo);
  if (medidas.status !== "ok" || !medidas.data || medidas.data.total === 0) return;

  const { total, comFormula } = medidas.data;
  if (comFormula > 0) {
    console.log(`${c.green(sym.ok)} fórmulas DAX: ${c.cyan(`${comFormula}/${total}`)} medidas`);
    return;
  }
  console.log(`${c.yellow(sym.warn)} fórmulas DAX: ${c.cyan("0")} de ${total} medidas`);
  console.log(c.dim("  o modelo chama as medidas, mas não lê a definição delas."));
  console.log(c.dim("  habilite no portal admin do Power BI → Configurações do locatário → API de administrador:"));
  console.log(c.dim("    · Metadados detalhados do conjunto de dados"));
  console.log(c.dim("    · Expressões DAX e mashup do conjunto de dados"));
}

export function registerFabricRagCommands(fabric: Command): void {
  const schema = fabric.command("schema").description("Schema do modelo semântico no índice vetorial");
  schema
    .command("sync")
    .description("Lê o schema via INFO.VIEW.* e indexa (pula se nada mudou)")
    .option("--force", "reindexa mesmo se o schema não mudou")
    .option("--prune", "remove as versões antigas do acervo após indexar")
    .action(runSchemaSync);

  const rag = fabric.command("rag").description("Estado do RAG de DAX (embedder + acervo)");
  rag
    .command("status", { isDefault: true })
    .description("Mostra se o embedder está instalado e quanto do modelo está indexado")
    .action(runRagStatus);
}
