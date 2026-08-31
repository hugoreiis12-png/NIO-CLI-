/**
 * Client de IA — Headroom (obrigatório, ADR 0007) + OpenCode. `ensureHeadroomAndWire`
 * sobe o Headroom e grava o `baseURL` no `opencode.json` (reusado pela TUI).
 * `launchAiClient` é **headless** (`opencode run`, pro `nio docker …`); o interativo é `launchNioTui`.
 */
import { spawn } from 'node:child_process';
import { ensureHeadroomRunning, HEADROOM_URL, type HeadroomEnsureResult } from '../lib/headroom.js';
import { installOpencodeGlobal, NIO_OPERATOR_MODEL } from '../lib/clients/client-configs.js';
import { isBinaryInstalled } from '../lib/clients/client-install.js';
import { c, sym } from '../lib/colors.js';
import { dlog } from '../lib/debug.js';

/** Headroom não subiu — o client de IA não pode iniciar sem ele. */
export class HeadroomRequiredError extends Error {
  constructor(detail: string) {
    super(`Headroom é obrigatório pro client de IA (ADR 0007). ${detail}`);
    this.name = 'HeadroomRequiredError';
  }
}

/** Seams pra teste. Default = implementações reais. */
export interface LaunchAiDeps {
  ensureHeadroom?: () => Promise<HeadroomEnsureResult>;
  spawnFn?: typeof spawn;
  isInstalled?: (bin: string) => boolean;
}

/**
 * Sobe o Headroom e aponta o `provider.opencode.options.baseURL` do `opencode.json`
 * pra ele. Lança `HeadroomRequiredError` se o Headroom não sobe.
 */
export async function ensureHeadroomAndWire(
  ensure: () => Promise<HeadroomEnsureResult> = ensureHeadroomRunning,
): Promise<void> {
  const h = await ensure();
  if (!h.ok) throw new HeadroomRequiredError(h.error ?? 'não consegui subir o Headroom.');
  if (h.started) console.log(`  ${c.green(sym.ok)} Headroom no ar (${HEADROOM_URL}).`);
  try {
    installOpencodeGlobal([], undefined, HEADROOM_URL);
    dlog('opencode.json: provider.opencode.options.baseURL =', HEADROOM_URL);
  } catch (err) {
    console.warn(`  ${c.yellow(sym.warn)} não gravei o baseURL no opencode.json: ${(err as Error).message}`);
  }
}

/** Operador headless (`opencode run --model … "<prompt>"`). Resolve com o exit code. */
export async function launchAiClient(
  opts: { cwd: string; prompt: string },
  deps: LaunchAiDeps = {},
): Promise<number> {
  const spawnFn = deps.spawnFn ?? spawn;
  const isInstalled = deps.isInstalled ?? isBinaryInstalled;

  await ensureHeadroomAndWire(deps.ensureHeadroom);

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
