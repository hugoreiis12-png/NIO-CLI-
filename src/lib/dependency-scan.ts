/**
 * Scanner de dependências do projeto (fatia 1 do DependencyWatcher — Sprint 3).
 * Lê os manifests conhecidos na pasta da sessão e extrai as dependências
 * DECLARADAS (não decide o que está instalado — isso é a fatia 2). A lógica de
 * parse é PURA (recebe conteúdo, não toca disco) pra ser testável sem fixtures em
 * arquivo; só `scanProject` faz IO, best-effort por manifest.
 *
 * NÃO confundir com `dependencies.ts` (deps declaradas por skills no frontmatter).
 * Aqui é o manifest do projeto do usuário (`package.json`, `requirements.txt`, …).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { DependencyType } from '../core/session.js';

/** Uma dependência declarada num manifest do projeto. */
export interface ScannedDependency {
  name: string;
  type: DependencyType;
  /** Nome do manifest onde a dep foi declarada (ex.: "package.json"). */
  filePath: string;
}

/** Manifests que o scanner entende, mapeados ao ecossistema. */
export const MANIFESTS: { file: string; type: DependencyType }[] = [
  { file: 'package.json', type: 'npm' },
  { file: 'requirements.txt', type: 'pip' },
  { file: 'Cargo.toml', type: 'cargo' },
];

/** Chaves de dependência num `package.json` (runtime + dev + peer + optional). */
const NPM_DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** `package.json` → nomes de pacote. Tolerante: JSON inválido → lista vazia. */
export function parsePackageJson(content: string): string[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const key of NPM_DEP_KEYS) {
    const map = obj[key];
    if (map && typeof map === 'object') {
      for (const name of Object.keys(map as Record<string, unknown>)) names.add(name);
    }
  }
  return [...names];
}

/**
 * `requirements.txt` → nomes de pacote. Ignora comentários (`#`), diretivas
 * (`-r`, `--flag`), URLs e linhas vazias; tira specifier de versão, extras
 * (`pkg[extra]`) e markers (`; python_version`).
 */
export function parseRequirementsTxt(content: string): string[] {
  const names = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    // Corta no primeiro delimitador de versão/extra/marker/espaço.
    const name = line.split(/[[<>=!~;\s]/)[0]?.trim();
    if (!name) continue;
    // Pula URLs / paths (git+https, file:, ./local) — não são nomes de pacote.
    if (name.includes(':') || name.includes('/')) continue;
    names.add(name);
  }
  return [...names];
}

/** Tabelas de dependência num `Cargo.toml`. */
const CARGO_DEP_TABLES = ['dependencies', 'dev-dependencies', 'build-dependencies'] as const;

/** `Cargo.toml` → nomes de crate. Tolerante: TOML inválido → lista vazia. */
export function parseCargoToml(content: string): string[] {
  let obj: Record<string, unknown>;
  try {
    obj = parseToml(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const table of CARGO_DEP_TABLES) {
    const map = obj[table];
    if (map && typeof map === 'object') {
      for (const name of Object.keys(map as Record<string, unknown>)) names.add(name);
    }
  }
  return [...names];
}

/** Parser por nome de manifest. `null` = arquivo não reconhecido. */
function parseByFile(file: string, content: string): string[] | null {
  switch (file) {
    case 'package.json':
      return parsePackageJson(content);
    case 'requirements.txt':
      return parseRequirementsTxt(content);
    case 'Cargo.toml':
      return parseCargoToml(content);
    default:
      return null;
  }
}

/** Parse puro de UM manifest (conteúdo → deps). Testável sem disco. */
export function scanContent(file: string, content: string): ScannedDependency[] {
  const entry = MANIFESTS.find((m) => m.file === file);
  const names = parseByFile(file, content);
  if (!entry || !names) return [];
  return names.map((name) => ({ name, type: entry.type, filePath: file }));
}

/**
 * Escaneia a pasta do projeto: lê cada manifest que existir e agrega as deps.
 * Best-effort por arquivo (manifest ausente/ilegível é pulado, não lança).
 */
export function scanProject(projectPath: string): ScannedDependency[] {
  const found: ScannedDependency[] = [];
  for (const { file } of MANIFESTS) {
    let content: string;
    try {
      content = readFileSync(join(projectPath, file), 'utf8');
    } catch {
      continue; // manifest não existe nesse projeto — segue.
    }
    found.push(...scanContent(file, content));
  }
  return found;
}
