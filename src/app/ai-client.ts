/**
 * `launchAiClient` — ponto único de "subir o client de IA". Sobe o Headroom
 * (obrigatório, ADR 0007), aponta o `baseURL` do provider do OpenCode pra ele, e
 * entrega o terminal pro `opencode`. Usado pelo `nio ai`, pelo handoff do
 * `nio init` e pelo `runOperator` (headless) do `nio docker`.
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

export interface LaunchAiOptions {
  cwd: string;
  /** Com `prompt` → headless (`opencode run`); sem → TUI interativa. */
  prompt?: string;
}

/** Seams pra teste. Default = implementações reais. */
export interface LaunchAiDeps {
  ensureHeadroom?: () => Promise<HeadroomEnsureResult>;
  spawnFn?: typeof spawn;
  isInstalled?: (bin: string) => boolean;
}

/** Sobe o Headroom e grava o `baseURL` no opencode.json. Lança se o Headroom falhar. */
async function prepareHeadroom(ensure: () => Promise<HeadroomEnsureResult>): Promise<void> {
  const h = await ensure();
  if (!h.ok) throw new HeadroomRequiredError(h.error ?? 'não consegui subir o Headroom.');
  if (h.started) console.log(`  ${c.green(sym.ok)} Headroom no ar (${HEADROOM_URL}).`);
  try {
    installOpencodeGlobal([], undefined, HEADROOM_URL);
    dlog('opencode.json: provider.opencode.options.baseURL =', HEADROOM_URL);
  } catch (err) {
    console.warn(
      `  ${c.yellow(sym.warn)} não gravei o baseURL no opencode.json: ${(err as Error).message}`,
    );
  }
}

export async function launchAiClient(opts: LaunchAiOptions, deps: LaunchAiDeps = {}): Promise<number> {
  const spawnFn = deps.spawnFn ?? spawn;
  const isInstalled = deps.isInstalled ?? isBinaryInstalled;

  await prepareHeadroom(deps.ensureHeadroom ?? ensureHeadroomRunning);

  if (!isInstalled('opencode')) {
    console.log(
      `  ${c.yellow(sym.warn)} OpenCode não está no PATH. Instale com \`npm i -g opencode-ai\` e rode \`nio ai\`.`,
    );
    return 127;
  }

  const args = opts.prompt ? ['run', '--model', NIO_OPERATOR_MODEL, opts.prompt] : [];
  return new Promise((resolve) => {
    const child = spawnFn('opencode', args, { stdio: 'inherit', cwd: opts.cwd });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      console.error(`[erro] Falha ao iniciar o OpenCode: ${err.message}`);
      resolve(127);
    });
  });
}
