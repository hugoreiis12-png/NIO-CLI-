import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Coleta os arquivos sincronizáveis do pacote `@nio-cli/skills` (commands/skills/
 * agents) como uma lista em memória — a fonte que `provision()` filtra/achata
 * (via `sections.ts`) e passa pro motor de aplicação (`provision-apply.ts`).
 */

/** Subpastas do pacote `@nio-cli/skills` espelhadas em `~/.claude`. */
const SYNCED_SUBDIRS = ["commands", "skills", "agents"] as const;

/** Basenames que nunca são copiados pro destino (READMEs são só do repo). */
const IGNORED_BASENAMES = new Set([".gitkeep", ".DS_Store", "README.md"]);

export interface SkillFile {
  relPath: string;
  content: Buffer;
}

/** Lista arquivos sob `dir` recursivamente, paths relativos a `dir` em estilo POSIX. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) walk(childAbs);
      else if (entry.isFile())
        out.push(relative(dir, childAbs).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** Coleta os arquivos sincronizáveis do pacote (só as subpastas conhecidas). */
export function collectSkillFiles(dir: string): SkillFile[] {
  const files: SkillFile[] = [];
  for (const sub of SYNCED_SUBDIRS) {
    const subDir = join(dir, sub);
    if (!existsSync(subDir)) continue;
    for (const rel of listFilesRecursive(subDir)) {
      const base = rel.split("/").pop() ?? rel;
      if (IGNORED_BASENAMES.has(base)) continue;
      const abs = join(subDir, rel);
      const content = readFileSync(abs);
      files.push({ relPath: `${sub}/${rel}`, content });
    }
  }
  return files;
}
