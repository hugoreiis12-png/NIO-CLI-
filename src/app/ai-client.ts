/**
 * Client de IA — OpenCode DIRETO. O **Headroom foi DESATIVADO** (decisão pós-mapeamento
 * 2026-09-04 — amenda ADR 0007+0009): o client fala direto no OpenCode Zen, sem proxy de
 * compressão. `ensureHeadroomAndWire` só garante o `opencode.json` pronto — provider
 * `opencode` **sem** baseURL (direto) + o model default (`big-pickle`) + os MCPs —, sem
 * subir container nem usar `NIO_HEADROOM_URL`. `launchAiClient` é **headless**
 * (`opencode run`, pro `nio docker …`); o interativo é `launchNioTui`.
 */
import { spawn } from 'node:child_process';
import { installOpencodeGlobal, NIO_OPERATOR_MODEL } from '../lib/clients/client-configs.js';
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
 * `opencode` **sem** baseURL (direto no OpenCode Zen — Headroom desativado) + model
 * default + MCPs. `installOpencodeGlobal` sem `headroomUrl` já **limpa** qualquer
 * baseURL de Headroom que tenha sobrado. Nunca bloqueia.
 */
export async function ensureHeadroomAndWire(): Promise<void> {
  try {
    installOpencodeGlobal([]); // sem headroomUrl → provider direto (sem baseURL) + model
    dlog('opencode.json: provider direto (Headroom desativado), model =', NIO_OPERATOR_MODEL);
  } catch (err) {
    console.warn(`  ${c.yellow(sym.warn)} não gravei o opencode.json: ${(err as Error).message}`);
  }
}

/** Operador headless (`opencode run --model … "<prompt>"`). Resolve com o exit code. */
export async function launchAiClient(
  opts: { cwd: string; prompt: string },
  deps: LaunchAiDeps = {},
): Promise<number> {
  const spawnFn = deps.spawnFn ?? spawn;
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
