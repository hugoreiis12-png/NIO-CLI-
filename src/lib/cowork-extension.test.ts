import { test, expect } from 'bun:test';
import { buildCoworkManifest } from './cowork-extension.js';
import { toolDefinitions } from '../tools/index.js';
import { VERSION } from '../version.js';

// Caracterização de buildCoworkManifest ANTES da extração dos helpers de
// tools/server/user_config — pina a forma exata do manifest MCPB atual.

test('metadados fixos do manifest', () => {
  const manifest = buildCoworkManifest();
  expect(manifest.manifest_version).toBe('0.2');
  expect(manifest.name).toBe('nio-cli');
  expect(manifest.display_name).toBe('nio (NOS)');
  expect(manifest.version).toBe(VERSION);
  expect(manifest.homepage).toBe('https://github.com/hugoreiis12-png/NIO-CLI#readme');
  expect(manifest.documentation).toBe('https://github.com/hugoreiis12-png/NIO-CLI#readme');
  expect(manifest.support).toBe('https://github.com/hugoreiis12-png/NIO-CLI/issues');
  expect(manifest.author).toEqual({ name: 'Falcao-Tech', url: 'https://github.com/hugoreiis12-png' });
  expect(manifest.keywords).toEqual(['mcp', 'nio', 'nos', 'tasks', 'kanban', 'time-tracking']);
});

test('server.mcp_config aponta pro dist/mcp-server.js com env NIO_CLIENT=cowork', () => {
  const manifest = buildCoworkManifest() as { server: Record<string, unknown> };
  expect(manifest.server).toEqual({
    type: 'node',
    entry_point: 'dist/mcp-server.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/dist/mcp-server.js'],
      env: {
        NIO_PAT: '${user_config.pat}',
        NIO_PROJECT_ID: '${user_config.project_id}',
        NIO_REPOSITORY_ID: '${user_config.repository_id}',
        NIO_CLIENT: 'cowork',
      },
    },
  });
});

test('user_config.pat exige PAT sensível e obrigatório', () => {
  const manifest = buildCoworkManifest() as { user_config: Record<string, unknown> };
  const pat = manifest.user_config.pat as Record<string, unknown>;
  expect(pat.type).toBe('string');
  expect(pat.title).toBe('NOS Personal Access Token (PAT)');
  expect(pat.sensitive).toBe(true);
  expect(pat.required).toBe(true);
  expect(typeof pat.description).toBe('string');
  expect((pat.description as string).includes('nio_…')).toBe(true);
});

test('compatibility declara darwin/win32/linux e node >=20', () => {
  const manifest = buildCoworkManifest();
  expect(manifest.compatibility).toEqual({
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=20.0.0' },
  });
});

test('tools = toolDefinitions mapeados (nome + descrição normalizada, até 160 chars)', () => {
  const manifest = buildCoworkManifest() as { tools: { name: string; description: string }[] };
  const expected = toolDefinitions.map((t) => ({
    name: t.name,
    description: (t.description ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
  }));
  expect(manifest.tools).toEqual(expected);
  expect(manifest.tools.length).toBe(toolDefinitions.length);
  for (const t of manifest.tools) {
    expect(t.description.length).toBeLessThanOrEqual(160);
  }
});
