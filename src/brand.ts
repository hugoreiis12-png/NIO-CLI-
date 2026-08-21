import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Fonte única de verdade de marca/atribuição do CLI. Rebrandear = editar este arquivo — ao
 * trocar, casar em lockstep: `package.json` (`name`/`bin`/`description`/`keywords`/`repository`)
 * e os docs .md que citam tools literalmente (CLAUDE.md, SKILL.md, docs/specs/**\/*.md, e o `brand.skillsRepo` externo).
 * A tabela de tools do README é GERADA — depois de editar aqui, rode `bun run gen:docs`.
 *
 * Rebrand NIO (docs/specs/rebrand/0005-noclaf-to-nio.md): sem compat com o nome antigo — nenhum
 * fallback de `NOCLAF_*`/`~/.noclaf` no código. Duas pendências cross-sistema documentadas na
 * spec, não resolvidas só por este arquivo: `patPrefix` (backend precisa aceitar o prefixo novo
 * antes do deploy) e `webUrl` (auth desacoplada do domínio antigo — mecanismo definitivo em
 * docs/specs/auth/0002-cli-native-login.md, ainda em aberto).
 */
export const brand = {
  // --- Identidade / display ---
  /** Nome do comando/binário principal (nome no help do CLI + `bin` do package.json). */
  name: 'nio',
  /** Nome curto do produto, mostrado a usuários e agentes. */
  productName: 'NIO',
  /** Nome completo do produto. PENDENTE: expansão real a confirmar (não pode reintroduzir "Noclaf"). */
  productFullName: 'NIO',

  /** Org/usuário do GitHub que hospeda o repo atual da CLI. */
  githubOrg: 'hugoreiis12-png',
  /** Nome do repo no GitHub (casing exato, como criado). */
  githubRepo: 'NIO-CLI',
  /** Pacote npm — usado nas mensagens de atualização. Org real confirmada: `nio-cli` (não `nio`). */
  packageName: '@nio-cli/cli',
  /** Binário do servidor MCP (segundo `bin` do package.json). */
  mcpBinName: 'nio-cli',
  /** Chave sob a qual o servidor MCP é registrado nos configs dos clientes. */
  mcpServerKey: 'nio',

  // --- URLs / endpoints ---
  /**
   * Base do app web — DESACOPLADA por decisão do rebrand: a CLI não depende mais de um
   * domínio externo pra autenticação. Vazio até `docs/specs/auth/0002-cli-native-login.md`
   * definir o mecanismo; os pontos de uso (`cli/commands/auth.ts`, `init/auth-step.ts`) já
   * tratam string vazia sem imprimir link quebrado.
   */
  webUrl: '',
  supabaseUrl: 'https://wdshvtlsjoegjvmpqobx.supabase.co',
  /** COPIE o literal de `src/constants.ts:6` — não redigite. */
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkc2h2dGxzam9lZ2p2bXBxb2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDA4OTQsImV4cCI6MjA5MTMxNjg5NH0.4wlAsT_D5gDiBQ19WA-q5zu105fT9TsD1NKI_tGQt-4',

  // --- Filesystem / namespacing ---
  /** Dir de dados no home → `~/.nio`. */
  homeDirName: '.nio',
  /** Arquivo de binding do projeto na raiz do repo. */
  projectConfigFile: 'nio.json',

  // --- Contratos ---
  /** Prefixo das env vars: `NIO` → `NIO_PAT`, `NIO_CLIENT`, … Contrato externo: Cowork/Codex setam `NIO_CLIENT` de fora — trocar aqui exige trocar lá também. */
  envPrefix: 'NIO',
  /**
   * Prefixo do PAT. ⚠️ MUDANÇA COORDENADA: o backend hoje só valida `noc_`. Publicar com
   * `nio_` antes do backend aceitar o prefixo novo quebra login de todo mundo — ver nota
   * na spec de rebrand (F11-T0.4).
   */
  patPrefix: 'nio_',

  // --- Repo de skills ---
  /** Refatorado por outro time (`noclaf-skills` → `nio-skills`). */
  skillsRepo: 'hugoreiis12-png/NIO-SKILLS-',
  skillsRef: 'main',
  /** Pacote npm das skills — citado em mensagens de erro de "pacote não encontrado". ASSUME mesma org (`nio-cli`) do pacote da CLI — confirmar se as skills publicam em outro escopo. */
  skillsPackage: '@nio-cli/skills',

  // --- Prefixos dos nomes das tools MCP --- (dois por decisão de domínio: produto vs. CLI — mantidos separados no rebrand; formato validado pelos clientes MCP como `^[a-zA-Z0-9_-]{1,64}$`, só minúsculas/dígitos, termine com `_`)
  /** Tools de domínio do produto: `nos_list_tasks`, `nos_move_task`, … (16 tools). Mantido — nomeia o produto NOS, não a marca da CLI. */
  toolPrefix: 'nos_',
  /** Tools que espelham verbos do CLI: `nio_plan`, `nio_exec_status`, … (4 tools). */
  cliToolPrefix: 'nio_',
} as const;

// Arte ASCII do `--help`/login — efeito Matrix, gerada por `renderMatrixLogo()`
// em `./matrix-logo.js` (fora deste objeto: é lógica de renderização, não
// valor de marca).

// ponytail: prefixo do PAT assumido alfanumérico + `_`; se um dia tiver metachar de
// regex, escapar antes de interpolar.
/** Regex do formato do PAT, derivada do prefixo: `nio_` + 64 hex. */
export const patRegex = new RegExp(`^${brand.patPrefix}[a-f0-9]{64}$`);

/** Caminho dentro do dir de dados: `homePath('skills')` → `~/.nio/skills`. */
export function homePath(...parts: string[]): string {
  return join(homedir(), brand.homeDirName, ...parts);
}

/** NOME completo da env var: `envName('CLIENT')` → `'NIO_CLIENT'`. */
export function envName(name: string): string {
  return `${brand.envPrefix}_${name}`;
}

/** VALOR da env var prefixada: `env('PAT')` → `process.env.NIO_PAT`. */
export function env(name: string): string | undefined {
  return process.env[envName(name)];
}
