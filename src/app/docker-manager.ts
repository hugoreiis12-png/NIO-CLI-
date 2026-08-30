/**
 * App layer da camada Docker — monta o prompt e entrega a tarefa pro operador de
 * IA (`opencode run` headless, tools do Docker MCP Gateway). Só `debug`/`orquest`/
 * `cluster` (compose/create são wrapper determinístico). Ver ARQUITETURA-DOCKER.md.
 */
import { spawn } from 'node:child_process';
import { NIO_OPERATOR_MODEL } from '../lib/client-configs.js';
import { CLUSTER_STACK } from '../lib/docker.js';
import type { ClusterState, DockerGateway } from '../core/docker.js';
import type { Session } from '../core/types.js';
import type { SessionRepository } from '../core/repositories.js';

/** Contexto coletado de um container problemático — vira parte do prompt do `debug`. */
export interface DebugContext {
  container: string;
  ps: string;
  logs: string;
  inspect: string;
}

const PREAMBLE = [
  'Você é o operador de infra Docker desta máquina.',
  'Use as tools MCP do server `docker` (docker/compose/swarm) pra INSPECIONAR e AGIR.',
  'Explique cada passo em pt-BR, de forma curta. Não invente comandos — use as tools.',
].join('\n');

/** Prompt do `nio docker debug`. */
export function buildDebugPrompt(ctx: DebugContext): string {
  return [
    PREAMBLE,
    '',
    `Investigue por que o container \`${ctx.container}\` falhou/está com problema e proponha a correção.`,
    'Se a correção for segura e óbvia, aplique-a via tools; senão, descreva o comando exato.',
    '',
    '--- docker ps -a ---',
    ctx.ps,
    '',
    `--- docker logs ${ctx.container} (tail) ---`,
    ctx.logs,
    '',
    `--- docker inspect ${ctx.container} (resumo) ---`,
    ctx.inspect.slice(0, 6000),
  ].join('\n');
}

/** Prompt do `nio docker orquest`. `dryRun` → só gera o compose, não aplica. */
export function buildOrquestPrompt(instruction: string, projectPath: string, dryRun: boolean): string {
  return [
    PREAMBLE,
    '',
    `Projeto: ${projectPath}`,
    `Tarefa: ${instruction}`,
    '',
    dryRun
      ? 'Gere/atualize o `docker-compose.yml` do projeto conforme a tarefa e MOSTRE o conteúdo final. NÃO rode `up` (dry-run).'
      : 'Gere/atualize o `docker-compose.yml` do projeto e suba os serviços (`docker compose up -d`). Confirme o estado no fim.',
  ].join('\n');
}

/** Prompt do `nio docker cluster up` — Swarm stack. */
export function buildClusterPrompt(instruction: string, projectPath: string): string {
  return [
    PREAMBLE,
    '',
    `Projeto: ${projectPath}`,
    `Tarefa: montar um cluster Docker Swarm (stack \`${CLUSTER_STACK}\`) — ${instruction}`,
    '',
    `1. Garanta o Swarm ativo (\`docker swarm init\` se preciso).`,
    `2. Gere um compose file de stack (versão 3.x, com \`deploy:\` — replicas, restart_policy) cobrindo os N serviços/apps pedidos.`,
    `3. \`docker stack deploy -c <arquivo> ${CLUSTER_STACK}\`.`,
    `4. Confirme com \`docker stack services ${CLUSTER_STACK}\` e reporte a lista de serviços (nomes exatos) e réplicas.`,
    '',
    'IMPORTANTE: no fim, imprima uma linha `SERVICES: a,b,c` com os nomes dos serviços criados (a NIO persiste isso).',
  ].join('\n');
}

/** `SERVICES: a, b, c` na saída do operador → `["a","b","c"]`. */
export function parseServicesLine(output: string): string[] {
  const m = /^\s*SERVICES:\s*(.+)$/im.exec(output);
  if (!m) return [];
  return m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Entrega o prompt pro operador (`opencode run`). `stdio: 'inherit'` — o usuário
 * acompanha ao vivo. Resolve com o exit code. Nunca lança.
 */
export function runOperator(
  prompt: string,
  opts: { cwd?: string; spawnFn?: typeof spawn } = {},
): Promise<number> {
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise((resolve) => {
    const child = spawnFn(
      'opencode',
      ['run', '--model', NIO_OPERATOR_MODEL, prompt],
      { stdio: 'inherit', cwd: opts.cwd },
    );
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(127));
  });
}

// ─── cluster (Swarm) ─────────────────────────────────────────────────

/** Saída de `docker stack services … --format '{{.Name}}\t{{.Replicas}}'` → `[{name, replicas}]`. */
export function parseStackServices(stdout: string): { name: string; replicas: string }[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, replicas = ''] = l.split('\t');
      return { name: name!.trim(), replicas: replicas.trim() };
    });
}

/** `"api=3"` → `{ service: 'api', replicas: 3 }`, ou `null` se malformado. */
export function parseScaleArg(arg: string): { service: string; replicas: number } | null {
  const m = /^([A-Za-z0-9_.-]+)=(\d+)$/.exec(arg.trim());
  if (!m) return null;
  return { service: m[1]!, replicas: Number(m[2]) };
}

/** Estado de cluster persistido em `sessions.config.extra.docker.cluster`. */
export function readClusterState(session: Session): ClusterState | null {
  const extra = session.config.extra as { docker?: { cluster?: ClusterState } } | undefined;
  return extra?.docker?.cluster ?? null;
}

/** Persiste (ou limpa, com `null`) o estado do cluster no `sessions.config`. */
export async function persistClusterState(
  repo: SessionRepository,
  session: Session,
  state: ClusterState | null,
): Promise<void> {
  const extra: Record<string, unknown> = { ...(session.config.extra ?? {}) };
  const docker: Record<string, unknown> = { ...((extra.docker as Record<string, unknown>) ?? {}) };
  if (state) docker.cluster = state;
  else delete docker.cluster;
  extra.docker = docker;
  await repo.updateConfig(session.id, { ...session.config, extra });
}

/** Coleta o contexto de um container pro `debug` (best-effort — campos vazios se falhar). */
export async function collectDebugContext(
  gateway: DockerGateway,
  container: string,
): Promise<DebugContext> {
  const [ps, logs, inspect] = await Promise.all([
    gateway.ps(true),
    gateway.logs(container, 200),
    gateway.inspect(container),
  ]);
  return {
    container,
    ps: ps.stdout ?? ps.error ?? '',
    logs: logs.stdout ?? logs.error ?? '',
    inspect: inspect.stdout ?? inspect.error ?? '',
  };
}
