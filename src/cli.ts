#!/usr/bin/env node
import "./lib/load-env.js";
import { DEBUG } from "./lib/debug.js";
import { animateMatrixLogo } from "./matrix-logo.js";
import { notifyCliIfUpdate } from "./lib/version-check.js";
import { buildProgram } from "./cli/program.js";
import { continueChain } from "./cli/flows/onboarding.js";

notifyCliIfUpdate();

/** `--help` toca a animação antes; se já rolou, o `beforeAll` não redesenha. */
let logoShown = false;
const program = buildProgram(() => logoShown);

const fail = (err: unknown): never => {
  if (DEBUG) console.error(err);
  else console.error(`Erro: ${(err as Error).message}\n(rode com NIO_DEBUG=1 pro stack trace completo)`);
  process.exit(1);
};

/**
 * Fecha o pool do Postgres se algum comando abriu um — senão o socket ocioso
 * segura o event loop por `idleTimeoutMillis` (30s) e o CLI só devolve o prompt
 * 30s depois de terminar. A flag global é setada em `getPool()`; checá-la aqui
 * evita puxar o `pg` (~13ms) no cold start de `nio --version`/`--help`.
 */
const closeDbIfOpen = async (): Promise<void> => {
  if (!(globalThis as Record<string, unknown>).__nioPgPoolOpen) return;
  await import("./adapters/pg/client.js").then((m) => m.closePool()).catch(() => {});
};

const args = process.argv.slice(2);
const bare = args.length === 0;
const topHelp =
  bare || (args.length === 1 && (args[0] === "-h" || args[0] === "--help" || args[0] === "help"));

if (bare && process.stdout.isTTY && process.stdin.isTTY) {
  // `nio` sozinho num terminal → a esteira guiada (não o help).
  continueChain({ from: "cold" }).then(closeDbIfOpen).catch(fail);
} else {
  // `nio --help` / `nio | cat` / CI → animação (se topo) + help/comando do commander.
  const helpPromise = topHelp
    ? animateMatrixLogo().then(() => {
        logoShown = true;
      })
    : Promise.resolve();
  helpPromise
    .then(() => program.parseAsync(process.argv))
    .then(closeDbIfOpen)
    .catch(fail);
}
