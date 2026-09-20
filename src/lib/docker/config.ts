/*
 * Config e URLs da camada Docker da NIO-CLI — infra (`docker/docker-compose.yml`:
 * Docker MCP Gateway + Portainer). Checagens de disponibilidade/health ficam em
 * `./health.ts`. Espelha `src/gateway/config.ts`.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { env } from '../../brand.js';

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
  // Este arquivo compila pra `dist/lib/docker/config.js`; a raiz do pacote é três níveis acima.
  return join(fileURLToPath(new URL('../../..', import.meta.url)), 'docker', 'docker-compose.yml');
}
