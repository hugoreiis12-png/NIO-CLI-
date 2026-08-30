/**
 * Domínio da camada Docker (v2) — port `DockerGateway` + vocabulário, sem IO
 * (regra do hexágono; impl em `src/adapters/docker/`). Contrato de erro igual ao
 * `ToolchainGateway`: nunca lança — falha → `DockerResult` `failed`/`unavailable`.
 */

/** Verbo de `nio docker compose` — wrapper determinístico sobre `docker compose`. */
export type ComposeAction = 'up' | 'down' | 'restart' | 'ps' | 'logs';

/** Verbo de `nio docker cluster` — Swarm (`docker stack …` / `docker service …`). */
export type ClusterAction = 'up' | 'down' | 'status' | 'scale';

/**
 * Resultado de qualquer operação do gateway: `ok` (saiu 0, `stdout` capturado),
 * `unavailable` (`docker`/`docker compose` inutilizável no host) ou `failed`
 * (rodou e saiu != 0, ou erro de spawn — `error` explica).
 */
export interface DockerResult {
  status: 'ok' | 'unavailable' | 'failed';
  /** Saída combinada (stdout+stderr) quando capturada; ausente em modo `inherit`. */
  stdout?: string;
  /** Código de saída do `docker`, quando houve processo. */
  exitCode?: number | null;
  error?: string;
}

/** Opções de `compose(action)`. */
export interface ComposeOptions {
  /** Caminho do compose file do projeto. Default resolvido pelo chamador (`./docker-compose.yml`). */
  file?: string;
  /** `-d` (só `up`). */
  detach?: boolean;
  /** `--build` (só `up`). */
  build?: boolean;
  /** Serviço alvo de `logs`/`restart`, ou `--tail` de `logs`. */
  service?: string;
  tail?: number;
}

/** Spec de `docker run` (montada pelo wizard de `nio docker create`). */
export interface RunSpec {
  image: string;
  name?: string;
  /** `["8080:80", "5432:5432"]`. */
  ports?: string[];
  /** `{ NODE_ENV: "dev" }`. */
  env?: Record<string, string>;
  /** `["./data:/data"]`. */
  volumes?: string[];
  detach?: boolean;
  /** Comando + args pra sobrescrever o CMD da imagem. */
  cmd?: string[];
}

/**
 * Operações Docker via `docker` CLI (`spawnSync`/`spawn` SEM shell — args sempre
 * em array). Nunca lança (ver contrato no topo).
 */
export interface DockerGateway {
  compose(action: ComposeAction, opts?: ComposeOptions): Promise<DockerResult>;
  run(spec: RunSpec): Promise<DockerResult>;

  /** `docker ps` (ou `-a`). */
  ps(all?: boolean): Promise<DockerResult>;
  /** `docker logs <ref> [--tail N]`. */
  logs(ref: string, tail?: number): Promise<DockerResult>;
  /** `docker inspect <ref>`. */
  inspect(ref: string): Promise<DockerResult>;

  /** `docker swarm init` (idempotente — `ok` se já ativo). */
  swarmInit(): Promise<DockerResult>;
  /** `docker stack deploy -c <composePath> <name>`. */
  stackDeploy(name: string, composePath: string): Promise<DockerResult>;
  /** `docker stack rm <name>`. */
  stackRm(name: string): Promise<DockerResult>;
  /** `docker stack services <name>` (capturado). */
  stackServices(name: string): Promise<DockerResult>;
  /** `docker service scale <service>=<replicas>`. */
  serviceScale(service: string, replicas: number): Promise<DockerResult>;
}

/**
 * Estado do cluster persistido em `sessions.config.extra.docker` (sem migration —
 * mesmo padrão do `config.extra.recipe`).
 */
export interface ClusterState {
  stack: string;
  services: string[];
  composePath: string;
  deployedAt: string;
}
