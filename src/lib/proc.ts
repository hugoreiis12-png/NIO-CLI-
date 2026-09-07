/**
 * Spawn portável Windows ⇄ POSIX.
 *
 * No Windows os CLIs instalados via npm (npm, npx, opencode, code, cursor, …)
 * vêm como shims `.cmd`/`.bat`. O Node **não** os executa num spawn sem shell:
 * `spawnSync('opencode', …)` devolve `ENOENT` e `spawnSync('opencode.cmd', …)`
 * devolve `EINVAL` (o Node fechou a execução direta de `.cmd`/`.bat` sem shell —
 * CVE-2024-27980). A única forma que funciona é `shell: true`, deixando o
 * `cmd.exe` resolver o PATHEXT.
 *
 * Pra não cair no DEP0190 (args-array + shell não são escapados), montamos o
 * comando como **string única** e fazemos o quoting nós mesmos. Os argumentos
 * aqui vêm sempre de catálogos internos / caminhos do projeto — nunca texto livre
 * do usuário —, então o quoting simples (aspas quando há espaço/metacaractere)
 * basta. Em POSIX o comportamento é o spawn cru de sempre (args em array, sem
 * shell).
 */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

const isWin = process.platform === 'win32';

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (!isWin) accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `<binary>` está resolvível no PATH? Só olha o filesystem — **não executa**.
 * Detectar presença via `<bin> --version` trava 5 s quando o binário não trata
 * `--version` e faz trabalho de verdade (ex.: o próprio `nio-gateway`, que sobe
 * o servidor). No Windows cobre os shims `.cmd`/`.bat`/`.exe` (PATHEXT), como o
 * `spawnSyncPortable` faz via `shell: true`.
 */
export function binaryOnPath(binary: string): boolean {
  const exts = isWin
    ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  if (isAbsolute(binary) || binary.includes('/') || (isWin && binary.includes('\\'))) {
    return exts.some((ext) => isExecutableFile(binary + ext));
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    if (exts.some((ext) => isExecutableFile(join(dir, binary + ext)))) return true;
  }
  return false;
}

/** Quota um argumento pro `cmd.exe` (aspas se tiver espaço/metacaractere; `"`→`""`). */
function winQuote(arg: string): string {
  return /[\s"&|<>^()%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/** Comando único pro shell do Windows a partir de programa + args. */
function winCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args].map(winQuote).join(' ');
}

/**
 * `spawnSync` que acha shims `.cmd`/`.bat` no Windows. Assinatura compatível com
 * `spawnSync(program, args, options)`.
 */
export function spawnSyncPortable(
  program: string,
  args: readonly string[] = [],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  if (isWin) {
    return spawnSync(winCommandLine(program, args), { ...options, shell: true });
  }
  return spawnSync(program, args as string[], options);
}

/**
 * `spawn` (assíncrono) que acha shims `.cmd`/`.bat` no Windows. Use pra processos
 * detached (ex.: abrir o editor).
 */
export function spawnPortable(
  program: string,
  args: readonly string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  if (isWin) {
    return spawn(winCommandLine(program, args), { ...options, shell: true });
  }
  return spawn(program, args as string[], options);
}
