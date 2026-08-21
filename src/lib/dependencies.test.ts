import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  resolveDependency,
  skillsInstallPlan,
  isDependencyInstalled,
  runDependencyInstall,
  type ResolvedDependency,
  type DependencyPlan,
} from './dependencies.js';
import type { SkillDoc } from './skills.js';

// Caracterização de dependencies.ts ANTES do split em módulos — pina a resolução
// de `dependency` docs em planos executáveis (resolveDependency, pura) e a decisão
// de instalado/pendente (isDependencyInstalled) + execução (runDependencyInstall).

function makeDoc(fm: Record<string, string>, overrides: Partial<SkillDoc> = {}): SkillDoc {
  return {
    id: overrides.id ?? 'my-dep',
    uid: overrides.uid ?? null,
    title: overrides.title ?? 'My Dep',
    type: 'dependency',
    path: overrides.path ?? 'dependencies/my-dep.md',
    description: overrides.description ?? '',
    frontmatter: fm,
    content: overrides.content ?? '',
    clients: overrides.clients ?? null,
  };
}

function baseDep(overrides: Partial<ResolvedDependency> = {}): ResolvedDependency {
  return { id: 'dep', title: 'Dep', plan: null, ...overrides };
}

// --- resolveDependency --------------------------------------------------------

test('npm: nome válido vira plano npm install -g; inválido → plan null + motivo', () => {
  const ok = resolveDependency(makeDoc({ npm: '@scope/pkg-name' }));
  expect(ok.plan).toEqual({
    kind: 'npm',
    pkg: '@scope/pkg-name',
    program: 'npm',
    args: ['install', '-g', '@scope/pkg-name'],
    command: 'npm install -g @scope/pkg-name',
  });
  expect(ok.reason).toBeUndefined();

  const bad = resolveDependency(makeDoc({ npm: 'Bad Name!!' }));
  expect(bad.plan).toBeNull();
  expect(bad.reason).toBe('nome de pacote npm inválido: "Bad Name!!"');
});

test('skills: owner/repo (sem/com skill específico) e slug inválido', () => {
  const noSkill = resolveDependency(makeDoc({ skills: 'owner/repo' }));
  expect(noSkill.plan).toEqual({
    kind: 'skills',
    repo: 'owner/repo',
    program: 'npx',
    args: ['--yes', 'skills', 'add', 'owner/repo'],
    command: 'npx --yes skills add owner/repo',
  });

  const withSkill = resolveDependency(makeDoc({ skills: 'owner/repo/skillname' }));
  expect(withSkill.plan).toEqual({
    kind: 'skills',
    repo: 'owner/repo/skillname',
    program: 'npx',
    args: ['--yes', 'skills', 'add', 'owner/repo', '--skill', 'skillname'],
    command: 'npx --yes skills add owner/repo --skill skillname',
  });

  const invalid = resolveDependency(makeDoc({ skills: 'not a slug!!' }));
  expect(invalid.plan).toBeNull();
  expect(invalid.reason).toBe('repo de skills inválido (owner/repo[/skill]): "not a slug!!"');
});

test('git: URL github válida → dest em ~/.nio/deps/<id>; URL não-github → motivo', () => {
  const dep = resolveDependency(makeDoc({ git: 'https://github.com/owner/repo' }, { id: 'my-dep' }));
  const expectedDest = join(homedir(), '.nio', 'deps', 'my-dep');
  expect(dep.plan).toEqual({
    kind: 'git',
    url: 'https://github.com/owner/repo',
    dest: expectedDest,
    program: 'git',
    args: ['clone', '--depth', '1', 'https://github.com/owner/repo', expectedDest],
    command: `git clone --depth 1 https://github.com/owner/repo ${expectedDest}`,
  });

  const invalid = resolveDependency(makeDoc({ git: 'http://example.com/x' }));
  expect(invalid.plan).toBeNull();
  expect(invalid.reason).toBe('URL git não permitida (só https://github.com/…): "http://example.com/x"');
});

test('claude-plugin: "<owner/repo> <plugin@marketplace>" válido → 2 passos; sem plugin → motivo', () => {
  const dep = resolveDependency(makeDoc({ 'claude-plugin': 'owner/repo plugin@marketplace' }));
  expect(dep.plan).toEqual({
    kind: 'claude-plugin',
    marketplace: 'owner/repo',
    plugin: 'plugin@marketplace',
    steps: [
      { program: 'claude', args: ['plugin', 'marketplace', 'add', 'owner/repo'] },
      { program: 'claude', args: ['plugin', 'install', 'plugin@marketplace'] },
    ],
    command: 'claude plugin marketplace add owner/repo && claude plugin install plugin@marketplace',
  });

  const invalid = resolveDependency(makeDoc({ 'claude-plugin': 'owner/repo' }));
  expect(invalid.plan).toBeNull();
  expect(invalid.reason).toBe('claude-plugin inválido (esperado "<owner/repo> <plugin@marketplace>"): "owner/repo"');
});

test('manual: sem instalador automatizável, mas com manual: → manual + motivo fixo', () => {
  const dep = resolveDependency(makeDoc({ manual: 'Install via App Store' }));
  expect(dep.plan).toBeNull();
  expect(dep.manual).toBe('Install via App Store');
  expect(dep.reason).toBe('instalação manual');
});

test('nada: sem npm/skills/git/claude-plugin/manual → motivo genérico', () => {
  const dep = resolveDependency(makeDoc({}));
  expect(dep.plan).toBeNull();
  expect(dep.reason).toBe('sem instalador estruturado (npm:/skills:/git:/manual:) — instale manualmente');
});

test('precedência npm > skills > git; detect vira lista trimada; repo/displayInstall/description', () => {
  const prec = resolveDependency(makeDoc({ npm: 'pkgname', skills: 'owner/repo', git: 'https://github.com/o/r' }));
  expect(prec.plan?.kind).toBe('npm');

  const detect = resolveDependency(makeDoc({ detect: '~/foo, ~/bar\n~/baz' }));
  expect(detect.detect).toEqual(['~/foo', '~/bar', '~/baz']);

  const fallback = resolveDependency(makeDoc({ homepage: 'https://y', install: 'brew install x' }));
  expect(fallback.repo).toBe('https://y');
  expect(fallback.displayInstall).toBe('brew install x');

  const nodeDescWins = resolveDependency(makeDoc({ description: 'fm desc' }, { description: 'node desc' }));
  expect(nodeDescWins.description).toBe('node desc');
  const fmDescFallback = resolveDependency(makeDoc({ description: 'fm desc' }, { description: '' }));
  expect(fmDescFallback.description).toBe('fm desc');
});

test('skillsInstallPlan: slug válido monta plano; inválido retorna null', () => {
  expect(skillsInstallPlan('owner/repo')).toEqual({
    kind: 'skills',
    repo: 'owner/repo',
    program: 'npx',
    args: ['--yes', 'skills', 'add', 'owner/repo'],
    command: 'npx --yes skills add owner/repo',
  });
  expect(skillsInstallPlan('bad slug!!')).toBeNull();
});

// --- isDependencyInstalled / runDependencyInstall (usam disco/subprocesso) ---

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-deps-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('detect: exato/wildcard/** casam; ausente e symlink pendurado não casam', () => {
  mkdirSync(join(dir, 'a', 'b', 'target'), { recursive: true });
  mkdirSync(join(dir, 'x1'), { recursive: true });
  const link = join(dir, 'danglink');
  symlinkSync(join(dir, 'doesnotexist'), link);

  expect(isDependencyInstalled(baseDep({ detect: [join(dir, 'a', 'b', 'target')] }))).toBe(true);
  expect(isDependencyInstalled(baseDep({ detect: [join(dir, 'nope')] }))).toBe(false);
  expect(isDependencyInstalled(baseDep({ detect: [join(dir, 'x*')] }))).toBe(true);
  expect(isDependencyInstalled(baseDep({ detect: [join(dir, '**', 'target')] }))).toBe(true);
  expect(isDependencyInstalled(baseDep({ detect: [link] }))).toBe(false);
  expect(isDependencyInstalled(baseDep({}))).toBe(false);
});

test('git: instalado se plan.dest existe no disco', () => {
  mkdirSync(join(dir, 'a'), { recursive: true });
  const plan: DependencyPlan = { kind: 'git', url: 'https://github.com/o/r', dest: join(dir, 'a'), program: 'git', args: [], command: '' };
  expect(isDependencyInstalled(baseDep({ plan }))).toBe(true);
  expect(isDependencyInstalled(baseDep({ plan: { ...plan, dest: join(dir, 'nope2') } }))).toBe(false);
});

test('npm: pacote definitivamente não instalado → false (via npm ls -g real)', () => {
  const plan: DependencyPlan = {
    kind: 'npm',
    pkg: 'this-package-definitely-does-not-exist-abcxyz-12345',
    program: 'npm',
    args: [],
    command: '',
  };
  expect(isDependencyInstalled(baseDep({ plan }))).toBe(false);
}, 15000);

test('runDependencyInstall — git cria dirname(dest); exit!=0 preserva code; program inexistente → error', () => {
  const dest = join(dir, 'newclone', 'nested');
  const okPlan: DependencyPlan = { kind: 'git', url: 'https://github.com/o/r', dest, program: 'true', args: [], command: '' };
  expect(runDependencyInstall(okPlan)).toEqual({ ok: true, code: 0 });

  const failPlan: DependencyPlan = { kind: 'npm', pkg: 'x', program: 'false', args: [], command: '' };
  expect(runDependencyInstall(failPlan)).toEqual({ ok: false, code: 1 });

  const errPlan: DependencyPlan = { kind: 'npm', pkg: 'x', program: 'this-binary-does-not-exist-xyz', args: [], command: '' };
  const res = runDependencyInstall(errPlan);
  expect(res.ok).toBe(false);
  expect(res.code).toBeNull();
  expect((res.error ?? '').length).toBeGreaterThan(0);
});

test('runDependencyInstall — claude-plugin: para no 1º passo que falha; ok se todos passam', () => {
  const firstFails: DependencyPlan = {
    kind: 'claude-plugin',
    marketplace: 'm',
    plugin: 'p',
    steps: [{ program: 'false', args: [] }, { program: 'true', args: [] }],
    command: '',
  };
  expect(runDependencyInstall(firstFails)).toEqual({ ok: false, code: 1 });

  const allOk: DependencyPlan = {
    kind: 'claude-plugin',
    marketplace: 'm',
    plugin: 'p',
    steps: [{ program: 'true', args: [] }, { program: 'true', args: [] }],
    command: '',
  };
  expect(runDependencyInstall(allOk)).toEqual({ ok: true, code: 0 });
});
