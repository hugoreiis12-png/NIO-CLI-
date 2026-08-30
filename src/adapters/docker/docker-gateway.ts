/**
 * Adapter `docker` — implementa o `DockerGateway` (`core/docker.ts`) via o CLI
 * `docker` (`spawnSync` SEM shell, args em array). Nunca lança (contrato do
 * port): falha de spawn / exit != 0 → `DockerResult`; `docker` ausente → `unavailable`.
 */
import { spawnSync } from 'node:child_process';
import { dockerAvailable, swarmActive, unreachableDocker } from '../../lib/docker.js';
import type {
  ComposeAction,
  ComposeOptions,
  DockerGateway,
  DockerResult,
  RunSpec,
} from '../../core/docker.js';

// ─── Arg-builders puros (exportados — testados com deep-equal) ─────────

function fileFlag(file?: string): string[] {
  return file ? ['-f', file] : [];
}

/** `docker <...>` pra um `nio docker compose <action>`. */
export function composeArgs(action: ComposeAction, opts: ComposeOptions = {}): string[] {
  const base = ['compose', ...fileFlag(opts.file), action];
  switch (action) {
    case 'up':
      return [...base, ...(opts.detach === false ? [] : ['-d']), ...(opts.build ? ['--build'] : [])];
    case 'logs':
      return [
        ...base,
        ...(opts.tail ? ['--tail', String(opts.tail)] : []),
        ...(opts.service ? [opts.service] : []),
      ];
    case 'restart':
      return [...base, ...(opts.service ? [opts.service] : [])];
    default:
      return base; // down | ps
  }
}

/** `docker run …` pra um `nio docker create`. */
export function runArgs(spec: RunSpec): string[] {
  return [
    'run',
    ...(spec.detach ? ['-d'] : []),
    ...(spec.name ? ['--name', spec.name] : []),
    ...(spec.ports ?? []).flatMap((p) => ['-p', p]),
    ...Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    ...(spec.volumes ?? []).flatMap((v) => ['-v', v]),
    spec.image,
    ...(spec.cmd ?? []),
  ];
}

/** `docker stack deploy -c <composePath> <name>`. */
export function stackDeployArgs(name: string, composePath: string): string[] {
  return ['stack', 'deploy', '-c', composePath, name];
}

/** `docker service scale <service>=<replicas>`. */
export function serviceScaleArgs(service: string, replicas: number): string[] {
  return ['service', 'scale', `${service}=${replicas}`];
}

// ─── Execução ────────────────────────────────────────────────────────

/** Roda `docker <args>`. `capture` = pega stdout (pra parsear); senão herda o terminal. */
function exec(args: string[], capture: boolean): DockerResult {
  if (!dockerAvailable()) {
    return { status: 'unavailable', error: unreachableDocker().message };
  }
  const res = capture
    ? spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 })
    : spawnSync('docker', args, { stdio: 'inherit' });

  if (res.error) return { status: 'failed', exitCode: null, error: res.error.message };
  if (res.status !== 0) {
    const detail = capture
      ? ((res.stderr as string) || (res.stdout as string) || '').trim()
      : '';
    return {
      status: 'failed',
      exitCode: res.status,
      error: detail || `docker saiu com código ${res.status}`,
    };
  }
  const out = capture ? (((res.stdout as string) ?? '') + ((res.stderr as string) ?? '')).trim() : undefined;
  return { status: 'ok', exitCode: 0, ...(out !== undefined ? { stdout: out } : {}) };
}

export function createDockerGateway(): DockerGateway {
  return {
    async compose(action: ComposeAction, opts: ComposeOptions = {}) {
      const capture = action === 'ps' || action === 'logs';
      return exec(composeArgs(action, opts), capture);
    },
    async run(spec: RunSpec) {
      return exec(runArgs(spec), false);
    },
    async ps(all = false) {
      return exec(['ps', ...(all ? ['-a'] : [])], true);
    },
    async logs(ref: string, tail?: number) {
      return exec(['logs', ...(tail ? ['--tail', String(tail)] : []), ref], true);
    },
    async inspect(ref: string) {
      return exec(['inspect', ref], true);
    },
    async swarmInit() {
      if (swarmActive()) return { status: 'ok', exitCode: 0 };
      return exec(['swarm', 'init'], false);
    },
    async stackDeploy(name: string, composePath: string) {
      return exec(stackDeployArgs(name, composePath), false);
    },
    async stackRm(name: string) {
      return exec(['stack', 'rm', name], false);
    },
    async stackServices(name: string) {
      return exec(['stack', 'services', name, '--format', '{{.Name}}\t{{.Replicas}}'], true);
    },
    async serviceScale(service: string, replicas: number) {
      return exec(serviceScaleArgs(service, replicas), false);
    },
  };
}
