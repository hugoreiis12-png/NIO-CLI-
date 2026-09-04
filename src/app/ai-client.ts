/**
 * Client de IA — Headroom (best-effort, ADR 0007+0009) + OpenCode. `ensureHeadroomAndWire`
 * resolve o `baseURL` do provider em 3 níveis e grava no `opencode.json` (reusado pela TUI):
 *   1. REMOTO — `NIO_HEADROOM_URL` setado → usa o Headroom compartilhado, sem Docker local.
 *   2. LOCAL  — senão, com Docker → sobe o container local.
 *   3. DIRETO — senão → NÃO bloqueia: aponta direto no LLM upstream (sem compressão), com aviso.
 * `launchAiClient` é **headless** (`opencode run`, pro `nio docker …`); o interativo é `launchNioTui`.
 */
import { spawn } from 'node:child_process';
import { ensureHeadroomRunning, HEADROOM_URL, HEADROOM_UPSTREAM, type HeadroomEnsureResult } from '../lib/headroom.js';
import { installOpencodeGlobal, NIO_OPERATOR_MODEL } from '../lib/clients/client-configs.js';
import { isBinaryInstalled } from '../lib/clients/client-install.js';
import { env } from '../brand.js';
import { c, sym } from '../lib/colors.js';
import { dlog } from '../lib/debug.js';

/**
 * @deprecated Desde a ADR 0009 o Headroom é best-effort — `ensureHeadroomAndWire`
 * degrada pro modo `direct` em vez de lançar. Mantido só pra compat dos catches.
 */
export class HeadroomRequiredError extends Error {
  constructor(detail: string) {
    super(`Headroom é obrigatório pro client de IA (ADR 0007). ${detail}`);
    this.name = 'HeadroomRequiredError';
  }
}

/** Como o baseURL do provider foi resolvido. */
export type HeadroomMode = 'remote' | 'local' | 'direct';

/** Seams pra teste. Default = implementações reais. */
export interface LaunchAiDeps {
  ensureHeadroom?: () => Promise<HeadroomEnsureResult>;
  spawnFn?: typeof spawn;
  isInstalled?: (bin: string) => boolean;
}

/** Grava `provider.opencode.options.baseURL` no opencode.json (best-effort). */
function wireBaseUrl(baseUrl: string): void {
  try {
    installOpencodeGlobal([], undefined, baseUrl);
    dlog('opencode.json: provider.opencode.options.baseURL =', baseUrl);
  } catch (err) {
    console.warn(`  ${c.yellow(sym.warn)} não gravei o baseURL no opencode.json: ${(err as Error).message}`);
  }
}

/**
 * Resolve o Headroom em 3 níveis (remoto → local → direto) e grava o `baseURL`.
 * **Nunca bloqueia** (ADR 0009): sem Docker e sem Headroom remoto, degrada pro modo
 * `direct` (aponta o OpenCode direto no LLM, sem compressão) com aviso. Devolve o modo.
 */
export async function ensureHeadroomAndWire(
  ensure: () => Promise<HeadroomEnsureResult> = ensureHeadroomRunning,
): Promise<HeadroomMode> {
  // 1. REMOTO — NIO_HEADROOM_URL setado explicitamente → usa esse, sem Docker local.
  if (env('HEADROOM_URL')?.trim()) {
    console.log(`  ${c.green(sym.ok)} Headroom remoto (${HEADROOM_URL}).`);
    wireBaseUrl(HEADROOM_URL);
    return 'remote';
  }

  // 2. LOCAL — tenta subir o container (precisa de Docker).
  const h = await ensure();
  if (h.ok) {
    if (h.started) console.log(`  ${c.green(sym.ok)} Headroom no ar (${HEADROOM_URL}).`);
    wireBaseUrl(HEADROOM_URL);
    return 'local';
  }

  // 3. DIRETO (fallback) — sem Docker/Headroom → NÃO bloqueia, aponta direto no LLM.
  console.warn(
    `  ${c.yellow(sym.warn)} Headroom indisponível (${h.error ?? 'sem Docker'}) — seguindo SEM compressão de contexto.\n` +
      `  ${c.dim('O cliente aponta direto no LLM. Pra ter compressão sem Docker local, defina ')}` +
      `${c.cyan('NIO_HEADROOM_URL')}${c.dim(' pro Headroom compartilhado do time.')}`,
  );
  wireBaseUrl(HEADROOM_UPSTREAM);
  return 'direct';
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
