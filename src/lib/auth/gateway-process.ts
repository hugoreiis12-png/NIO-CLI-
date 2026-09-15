/**
 * Liveness e auto-start do `nio-gateway`. A esteira (`onboarding.ts`) e o
 * `nio login` sobem o gateway sozinhos quando ele está fora do ar, em vez de
 * mandar o usuário abrir outra janela. Deixa o processo rodando (é serviço).
 */
import { spawnSync } from 'node:child_process';
import { spawnPortable } from '../proc.js';
import { existsSync, openSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { GATEWAY_PORT, GATEWAY_URL } from '../../gateway/config.js';
import { VERSION, semverGt } from '../../version.js';
import { homePath } from '../../brand.js';
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

/** `true` se a URL é o gateway local — único caso em que subir algo sozinho faz sentido. */
export function isLocalGatewayUrl(raw: string = GATEWAY_URL): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return false;
    const port = url.port ? Number(url.port) : 80;
    return port === GATEWAY_PORT;
  } catch {
    return false;
  }
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
 * Garante o gateway no ar: já responde → nada. URL remota fora do ar → reprova
 * sem tocar em nada local (subir container/host não alcançaria o remoto).
 * Só URL local tenta container do stack e, em último caso, fallback host.
 */
export async function ensureGatewayRunning(): Promise<GatewayEnsureResult> {
  const local = isLocalGatewayUrl();
  if (await gatewayHealth(local ? 1500 : 5000)) return { ok: true, started: false };
  if (!local) return { ok: false, started: false };

  const viaContainer = await tryContainerGateway();
  if (viaContainer === true) return { ok: true, started: true };

  // Fallback host: Docker ausente, o compose falhou, ou o container não respondeu.
  const command = resolveGatewayCommand();
  if (!command) return { ok: false, started: false };

  dlog(`subindo o gateway (host): ${command.cmd} ${command.args.join(' ')}`);
  // SP-1a (ADR 0012): stdout/stderr do gateway vão pra `~/.nio/gateway.log`, não
  // pro /dev/null — senão a trilha de auth (stderr) some no modo host.
  const logChild = openGatewayLog();
  // `spawnPortable`: no Windows os bins npm são shims `.cmd`/`.ps1` — `spawn`
  // cru dá ENOENT (crash com 'error' sem listener). O listener converte falha
  // de spawn em retorno graceful (o loop de /health só não acha nada).
  const child = spawnPortable(command.cmd, command.args, {
    detached: true,
    stdio: logChild ? ['ignore', logChild, logChild] : 'ignore',
  });
  let spawnFailed = false;
  child.on('error', (err) => {
    dlog(`spawn do gateway falhou: ${(err as Error).message}`);
    spawnFailed = true;
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    if (spawnFailed) break;
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

/** fd de append pra `~/.nio/gateway.log` (chmod 600), ou `null` se não deu. */
function openGatewayLog(): number | null {
  try {
    const file = homePath('gateway.log');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    return openSync(file, 'a', 0o600);
  } catch {
    return null;
  }
}

export interface GatewayVersionSkew {
  status: 'ok' | 'warn' | 'block';
  detail?: string;
}

/** Distância entre releases, ignorando sufixo: mesma, patch, minor ou major. */
export function releaseDrift(a: string, b: string): 'same' | 'patch' | 'minor' | 'major' {
  const pa = a.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  if ((pa[0] ?? 0) !== (pb[0] ?? 0)) return 'major';
  if ((pa[1] ?? 0) !== (pb[1] ?? 0)) return 'minor';
  if ((pa[2] ?? 0) !== (pb[2] ?? 0)) return 'patch';
  return 'same';
}

/** Lê `GET <base>/health` e classifica a deriva CLI×gateway (pura a partir do JSON). */
export function classifyGatewayVersion(cliVersion: string, body: unknown): GatewayVersionSkew {
  const gw = typeof (body as { version?: unknown })?.version === 'string' && (body as { version: string }).version;
  if (!gw) return { status: 'warn', detail: 'gateway não informa versão (anterior ao skew-check?) — se der 404 em rota válida, atualize o gateway' };
  const drift = releaseDrift(cliVersion, gw);
  if (drift === 'same' || drift === 'patch') {
    return drift === 'same' ? { status: 'ok' } : { status: 'warn', detail: `CLI ${cliVersion} x gateway ${gw} (só patch) — alinhe quando puder` };
  }
  if (semverGt(cliVersion, gw)) {
    return { status: 'block', detail: `CLI ${cliVersion} fala com gateway ${gw} — rotas podem faltar (ex.: 404 'rota desconhecida'). Atualize o gateway (rebuild do container / imagem GHCR) ou aponte NIO_GATEWAY_URL para um atual.` };
  }
  return { status: 'warn', detail: `gateway ${gw} mais novo que a CLI ${cliVersion} — atualize a CLI quando puder` };
}

/** Busca a versão no `/health` e classifica; qualquer falha de rede vira `warn` (o health já passou). */
export async function checkGatewayVersion(baseUrl: string = GATEWAY_URL, timeoutMs = 3000): Promise<GatewayVersionSkew> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: ctrl.signal });
    if (!res.ok) return { status: 'warn', detail: `gateway respondeu ${res.status} no /health` };
    return classifyGatewayVersion(VERSION, await res.json().catch(() => ({})));
  } catch (err) {
    return { status: 'warn', detail: `não deu para ler a versão do gateway (${(err as Error).message ?? err})` };
  } finally {
    clearTimeout(timer);
  }
}
