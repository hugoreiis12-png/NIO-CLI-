import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Copy (textos de prompt em pt-BR) mora em JSON sob `copy/`, separado da lógica.
 * Lido em runtime relativo a este módulo — mesma convenção de `version.ts`/`skills.ts`
 * (compila pra `dist/cli/copy.js`; os JSON são copiados pra `dist/cli/copy/` no build).
 * ponytail: sem validação em runtime — os JSON são versionados e publicados junto
 * ao pacote; a tipagem via interface + cast é o contrato.
 */
function loadCopy<T>(name: string): T {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, "copy", `${name}.json`), "utf-8")) as T;
}

export interface AuthCopy {
  login: { patPrompt: string; patInvalid: string };
}
export interface InitCopy {
  overwrite: string;
  patPrompt: string;
  patInvalid: string;
  pickProject: string;
  manualProjectChoice: string;
  manualProjectPrompt: string;
  manualProjectInvalid: string;
  linkRepo: string;
  noRepoChoice: string;
  clientsPrompt: string;
  clientChoices: {
    opencodeGlobal: string;
  };
}
export interface SyncCopy {
  update: { confirm: string };
}
export interface FlowsCopy {
  installDep: string;
  installClient: string;
  coworkManual: string;
  disableCoAuthored: string;
}

export const authCopy = loadCopy<AuthCopy>("auth");
export const initCopy = loadCopy<InitCopy>("init");
export const syncCopy = loadCopy<SyncCopy>("sync");
export const flowsCopy = loadCopy<FlowsCopy>("flows");

/** Interpola `{chave}` num template de copy. */
export function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
