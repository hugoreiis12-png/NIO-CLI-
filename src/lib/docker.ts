/**
 * Camada Docker da NIO-CLI — config, URLs e health dos serviços de infra
 * (`docker/docker-compose.yml`: Docker MCP Gateway + Portainer) e detecção do
 * `docker` no host. Espelha `src/gateway/config.ts` + `src/lib/gateway-client.ts`.
 */
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { env } from '../brand.js';
import { isBinaryInstalled } from './client-install.js';

/** Porta do Docker MCP Gateway (loopback only). `NIO_DOCKER_MCP_PORT`, default 8811. */
export const DOCKER_MCP_PORT = Number(env('DOCKER_MCP_PORT')?.trim()) || 8811;

/** Endpoint MCP do gateway (transport `streaming` → path `/mcp`). Override total via `NIO_DOCKER_MCP_URL`. */
export const DOCKER_MCP_URL =
  env('DOCKER_MCP_URL')?.trim() || `http://127.0.0.1:${DOCKER_MCP_PORT}/mcp`;

/** Porta HTTPS do Portainer. `NIO_PORTAINER_PORT`, default 9443. */
export const PORTAINER_PORT = Number(env('PORTAINER_PORT')?.trim()) || 9443;

/** URL do Portainer. Override total via `NIO_PORTAINER_URL`. */
export const PORTAINER_URL =
  env('PORTAINER_URL')?.trim() || `https://127.0.0.1:${PORTAINER_PORT}`;

/** Nome da stack do `nio docker cluster` (Swarm). */
export const CLUSTER_STACK = 'nio-cluster';

/** `docker/docker-compose.yml` do repo — infra NIO (gateway + portainer). Constante, não entrada do usuário. */
export function infraComposePath(): string {
  // Este arquivo compila pra `dist/lib/docker.js`; a raiz do pacote é dois níveis acima.
  return join(fileURLToPath(new URL('../..', import.meta.url)), 'docker', 'docker-compose.yml');
}

/**
 * `docker` está no PATH e o subcomando `compose` (v2) funciona? A camada Docker
 * inteira depende disso — cada comando checa antes de agir.
 */
export function dockerAvailable(): boolean {
  if (!isBinaryInstalled('docker')) return false;
  const res = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', timeout: 5000 });
  return !res.error && res.status === 0;
}

/** O Swarm deste host está ativo? (`docker info` → `Swarm: active`). */
export function swarmActive(): boolean {
  const res = spawnSync('docker', ['info', '--format', '{{.Swarm.LocalNodeState}}'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return !res.error && res.status === 0 && res.stdout.trim() === 'active';
}

/** Mensagem acionável quando o `docker` não está utilizável. */
export function unreachableDocker(): Error {
  return new Error(
    'Docker não encontrado (ou `docker compose` indisponível). Instale o Docker Engine/Desktop ' +
      'e confirme com `docker compose version` antes de usar `nio docker`.',
  );
}

/**
 * Algo escutando em `127.0.0.1:<port>`? Checagem TCP pura — não faz HTTP nem TLS
 * (o Portainer usa cert self-signed; o gateway é HTTP simples). É o suficiente
 * pra "o container subiu".
 */
export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2000 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** O Docker MCP Gateway (container `nio-mcp-gateway`) subiu? */
export function mcpGatewayHealthy(): Promise<boolean> {
  return portOpen(DOCKER_MCP_PORT);
}

/** O Portainer (container `nio-portainer`) subiu? */
export function portainerHealthy(): Promise<boolean> {
  return portOpen(PORTAINER_PORT);
}
