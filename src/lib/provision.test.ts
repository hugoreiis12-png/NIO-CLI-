import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyProvision, uninstallProvision, ensureDir, provision, MANIFEST_NAME } from './provision.js';

// Caracterização do plano de arquivos gerado por applyProvision/provision ANTES do
// split em provision-collect.ts (coleta) + provision-apply.ts (motor/manifesto) —
// pina create/update/unchanged/skip-conflict/prune/prune-kept/force/dry-run/write-error.

function fresh(): string {
  return mkdtempSync(join(tmpdir(), 'nio-prov-'));
}

test('create: arquivo novo é escrito e entra no manifesto', () => {
  const target = fresh();
  try {
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('hello') }], {
      targetDir: target,
    });
    expect(res.files).toEqual([{ relPath: 'commands/foo.md', action: 'create' }]);
    expect(readFileSync(join(target, 'commands/foo.md'), 'utf8')).toBe('hello');

    const manifest = JSON.parse(readFileSync(join(target, MANIFEST_NAME), 'utf8'));
    expect(manifest.generator).toBe('@nio-cli/cli');
    expect(Object.keys(manifest.files)).toEqual(['commands/foo.md']);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('dryRun: calcula o plano mas não escreve nada no disco', () => {
  const target = fresh();
  try {
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('hello') }], {
      targetDir: target,
      dryRun: true,
    });
    expect(res.files).toEqual([{ relPath: 'commands/foo.md', action: 'create' }]);
    expect(existsSync(join(target, 'commands/foo.md'))).toBe(false);
    expect(existsSync(join(target, MANIFEST_NAME))).toBe(false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('unchanged: mesmo conteúdo na 2ª rodada não reescreve', () => {
  const target = fresh();
  try {
    const docs = [{ relPath: 'commands/foo.md', content: Buffer.from('hello') }];
    applyProvision(docs, { targetDir: target });
    const res = applyProvision(docs, { targetDir: target });
    expect(res.files).toEqual([{ relPath: 'commands/foo.md', action: 'unchanged' }]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('update: conteúdo mudou e o usuário não tocou → atualiza sem detail', () => {
  const target = fresh();
  try {
    applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v2') }], { targetDir: target });
    expect(res.files).toEqual([{ relPath: 'commands/foo.md', action: 'update' }]);
    expect(readFileSync(join(target, 'commands/foo.md'), 'utf8')).toBe('v2');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('skip-conflict: usuário editou localmente → não sobrescreve (sem --force)', () => {
  const target = fresh();
  try {
    applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    writeFileSync(join(target, 'commands/foo.md'), 'user-edited');
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v2') }], { targetDir: target });
    expect(res.files).toEqual([
      { relPath: 'commands/foo.md', action: 'skip-conflict', detail: 'editado localmente' },
    ]);
    expect(readFileSync(join(target, 'commands/foo.md'), 'utf8')).toBe('user-edited');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('skip-conflict: arquivo de terceiros (nunca provisionado por nós)', () => {
  const target = fresh();
  try {
    mkdirSync(join(target, 'commands'), { recursive: true });
    writeFileSync(join(target, 'commands/foo.md'), 'third party');
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v2') }], { targetDir: target });
    expect(res.files).toEqual([
      { relPath: 'commands/foo.md', action: 'skip-conflict', detail: 'arquivo de terceiros' },
    ]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('force: sobrescreve arquivo divergente com detail explicando', () => {
  const target = fresh();
  try {
    applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    writeFileSync(join(target, 'commands/foo.md'), 'user-edited');
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v2') }], {
      targetDir: target,
      force: true,
    });
    expect(res.files).toEqual([
      { relPath: 'commands/foo.md', action: 'update', detail: 'forçado sobre arquivo divergente' },
    ]);
    expect(readFileSync(join(target, 'commands/foo.md'), 'utf8')).toBe('v2');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('prune: arquivo que saiu da fonte e está intacto é removido', () => {
  const target = fresh();
  try {
    applyProvision(
      [
        { relPath: 'commands/foo.md', content: Buffer.from('v1') },
        { relPath: 'commands/bar.md', content: Buffer.from('v1') },
      ],
      { targetDir: target },
    );
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    const bar = res.files.find((f) => f.relPath === 'commands/bar.md');
    expect(bar).toEqual({ relPath: 'commands/bar.md', action: 'prune' });
    expect(existsSync(join(target, 'commands/bar.md'))).toBe(false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('prune-kept: arquivo que saiu da fonte mas foi editado localmente é preservado', () => {
  const target = fresh();
  try {
    applyProvision(
      [
        { relPath: 'commands/foo.md', content: Buffer.from('v1') },
        { relPath: 'commands/bar.md', content: Buffer.from('v1') },
      ],
      { targetDir: target },
    );
    writeFileSync(join(target, 'commands/bar.md'), 'user edited bar');
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    const bar = res.files.find((f) => f.relPath === 'commands/bar.md');
    expect(bar).toEqual({
      relPath: 'commands/bar.md',
      action: 'prune-kept',
      detail: 'modificado localmente — mantido',
    });
    expect(existsSync(join(target, 'commands/bar.md'))).toBe(true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('prune:false → nada é removido, mesmo saindo da fonte', () => {
  const target = fresh();
  try {
    applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    const res = applyProvision([], { targetDir: target, prune: false });
    expect(res.files).toEqual([]);
    expect(existsSync(join(target, 'commands/foo.md'))).toBe(true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('write-error: path de destino colide com um diretório existente → não aborta o resto', () => {
  const target = fresh();
  try {
    mkdirSync(join(target, 'commands', 'foo.md'), { recursive: true }); // dir, não arquivo
    const res = applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v2') }], { targetDir: target });
    expect(res.files).toHaveLength(1);
    expect(res.files[0].relPath).toBe('commands/foo.md');
    expect(res.files[0].action).toBe('write-error');
    expect(typeof res.files[0].detail).toBe('string');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Semântica de symlink de dotfile é POSIX: no Windows, `symlinkSync` p/ alvo
// inexistente cria link tipo-`file` (não `dir`), então `mkdir` através dele nunca
// funciona — o comportamento que este teste valida não existe lá. Roda no
// CI/Mac/Linux, onde dotfiles simbolicados são o caso real.
const posixTest = process.platform === 'win32' ? test.skip : test;
posixTest('ensureDir: materializa o alvo de um symlink pendurado em vez de estourar ENOENT', () => {
  const base = fresh();
  try {
    const realTarget = join(base, 'real-target');
    const link = join(base, 'link');
    symlinkSync(realTarget, link); // pendurado: realTarget ainda não existe
    ensureDir(join(link, 'sub', 'deep'));
    expect(existsSync(join(realTarget, 'sub', 'deep'))).toBe(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('uninstallProvision: remove o que é nosso e intacto, preserva o editado localmente', () => {
  const target = fresh();
  try {
    applyProvision(
      [
        { relPath: 'commands/foo.md', content: Buffer.from('v1') },
        { relPath: 'commands/bar.md', content: Buffer.from('v1') },
      ],
      { targetDir: target },
    );
    writeFileSync(join(target, 'commands/bar.md'), 'user edited');
    const res = uninstallProvision({ targetDir: target });
    expect(res.removed).toEqual(['commands/foo.md']);
    expect(res.kept).toEqual(['commands/bar.md']);
    expect(existsSync(join(target, 'commands/foo.md'))).toBe(false);
    expect(existsSync(join(target, 'commands/bar.md'))).toBe(true);
    expect(existsSync(join(target, MANIFEST_NAME))).toBe(false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('uninstallProvision dryRun: calcula o plano sem remover nada', () => {
  const target = fresh();
  try {
    applyProvision([{ relPath: 'commands/foo.md', content: Buffer.from('v1') }], { targetDir: target });
    const res = uninstallProvision({ targetDir: target, dryRun: true });
    expect(res.removed).toEqual(['commands/foo.md']);
    expect(existsSync(join(target, 'commands/foo.md'))).toBe(true);
    expect(existsSync(join(target, MANIFEST_NAME))).toBe(true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('provision(): pacote de skills ausente → erro descritivo', () => {
  const base = fresh();
  try {
    const missing = join(base, 'does-not-exist');
    expect(() => provision({ skillsDir: missing, targetDir: base })).toThrow(
      `Pacote de skills não encontrado em ${missing}. Instale/publique @nio-cli/skills.`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('provision(): coleta commands/skills/agents do pacote e aplica no destino (README ignorado)', () => {
  const pkgDir = fresh();
  const target = fresh();
  try {
    mkdirSync(join(pkgDir, 'commands'), { recursive: true });
    writeFileSync(join(pkgDir, 'commands', 'implement.md'), '# Implement\n');
    writeFileSync(join(pkgDir, 'commands', 'README.md'), 'ignored');
    mkdirSync(join(pkgDir, 'agents', 'dev'), { recursive: true });
    writeFileSync(join(pkgDir, 'agents', 'dev', 'reviewer.md'), '# Reviewer\n');
    mkdirSync(join(pkgDir, 'skills', 'dev', 'general', 'foo'), { recursive: true });
    writeFileSync(join(pkgDir, 'skills', 'dev', 'general', 'foo', 'SKILL.md'), '# Foo skill\n');

    const res = provision({ skillsDir: pkgDir, targetDir: target });
    const paths = res.files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['agents/reviewer.md', 'commands/implement.md', 'skills/foo/SKILL.md']);
    expect(res.files.every((f) => f.action === 'create')).toBe(true);
    expect(readFileSync(join(target, 'commands/implement.md'), 'utf8')).toBe('# Implement\n');
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
