/**
 * Client de IA — motor = **provider dedicado** (`NIO_AI_PROVIDER`, OpenAI-compatível)
 * falando DIRETO no backend (`NIO_AI_BASE_URL`). O provider `opencode` (Zen) NÃO é mais
 * o motor: fica no default dele (big-pickle), sem competência sobre a CLI — o OpenCode
 * vira só o runtime (serve/TUI/SDK). Headroom segue DORMENTE (ADR 0010).
 * `ensureHeadroomAndWire` só garante o `opencode.json` pronto (provider + model + MCPs).
 * `launchAiClient` é **headless** (`opencode run`, pro `nio docker …`); o interativo
 * é `launchNioTui`.
 */
import type { spawn } from 'node:child_process';
import { spawnPortable } from '../lib/proc.js';
import { installOpencodeGlobal, NIO_OPERATOR_MODEL, NIO_AI_BASE_URL } from '../lib/clients/client-configs.js';
import { isBinaryInstalled } from '../lib/clients/client-install.js';
import { c, sym } from '../lib/colors.js';
import { dlog } from '../lib/debug.js';

/**
 * @deprecated Headroom foi DESATIVADO — não é mais obrigatório nem usado, e
 * `ensureHeadroomAndWire` nunca lança. Mantido só pra compat dos `catch` antigos
 * (`ai.ts`/`docker-manager.ts`/`init/handoff.ts`), que viraram defensivos.
 */
export class HeadroomRequiredError extends Error {
  constructor(detail: string) {
    super(`Headroom desativado. ${detail}`);
    this.name = 'HeadroomRequiredError';
  }
}

/** Seams pra teste. Default = implementações reais. */
export interface LaunchAiDeps {
  spawnFn?: typeof spawn;
  isInstalled?: (bin: string) => boolean;
}

/**
 * Garante o `opencode.json` pronto pro client de IA (reusado pela TUI): provider
 * dedicado apontando pro `NIO_AI_BASE_URL` + model default + MCPs. O provider
 * `opencode` não é tocado. `installOpencodeGlobal` já semeia tudo. Nunca bloqueia.
 */
export async function ensureHeadroomAndWire(): Promise<void> {
  try {
    installOpencodeGlobal([]); // semeia o provider dedicado (NIO_AI_BASE_URL) + model + MCPs
    dlog('opencode.json: motor →', NIO_AI_BASE_URL, ', model =', NIO_OPERATOR_MODEL);
  } catch (err) {
    console.warn(`  ${c.yellow(sym.warn)} não gravei o opencode.json: ${(err as Error).message}`);
  }
}

/** Operador headless (`opencode run --model … "<prompt>"`). Resolve com o exit code. */
export async function launchAiClient(
  opts: { cwd: string; prompt: string },
  deps: LaunchAiDeps = {},
): Promise<number> {
  const spawnFn = deps.spawnFn ?? spawnPortable;
  const isInstalled = deps.isInstalled ?? isBinaryInstalled;

  await ensureHeadroomAndWire();

  if (!isInstalled('opencode')) {
    console.log(
      `  ${c.yellow(sym.warn)} OpenCode não está no PATH. Instale com \`npm i -g opencode-ai\`.`,
    );
    return 127;
  }

  return new Promise((resolve) => {
    const child = spawnFn(
      'opencode',
      ['run', '--model', NIO_OPERATOR_MODEL, opts.prompt],
      { stdio: 'inherit', cwd: opts.cwd },
    );
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      console.error(`[erro] Falha ao iniciar o OpenCode: ${err.message}`);
      resolve(127);
    });
  });
}
