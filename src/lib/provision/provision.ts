import { existsSync } from "node:fs";
import { brand } from "../../brand.js";
import { claudeTarget, type ProvisionTarget } from "../clients/targets.js";
import { filterDocsForSurface, skillsDir } from "../skills/skills.js";
import { filterForSelection, flattenSelection, type Selection } from "../skills/sections.js";
import { collectSkillFiles } from "./provision-collect.js";
import { applyProvision, type ProvisionOptions, type ProvisionResult } from "./provision-apply.js";

/**
 * Provisiona skills/commands/agents do nio (o MCP não grava em `~/.claude`; a CLI
 * `sync`/`init` chama `provision()`). Idempotente via manifesto. Coleta em
 * `provision-collect.ts`, motor em `provision-apply.ts` — ambos reexportados daqui.
 */

/**
 * Copia/atualiza o conteúdo do pacote `@nio-cli/skills` no destino.
 * (`nio sync` / `nio init`.)
 */
export function provision(
  options: ProvisionOptions & { target?: ProvisionTarget; selection?: Selection } = {},
): ProvisionResult {
  const target = options.target ?? claudeTarget;
  const dir = options.skillsDir ?? skillsDir();
  if (!existsSync(dir)) {
    throw new Error(
      `Pacote de skills não encontrado em ${dir}. Instale/publique ${brand.skillsPackage}.`,
    );
  }
  const rawDocs = collectSkillFiles(dir).map((f) => ({
    relPath: f.relPath,
    content: f.content,
  }));

  // Todos os paths on-disk possíveis do bundle (sem o filtro de seleção). O prune só
  // remove o que NÃO está aqui — o que saiu do bundle de verdade —, nunca o que foi só
  // filtrado pela seleção deste run. Sem isso o auto-pull de um repo com seleção estreita
  // apagava `/implement` & cia. do `~/.claude` global.
  const keep = new Set(
    target
      .mapDocs(filterDocsForSurface(flattenSelection(rawDocs), target.surface))
      .map((d) => d.relPath),
  );

  const scoped = filterForSelection(rawDocs, options.selection);
  const flat = flattenSelection(scoped);
  const visible = filterDocsForSurface(flat, target.surface);
  const docs = target.mapDocs(visible);
  return applyProvision(docs, {
    ...options,
    keep,
    targetDir: options.targetDir ?? target.targetDir(),
  });
}

export {
  MANIFEST_NAME,
  applyProvision,
  ensureDir,
  uninstallProvision,
  type ProvisionAction,
  type ProvisionFileResult,
  type ProvisionResult,
  type ProvisionInputDoc,
  type ProvisionOptions,
  type UninstallResult,
} from "./provision-apply.js";
