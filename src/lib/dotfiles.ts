/**
 * Materializa `envVars`/`aliases` do perfil (do `EnvironmentBuilder`) em arquivos
 * gerenciados sob `~/.nio`: `profile.sh` (bash/zsh) e `profile.ps1` (PowerShell).
 * O usuário dá `source` uma vez (o `nio init` orienta).
 *
 * **Idempotente e não-destrutivo**: só reescreve o bloco entre os marcadores
 * `# >>> nio managed >>>` / `# <<< nio managed <<<`, preservando o resto do
 * arquivo. Sem `envVars`/`aliases`, não escreve nada (`skipped`).
 *
 * Ver `docs/v2/ARQUITETURA-ENVIRONMENT-BUILDER.md` (Tarefa 5).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homePath } from '../brand.js';

const START = '# >>> nio managed >>>';
const END = '# <<< nio managed <<<';
const NOTE = '# Gerado pelo `nio init` — não edite à mão (regenerado a cada init).';

export interface DotfilesInput {
  envVars?: Record<string, string>;
  aliases?: Record<string, string>;
}

export interface DotfileResult {
  path: string;
  shell: 'sh' | 'pwsh';
  status: 'written' | 'skipped';
}

/** Aspas simples POSIX: `'` vira `'\''`. */
function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
/** Aspas simples PowerShell: `'` vira `''`. */
function pwshQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function renderSh(input: DotfilesInput): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input.envVars ?? {})) lines.push(`export ${k}=${shQuote(v)}`);
  for (const [name, cmd] of Object.entries(input.aliases ?? {})) lines.push(`alias ${name}=${shQuote(cmd)}`);
  return lines.join('\n');
}

function renderPwsh(input: DotfilesInput): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input.envVars ?? {})) lines.push(`$env:${k} = ${pwshQuote(v)}`);
  // PowerShell não tem alias com args — vira função que repassa `@args`.
  for (const [name, cmd] of Object.entries(input.aliases ?? {})) lines.push(`function ${name} { ${cmd} @args }`);
  return lines.join('\n');
}

/** Substitui (ou insere) o bloco gerenciado, preservando o resto do arquivo. */
function upsertBlock(path: string, body: string): void {
  const block = `${START}\n${NOTE}\n${body}\n${END}`;
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const stripped = existing.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, 'g'), '').trimEnd();
  const next = stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
}

function isEmpty(input: DotfilesInput): boolean {
  return (
    Object.keys(input.envVars ?? {}).length === 0 && Object.keys(input.aliases ?? {}).length === 0
  );
}

/**
 * Escreve `profile.sh` + `profile.ps1` em `~/.nio` (ou em `opts.dir`, seam de
 * teste). Retorna o resultado por shell.
 */
export function writeManagedDotfiles(
  input: DotfilesInput,
  opts: { dir?: string } = {},
): DotfileResult[] {
  const dir = opts.dir ?? homePath();
  const shPath = join(dir, 'profile.sh');
  const psPath = join(dir, 'profile.ps1');

  if (isEmpty(input)) {
    return [
      { path: shPath, shell: 'sh', status: 'skipped' },
      { path: psPath, shell: 'pwsh', status: 'skipped' },
    ];
  }

  upsertBlock(shPath, renderSh(input));
  upsertBlock(psPath, renderPwsh(input));
  return [
    { path: shPath, shell: 'sh', status: 'written' },
    { path: psPath, shell: 'pwsh', status: 'written' },
  ];
}
