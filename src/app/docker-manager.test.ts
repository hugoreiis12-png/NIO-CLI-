import { describe, expect, test } from 'bun:test';
import {
  buildDebugPrompt,
  buildOrquestPrompt,
  buildClusterPrompt,
  parseServicesLine,
  parseStackServices,
  parseScaleArg,
  readClusterState,
  persistClusterState,
} from './docker-manager.js';
import type { Session } from '../core/types.js';
import type { SessionRepository } from '../core/repositories.js';
import type { ClusterState } from '../core/docker.js';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    userId: 1,
    name: 'app',
    profile: 'fullstack',
    status: 'active',
    projectPath: '/tmp/app',
    ide: 'vscode',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('prompt builders', () => {
  test('debug: inclui container, ps, logs, inspect (truncado)', () => {
    const p = buildDebugPrompt({ container: 'api', ps: 'PS', logs: 'LOGS', inspect: 'I'.repeat(9000) });
    expect(p).toContain('`api`');
    expect(p).toContain('PS');
    expect(p).toContain('LOGS');
    expect(p).toContain('docker ps -a');
    expect(p.length).toBeLessThan(9000); // inspect truncado a 6000
  });
  test('orquest: dry-run muda a instrução final', () => {
    expect(buildOrquestPrompt('sobe api', '/p', true)).toContain('NÃO rode `up`');
    expect(buildOrquestPrompt('sobe api', '/p', false)).toContain('docker compose up -d');
  });
  test('cluster: pede a linha SERVICES: e stack deploy', () => {
    const p = buildClusterPrompt('api + worker', '/p');
    expect(p).toContain('nio-cluster');
    expect(p).toContain('SERVICES:');
    expect(p).toContain('docker stack deploy');
  });
});

describe('parsers', () => {
  test('parseServicesLine', () => {
    expect(parseServicesLine('bla\nSERVICES: a, b ,c\nbla')).toEqual(['a', 'b', 'c']);
    expect(parseServicesLine('sem linha')).toEqual([]);
  });
  test('parseStackServices (Name\\tReplicas)', () => {
    expect(parseStackServices('nio-cluster_api\t3/3\nnio-cluster_redis\t1/1\n')).toEqual([
      { name: 'nio-cluster_api', replicas: '3/3' },
      { name: 'nio-cluster_redis', replicas: '1/1' },
    ]);
  });
  test('parseScaleArg', () => {
    expect(parseScaleArg('api=3')).toEqual({ service: 'api', replicas: 3 });
    expect(parseScaleArg('api')).toBeNull();
    expect(parseScaleArg('api=x')).toBeNull();
  });
});

describe('cluster state em config.extra.docker', () => {
  const st: ClusterState = { stack: 'nio-cluster', services: ['a'], composePath: 'x', deployedAt: 't' };

  test('read: ausente → null; presente → objeto', () => {
    expect(readClusterState(session())).toBeNull();
    expect(readClusterState(session({ config: { extra: { docker: { cluster: st } } } }))).toEqual(st);
  });

  test('persist: funde sem apagar outros campos de extra; null limpa', async () => {
    const calls: unknown[] = [];
    const repo = { updateConfig: async (_id: string, cfg: unknown) => void calls.push(cfg) } as unknown as SessionRepository;
    const s = session({ config: { languages: ['ts'], extra: { recipe: 'r', docker: { foo: 1 } } } });

    await persistClusterState(repo, s, st);
    expect(calls[0]).toEqual({
      languages: ['ts'],
      extra: { recipe: 'r', docker: { foo: 1, cluster: st } },
    });

    await persistClusterState(repo, s, null);
    expect(calls[1]).toEqual({ languages: ['ts'], extra: { recipe: 'r', docker: { foo: 1 } } });
  });
});
