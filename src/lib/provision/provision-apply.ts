import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync, readlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { VERSION } from "../../version.js";
import { brand } from "../../brand.js";

/**
 * Motor do provisionamento: hash/manifesto (`.<marca>-provision.json`), escrita
 * idempotente e poda do que o nio gravou. `provision.ts` monta a lista e chama
 * `applyProvision`; `uninstallProvision` desfaz pelo mesmo manifesto.
 */

export const MANIFEST_NAME = `.${brand.name}-provision.json`;

export type ProvisionAction =
  | "create"
  | "update"
  | "unchanged"
  | "skip-conflict"
  | "prune"
  | "prune-kept"
  | "write-error";

export interface ProvisionFileResult {
  /** Path relativo ao destino, ex.: `commands/implement.md`. */
  relPath: string;
  action: ProvisionAction;
  /** Nota curta (motivo de conflito / preservação). */
  detail?: string;
}

export interface ProvisionResult {
  targetDir: string;
  version: string;
  dryRun: boolean;
  files: ProvisionFileResult[];
}

/** Um doc a provisionar: path relativo (ex. `commands/x.md`) + conteúdo. */
export interface ProvisionInputDoc {
  relPath: string;
  content: Buffer;
}

export interface ProvisionOptions {
  /** Raiz de destino (default `~/.claude`). Sobrescrevível em testes. */
  targetDir?: string;
  /** Raiz do pacote de skills (default: `@nio-cli/skills`). Sobrescrevível em testes. */
  skillsDir?: string;
  /** Não escreve nada — só calcula o plano. */
  dryRun?: boolean;
  /** Sobrescreve arquivos divergentes que não são nossos. */
  force?: boolean;
  /** Remove arquivos que saíram do pacote (default `true`). */
  prune?: boolean;
  /**
   * Paths que **existem no bundle** (sem o filtro de seleção). O prune só remove o que
   * NÃO está aqui — ou seja, o que saiu do bundle de verdade. Sem isso, mudar a seleção
   * (ou o auto-pull de um repo com seleção estreita) apagaria skills/commands que só
   * foram filtrados, não removidos (ex.: `/implement` num repo sem o role `dev`).
   */
  keep?: Set<string>;
}

interface Manifest {
  version: string;
  generator: string;
  /** relPath -> sha256 do conteúdo que o nio gravou. */
  files: Record<string, string>;
}

export function defaultTargetDir(): string {
  return join(homedir(), ".claude");
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
    if (parsed && typeof parsed === "object" && parsed.files) return parsed;
  } catch {
    // manifesto corrompido → trata como ausente e reconstrói
  }
  return null;
}

/**
 * Se um componente de `dir` é symlink com alvo inexistente (dotfiles gerenciando
 * `~/.claude`), materializa o alvo em vez de deixar o `mkdir -p` estourar ENOENT.
 * Retorna `true` se materializou algo. Escrever depois grava através do link.
 */
function materializeDanglingLink(dir: string): boolean {
  let cursor = dir;
  for (;;) {
    let info;
    try {
      info = lstatSync(cursor);
    } catch {
      // cursor não existe (parent pendurado) → sobe um nível.
      const parent = dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
      continue;
    }
    if (info.isSymbolicLink()) {
      const target = resolve(dirname(cursor), readlinkSync(cursor));
      if (existsSync(target)) return false; // link ok — o ENOENT veio de outro lugar
      mkdirSync(target, { recursive: true });
      return true;
    }
    return false; // cursor existe e é real → não há link pendurado acima
  }
}

/** `mkdir -p` tolerante a symlinks pendurados de dotfiles (ver acima). */
export function ensureDir(dir: string): void {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      mkdirSync(dir, { recursive: true });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      if (!materializeDanglingLink(dir)) throw err;
    }
  }
  mkdirSync(dir, { recursive: true });
}

function writeFile(targetAbs: string, content: Buffer): void {
  ensureDir(dirname(targetAbs));
  writeFileSync(targetAbs, content);
}

/**
 * Núcleo do provisionamento: aplica `docs` no destino, idempotente e não-destrutivo
 * via manifesto. Retorna o plano por arquivo.
 */
export function applyProvision(
  docs: ProvisionInputDoc[],
  options: ProvisionOptions = {},
): ProvisionResult {
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const prune = options.prune ?? true;
  const targetDir = options.targetDir ?? defaultTargetDir();

  const manifestPath = join(targetDir, MANIFEST_NAME);
  const oldFiles = readManifest(manifestPath)?.files ?? {};

  const files = docs.map((d) => ({
    relPath: d.relPath,
    content: d.content,
    hash: sha256(d.content),
  }));
  const incomingSet = new Set(files.map((f) => f.relPath));

  const results: ProvisionFileResult[] = [];
  const newFiles: Record<string, string> = {};

  for (const f of files) {
    const targetAbs = join(targetDir, f.relPath);

    // Um arquivo problemático (ex.: symlink de dotfiles quebrado) vira um resultado
    // `write-error` e a sincronização segue — nunca aborta o resto por causa de um.
    try {
      if (!existsSync(targetAbs)) {
        if (!dryRun) writeFile(targetAbs, f.content);
        results.push({ relPath: f.relPath, action: "create" });
        newFiles[f.relPath] = f.hash;
        continue;
      }

      const existingHash = sha256(readFileSync(targetAbs));

      if (existingHash === f.hash) {
        results.push({ relPath: f.relPath, action: "unchanged" });
        newFiles[f.relPath] = f.hash;
        continue;
      }

      // Divergente. Só atualizamos se o arquivo era nosso e o worker não mexeu,
      // ou se ele pediu --force.
      const wasOursUntouched = oldFiles[f.relPath] === existingHash;
      if (wasOursUntouched || force) {
        if (!dryRun) writeFile(targetAbs, f.content);
        results.push({
          relPath: f.relPath,
          action: "update",
          detail: wasOursUntouched
            ? undefined
            : "forçado sobre arquivo divergente",
        });
        newFiles[f.relPath] = f.hash;
      } else {
        results.push({
          relPath: f.relPath,
          action: "skip-conflict",
          detail:
            oldFiles[f.relPath] !== undefined
              ? "editado localmente"
              : "arquivo de terceiros",
        });
        // Não reivindica propriedade: fica de fora do novo manifesto.
      }
    } catch (err) {
      results.push({
        relPath: f.relPath,
        action: "write-error",
        detail: (err as Error).message,
      });
    }
  }

  // Prune: o que era nosso mas não veio nesta fonte.
  if (prune) {
    for (const [relPath, oldHash] of Object.entries(oldFiles)) {
      if (incomingSet.has(relPath)) continue;
      // Ainda existe no bundle (só foi filtrado pela seleção neste run) → NÃO poda;
      // mantém no manifesto pra não perder a propriedade em runs futuros.
      if (options.keep?.has(relPath)) {
        newFiles[relPath] = oldHash;
        continue;
      }
      const targetAbs = join(targetDir, relPath);
      if (!existsSync(targetAbs)) continue;
      const existingHash = sha256(readFileSync(targetAbs));
      if (existingHash === oldHash) {
        if (!dryRun) rmSync(targetAbs);
        results.push({ relPath, action: "prune" });
      } else {
        results.push({
          relPath,
          action: "prune-kept",
          detail: "modificado localmente — mantido",
        });
      }
    }
  }

  if (!dryRun) {
    const manifest: Manifest = {
      version: VERSION,
      generator: brand.packageName,
      files: newFiles,
    };
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8",
    );
  }

  return { targetDir, version: VERSION, dryRun, files: results };
}

export interface UninstallResult {
  targetDir: string;
  /** Arquivos removidos (eram nossos e intactos). */
  removed: string[];
  /** Arquivos preservados (modificados localmente). */
  kept: string[];
  dryRun: boolean;
}

/** Remove só o que o nio instalou (conforme o manifesto), preservando edições locais. */
export function uninstallProvision(
  options: { targetDir?: string; dryRun?: boolean } = {},
): UninstallResult {
  const dryRun = options.dryRun ?? false;
  const targetDir = options.targetDir ?? defaultTargetDir();
  const manifestPath = join(targetDir, MANIFEST_NAME);
  const manifest = readManifest(manifestPath);

  const removed: string[] = [];
  const kept: string[] = [];

  if (manifest) {
    for (const [relPath, hash] of Object.entries(manifest.files)) {
      const targetAbs = join(targetDir, relPath);
      if (!existsSync(targetAbs)) continue;
      if (sha256(readFileSync(targetAbs)) === hash) {
        if (!dryRun) rmSync(targetAbs);
        removed.push(relPath);
      } else {
        kept.push(relPath);
      }
    }
    if (!dryRun && existsSync(manifestPath)) rmSync(manifestPath);
  }

  return { targetDir, removed, kept, dryRun };
}
