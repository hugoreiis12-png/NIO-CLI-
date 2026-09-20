/*
 * Disponibilidade/health da camada Docker da NIO-CLI — detecção do `docker` no
 * host, estado do Swarm, e checagem TCP dos containers de infra. Config/URLs
 * ficam em `./config.ts`.
 */
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { isBinaryInstalled } from '../clients/client-install.js';
import { DOCKER_MCP_PORT, PORTAINER_PORT } from './config.js';

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
