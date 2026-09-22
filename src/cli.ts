#!/usr/bin/env node
import "./lib/load-env.js";
import { DEBUG } from "./lib/debug.js";
import { animateMatrixLogo } from "./matrix-logo.js";
import { notifyCliIfUpdate } from "./lib/version-check.js";
import { buildProgram } from "./cli/program.js";
import { continueChain } from "./cli/flows/onboarding.js";
import { closeDbIfOpen, shutdown } from "./lib/shutdown.js";

/** Banner de update: só em TTY (humano), DEPOIS do output — fora do caminho quente. */
const maybeNotify = (): Promise<void> =>
  process.stdout.isTTY ? notifyCliIfUpdate() : Promise.resolve();

/**
 * Aquece o cache do repo NIO-SKILLS em background: import dinâmico (fora do
 * caminho quente do cold-start), fresco = no-op sem rede, stale/ausente = fetch
 * best-effort com timeout unref'd. Fire-and-forget, erro engolido — nunca bloqueia
 * nem quebra o start.
 */
const warmSkills = (): void => {
  void import("./lib/skills/skills-cache.js")
    .then((m) => m.ensureSkillsCache())
    .catch(() => {});
};

/** `--help` toca a animação antes; se já rolou, o `beforeAll` não redesenha. */
let logoShown = false;
const program = buildProgram(() => logoShown);

const fail = async (err: unknown): Promise<void> => {
  if (DEBUG) console.error(err);
  else console.error(`Erro: ${(err as Error).message}\n(rode com NIO_DEBUG=1 pro stack trace completo)`);
  await shutdown(1);
};

const args = process.argv.slice(2);
const bare = args.length === 0;
const topHelp =
  bare || (args.length === 1 && (args[0] === "-h" || args[0] === "--help" || args[0] === "help"));

if (bare && process.stdout.isTTY && process.stdin.isTTY) {
  // `nio` sozinho num terminal → a esteira guiada (não o help).
  warmSkills(); // background, paralelo à esteira — não bloqueia
  continueChain({ from: "cold" }).then(closeDbIfOpen).then(maybeNotify).catch(fail);
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
    .then(maybeNotify)
    .catch(fail);
}
