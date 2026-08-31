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

const args = process.argv.slice(2);
const bare = args.length === 0;
const topHelp =
  bare || (args.length === 1 && (args[0] === "-h" || args[0] === "--help" || args[0] === "help"));

if (bare && process.stdout.isTTY && process.stdin.isTTY) {
  // `nio` sozinho num terminal → a esteira guiada (não o help).
  continueChain({ from: "cold" }).catch(fail);
} else {
  // `nio --help` / `nio | cat` / CI → animação (se topo) + help/comando do commander.
  const helpPromise = topHelp
    ? animateMatrixLogo().then(() => {
        logoShown = true;
      })
    : Promise.resolve();
  helpPromise.then(() => program.parseAsync(process.argv)).catch(fail);
}
