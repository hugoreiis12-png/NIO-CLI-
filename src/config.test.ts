import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProjectConfig,
  findProjectConfigPath,
  ensureGitignored,
  removeFromGitignore,
  USER_CONFIG_FILE,
} from './config.js';
import { brand } from './brand.js';

// Caracterização de loadProjectConfig/findProjectConfigPath ANTES da extração —
// pina o comportamento atual (mensagens, precedência, migração legada) para que
// o split em helpers não mude nada. Usa mkdtempSync(tmpdir()) como client-configs.test.ts.

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

let dir: string;
const ENV_KEYS = ['NIO_PROJECT_ID', 'NIO_REPOSITORY_ID'] as const;
let savedEnv: Record<string, string | undefined>;

function writeConfig(obj: unknown) {
  writeFileSync(join(dir, 'nio.json'), JSON.stringify(obj));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-cfg-'));
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('config válido: project_id + repository_id preservados', () => {
  writeConfig({ project_id: UUID_A, repository_id: UUID_B });
  expect(loadProjectConfig(dir)).toEqual({ project_id: UUID_A, repository_id: UUID_B });
});

test('sem nio.json em nenhum ancestral → null', () => {
  expect(loadProjectConfig(dir)).toBeNull();
});

test('project_id ausente → setup local válido (sem binding)', () => {
  // Auth pausada: um `nio init` sem credenciais grava só selection/ide, sem projeto.
  writeConfig({});
  expect(loadProjectConfig(dir)).toEqual({});
});

test('project_id não-UUID → erro (só valida formato quando presente)', () => {
  writeConfig({ project_id: 'not-a-uuid' });
  expect(() => loadProjectConfig(dir)).toThrow(
    'nio.json: campo "project_id", quando presente, deve ser um UUID válido.',
  );
});

test('repository_id como UUID → preservado', () => {
  writeConfig({ project_id: UUID_A, repository_id: UUID_B });
  expect(loadProjectConfig(dir)?.repository_id).toBe(UUID_B);
});

test('repository_id null → preservado como null', () => {
  writeConfig({ project_id: UUID_A, repository_id: null });
  expect(loadProjectConfig(dir)).toEqual({ project_id: UUID_A, repository_id: null });
});

test('repository_id ausente → chave não é setada no config', () => {
  writeConfig({ project_id: UUID_A });
  const config = loadProjectConfig(dir);
  expect(config).toEqual({ project_id: UUID_A });
  expect(config && 'repository_id' in config).toBe(false);
});

test('repository_id inválido (nem UUID nem null) → erro', () => {
  writeConfig({ project_id: UUID_A, repository_id: 'bad' });
  expect(() => loadProjectConfig(dir)).toThrow(
    'nio.json: campo "repository_id" deve ser UUID, null ou ausente.',
  );
});

test('NIO_PROJECT_ID tem precedência sobre o arquivo', () => {
  writeConfig({ project_id: UUID_A });
  process.env.NIO_PROJECT_ID = UUID_B;
  expect(loadProjectConfig(dir)).toEqual({ project_id: UUID_B });
});

test('env: project_id + repository_id juntos, sem arquivo', () => {
  process.env.NIO_PROJECT_ID = UUID_A;
  process.env.NIO_REPOSITORY_ID = UUID_B;
  expect(loadProjectConfig(dir)).toEqual({ project_id: UUID_A, repository_id: UUID_B });
});

test('NIO_PROJECT_ID inválido → erro específico do env', () => {
  process.env.NIO_PROJECT_ID = 'nope';
  expect(() => loadProjectConfig(dir)).toThrow('NIO_PROJECT_ID não é um UUID válido.');
});

test('NIO_REPOSITORY_ID inválido → erro específico do env', () => {
  process.env.NIO_PROJECT_ID = UUID_A;
  process.env.NIO_REPOSITORY_ID = 'nope';
  expect(() => loadProjectConfig(dir)).toThrow('NIO_REPOSITORY_ID deve ser um UUID válido.');
});

test('migração legada: sections+rules → selection unificada', () => {
  writeConfig({
    project_id: UUID_A,
    sections: { profiles: ['developer'], fields: ['backend'] },
    rules: { backend: 'node' },
  });
  expect(loadProjectConfig(dir)?.selection).toEqual({ roles: ['dev'], stacks: { backend: 'node' } });
});

test('migração legada: field sem rule cai pra general', () => {
  writeConfig({
    project_id: UUID_A,
    sections: { profiles: ['other'], fields: ['design'] },
    rules: {},
  });
  expect(loadProjectConfig(dir)?.selection).toEqual({
    roles: ['management'],
    stacks: { design: 'general' },
  });
});

test('selection explícita tem precedência sobre o formato legado', () => {
  writeConfig({
    project_id: UUID_A,
    selection: { roles: ['dev'], stacks: { frontend: 'react' } },
    sections: { profiles: ['other'], fields: ['design'] },
    rules: {},
  });
  expect(loadProjectConfig(dir)?.selection).toEqual({ roles: ['dev'], stacks: { frontend: 'react' } });
});

test('JSON inválido → erro descritivo mencionando o arquivo', () => {
  writeFileSync(join(dir, 'nio.json'), '{ not valid json');
  expect(() => loadProjectConfig(dir)).toThrow(/JSON inválido/);
});

test('JSON não-objeto (string) → erro', () => {
  writeFileSync(join(dir, 'nio.json'), '"just a string"');
  expect(() => loadProjectConfig(dir)).toThrow('nio.json deve conter um objeto JSON.');
});

test('ide válido é preservado; ide inválido é ignorado', () => {
  writeConfig({ project_id: UUID_A, ide: 'vscode' });
  expect(loadProjectConfig(dir)?.ide).toBe('vscode');

  writeConfig({ project_id: UUID_A, ide: 'notepad' });
  expect(loadProjectConfig(dir)?.ide).toBeUndefined();
});

test('findProjectConfigPath sobe diretórios até achar nio.json', () => {
  writeConfig({ project_id: UUID_A });
  const nested = join(dir, 'a', 'b', 'c');
  mkdirSync(nested, { recursive: true });
  expect(findProjectConfigPath(nested)).toBe(join(dir, 'nio.json'));
});

test('findProjectConfigPath: o binding mais próximo vence sobre o do pai', () => {
  writeConfig({ project_id: UUID_A });
  const child = join(dir, 'child');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(child, 'nio.json'), JSON.stringify({ project_id: UUID_B }));
  expect(findProjectConfigPath(child)).toBe(join(child, 'nio.json'));
});

test('findProjectConfigPath: sem nio.json em nenhum ancestral → null', () => {
  expect(findProjectConfigPath(dir)).toBeNull();
});

// --- .gitignore: marcadores da marca + migração ---

test('ensureGitignored: adiciona marcador da marca + entrada em .gitignore vazio', () => {
  expect(ensureGitignored(USER_CONFIG_FILE, dir)).toBe('added');
  const txt = readFileSync(join(dir, '.gitignore'), 'utf8');
  expect(txt).toContain(`# ${brand.name} (config local do usuário)`);
  expect(txt).toContain(USER_CONFIG_FILE);
});

test('ensureGitignored: migração — varre marcador de usuário de outra marca, mantém o atual', () => {
  writeFileSync(join(dir, '.gitignore'), '# marcaantiga (config local do usuário)\nlixo\n');
  ensureGitignored(USER_CONFIG_FILE, dir);
  const txt = readFileSync(join(dir, '.gitignore'), 'utf8');
  expect(txt).not.toContain('# marcaantiga (config local do usuário)');
  expect(txt).toContain(`# ${brand.name} (config local do usuário)`);
  expect(txt).toContain(USER_CONFIG_FILE);
  expect(txt).toContain('lixo'); // linhas não-marcador preservadas
});

test('ensureGitignored: idempotente — entrada já presente não duplica', () => {
  ensureGitignored(USER_CONFIG_FILE, dir);
  expect(ensureGitignored(USER_CONFIG_FILE, dir)).toBe('present');
  const txt = readFileSync(join(dir, '.gitignore'), 'utf8');
  expect(txt.split(USER_CONFIG_FILE).length - 1).toBe(1);
});

test('removeFromGitignore: remove a entrada + marcador de projeto de qualquer marca', () => {
  writeFileSync(join(dir, '.gitignore'), '# marcaantiga (binding local do projeto)\nnio.json\nkeep\n');
  expect(removeFromGitignore('nio.json', dir)).toBe(true);
  const txt = readFileSync(join(dir, '.gitignore'), 'utf8');
  expect(txt).not.toContain('# marcaantiga (binding local do projeto)');
  expect(txt).not.toContain('nio.json');
  expect(txt).toContain('keep');
});
