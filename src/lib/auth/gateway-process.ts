/**
 * Liveness e auto-start do `nio-gateway`. A esteira (`onboarding.ts`) e o
 * `nio login` sobem o gateway sozinhos quando ele está fora do ar, em vez de
 * mandar o usuário abrir outra janela. Deixa o processo rodando (é serviço).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { GATEWAY_URL } from '../../gateway/config.js';
import { isBinaryInstalled } from '../clients/client-install.js';
import { dockerAvailable, infraComposePath } from '../docker.js';
import { c, sym } from '../colors.js';
import { dlog } from '../debug.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `GET /health` do gateway. Qualquer erro/timeout/status != 200 → `false`. Nunca lança. */
export async function gatewayHealth(timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GATEWAY_URL}/health`, { signal: ctrl.signal });
    dlog(`gateway /health => ${res.status}`);
    return res.status === 200;
  } catch (err) {
    dlog(`gateway /health falhou: ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Como iniciar o `nio-gateway`: o `bin` do pacote se instalado, senão o
 * `gateway/index.{js,ts}` irmão do entrypoint atual (cobre `dist/` com node e
 * `src/` com bun). `null` = não achei como subir.
 */
export function resolveGatewayCommand(): { cmd: string; args: string[] } | null {
  if (isBinaryInstalled('nio-gateway')) return { cmd: 'nio-gateway', args: [] };
  const entry = process.argv[1];
  if (!entry) return null;
  const sibling = join(dirname(entry), 'gateway', basename(entry).endsWith('.ts') ? 'index.ts' : 'index.js');
  return existsSync(sibling) ? { cmd: process.execPath, args: [sibling] } : null;
}

export interface GatewayEnsureResult {
  ok: boolean;
  /** `true` se este processo subiu o gateway agora (vs. já estar no ar). */
  started: boolean;
}

/**
 * Sobe o serviço `nio-gateway` do stack unificado e espera o `/health` (~12s).
 * Só é chamado quando há Docker. Devolve `null` se não tentou (deixa o fallback
 * host agir), `true`/`false` conforme subiu ou não.
 */
async function tryContainerGateway(): Promise<boolean | null> {
  if (!dockerAvailable()) return null;
  dlog('subindo o gateway (container do stack): docker compose up -d nio-gateway');
  const res = spawnSync(
    'docker',
    ['compose', '-f', infraComposePath(), 'up', '-d', 'nio-gateway'],
    { stdio: 'ignore' },
  );
  if (res.status !== 0) {
    dlog('`docker compose up -d nio-gateway` saiu != 0 — tentando fallback host');
    return null;
  }
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await gatewayHealth()) {
      console.log(`  ${c.green(sym.ok)} nio-gateway no ar (container do stack)`);
      return true;
    }
  }
  dlog('o container subiu mas o /health não respondeu em ~12s — tentando fallback host');
  return null;
}

/**
 * Garante o gateway no ar: já responde → nada. Senão sobe o **container** do stack
 * (modelo unificado); se não há Docker (ou o container não respondeu), cai no
 * **fallback host** (spawn detached de `node dist/gateway/index.js`).
 */
export async function ensureGatewayRunning(): Promise<GatewayEnsureResult> {
  if (await gatewayHealth()) return { ok: true, started: false };

  const viaContainer = await tryContainerGateway();
  if (viaContainer === true) return { ok: true, started: true };

  // Fallback host: Docker ausente, o compose falhou, ou o container não respondeu.
  const command = resolveGatewayCommand();
  if (!command) return { ok: false, started: false };

  dlog(`subindo o gateway (host): ${command.cmd} ${command.args.join(' ')}`);
  const child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await gatewayHealth()) {
      console.log(
        `  ${c.green(sym.ok)} nio-gateway no ar (pid ${child.pid}) — ` +
          c.dim(`pare com \`kill ${child.pid}\` quando quiser`),
      );
      return { ok: true, started: true };
    }
  }
  child.kill();
  return { ok: false, started: false };
}
