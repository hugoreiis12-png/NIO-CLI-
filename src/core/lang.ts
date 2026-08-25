/**
 * Domínio de linguagens (v2) — vocabulário do `nio-lang` (MCP server nativo que
 * centraliza config/conhecimento de Python, TypeScript, Node.js, C# e n8n).
 * Sem IO aqui (regra do hexágono). Ver `docs/v2/ARQUITETURA-NIO-LANG.md`.
 */

/** Linguagens centralizadas pelo `nio-lang`. */
export type LanguageId = 'python' | 'typescript' | 'node' | 'csharp' | 'n8n';

export const LANGUAGE_IDS: readonly LanguageId[] = [
  'python',
  'typescript',
  'node',
  'csharp',
  'n8n',
];

export function isLanguageId(v: unknown): v is LanguageId {
  return typeof v === 'string' && (LANGUAGE_IDS as readonly string[]).includes(v);
}

/** Referência de conhecimento de uma linguagem (camada de sintaxe/semântica). */
export interface LangReference {
  language: LanguageId;
  /** `false` quando o cache do repo ainda não foi sincronizado (`nio lang sync`). */
  found: boolean;
  /** Texto da referência, ou a mensagem acionável de "não sincronizado". */
  content: string;
  /** Repo/dir de origem, quando `found`. */
  source?: string;
}

/**
 * Store de conhecimento das linguagens — port. A implementação (`adapters/lang`)
 * lê do cache vendorado (`~/.nio/lang/`, fetch-cache dos 5 repos). **Nunca lança**:
 * cache ausente vira `found: false` com mensagem acionável.
 */
export interface KnowledgeStore {
  reference(language: LanguageId, topic?: string): LangReference;
}

/**
 * Recipe de ambiente de uma linguagem — o que o perfil pré-configura (camada B)
 * + o SDK pra construir MCP servers nela (camada A). Descritivo na fatia 3; o
 * `ScaffoldGateway` (fatia 4) age em cima disto.
 */
export interface LanguageRecipe {
  language: LanguageId;
  /** Runtime/toolchain necessário (ex.: 'node', 'python', 'dotnet'). */
  runtime: string;
  /** Gerenciadores de pacote aceitos (o 1º é o default). Ex.: ['npm','pnpm','yarn']. */
  packageManagers: string[];
  /** Libs sempre incluídas na base. */
  baseLibs: string[];
  /** Frameworks disponíveis pra escolher. */
  frameworks: string[];
  /** ORMs disponíveis. */
  orms: string[];
  /** Pacotes de tipagem (ex.: 'typescript', '@types/node'). */
  typings: string[];
  /** SDK pra construir MCP servers naquela linguagem (camada A; opcional). */
  mcpSdk?: string;
}

/**
 * Catálogo de recipes por linguagem — port. Implementação hardcoded em
 * `adapters/lang` (como o `ProfileCatalog`). **Lança** se a linguagem ainda não
 * tem recipe modelada.
 */
export interface LanguageCatalog {
  recipe(language: LanguageId): LanguageRecipe;
}

/** Escolhas do wizard ao pré-configurar uma linguagem (subset da recipe). */
export interface ScaffoldChoices {
  /** Um de `recipe.packageManagers` (default = o 1º). */
  packageManager?: string;
  /** Um de `recipe.frameworks`. */
  framework?: string;
  /** Um de `recipe.orms`. */
  orm?: string;
}

/**
 * Um passo do plano de scaffold — comando a rodar OU arquivo a gerar. Descritivo:
 * o `plan()` só monta; o `apply()` é quem executa (ou não, em dry-run).
 */
export type ScaffoldStep =
  | { kind: 'run'; program: string; args: string[]; cwd: string; label: string }
  | { kind: 'write'; path: string; content: string; label: string };

export interface ScaffoldPlan {
  language: LanguageId;
  targetDir: string;
  steps: ScaffoldStep[];
}

export interface ScaffoldStepResult {
  step: ScaffoldStep;
  /** `planned` = dry-run (não executou) · `done` · `failed`. */
  status: 'planned' | 'done' | 'failed';
  error?: string;
}

/**
 * Materializa uma recipe no projeto. **Isolamento por construção:**
 * `plan()` só descreve (zero IO/execução); `apply()` com `dryRun` devolve tudo
 * como `planned` sem tocar em nada. Execução real usa `spawnSync` SEM shell,
 * sempre dentro de `targetDir`. **Nunca lança** — falha vira `status: 'failed'`.
 */
export interface ScaffoldGateway {
  plan(recipe: LanguageRecipe, choices: ScaffoldChoices, targetDir: string): ScaffoldPlan;
  apply(plan: ScaffoldPlan, opts?: { dryRun?: boolean }): ScaffoldStepResult[];
}

/**
 * Estado do diretório do projeto — sinaliza se o scaffold pode/deve instalar
 * (regra do dono do projeto: instalar só "de acordo com o projeto", nunca cego).
 * Greenfield (vazio) → pode inicializar; brownfield (existente) → só adiciona o
 * que faz sentido, sem sobrescrever.
 */
export interface ProjectContext {
  targetDir: string;
  /** Diretório vazio (ignorando `.git`, marker, etc.)? Greenfield. */
  empty: boolean;
  hasPackageJson: boolean; // node/typescript
  hasPyproject: boolean; // python (pyproject.toml)
  hasRequirements: boolean; // python (requirements.txt)
  hasCsproj: boolean; // csharp (*.csproj)
  /** Package manager node detectado por lockfile (npm/pnpm/yarn), se houver. */
  nodePackageManager?: string;
}

/** Inspeciona o diretório do projeto (read-only). Nunca lança. */
export interface ProjectDetector {
  detect(targetDir: string): ProjectContext;
}

/**
 * Resolve o nome do pacote instalável de um framework/ORM (display name) numa
 * linguagem — ex.: `('typescript', 'Next.js') → 'next'`. `null` quando não há
 * mapeamento (o scaffold registra no marker + avisa, não instala). Implementação
 * hardcoded em `adapters/lang` (dados).
 */
export interface PackageMap {
  resolve(language: LanguageId, displayName: string): string | null;
}
