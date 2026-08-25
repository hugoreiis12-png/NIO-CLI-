import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScaffoldGateway } from './scaffold-gateway.js';
import { createLanguageCatalog } from './language-catalog.js';
import type { ScaffoldStep } from '../../core/lang.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-scaffold-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ts = () => createLanguageCatalog().recipe('typescript');
const runArgs = (steps: ScaffoldStep[]) =>
  steps.filter((s) => s.kind === 'run').map((s) => (s.kind === 'run' ? `${s.program} ${s.args.join(' ')}` : ''));
const marker = (steps: ScaffoldStep[]) => {
  const w = steps.find((s) => s.kind === 'write');
  return w && w.kind === 'write' ? (JSON.parse(w.content) as Record<string, unknown>) : {};
};

test('greenfield: init + tipagens + instala framework/ORM mapeados + marker', () => {
  const plan = createScaffoldGateway().plan(ts(), { packageManager: 'npm', framework: 'Next.js', orm: 'Prisma' }, dir);
  const cmds = runArgs(plan.steps);
  expect(cmds[0]).toBe('npm init -y');
  expect(cmds[1]).toBe('npm install -D typescript @types/node');
  expect(cmds).toContain('npm install next'); // Next.js → next (do teu package-map)
  expect(cmds).toContain('npm install prisma');
  expect(marker(plan.steps).installed).toEqual(['next', 'prisma']);
  expect(marker(plan.steps).greenfield).toBe(true);
});

test('brownfield compatível (package.json existe): NÃO re-inicializa, só adiciona a dep', () => {
  writeFileSync(join(dir, 'package.json'), '{}');
  const plan = createScaffoldGateway().plan(ts(), { packageManager: 'npm', framework: 'Fastify' }, dir);
  const cmds = runArgs(plan.steps);
  expect(cmds.some((c) => c.startsWith('npm init'))).toBe(false); // não sobrescreve
  expect(cmds).toContain('npm install fastify');
  expect(marker(plan.steps).greenfield).toBe(false);
});

test('incompatível (framework Python num projeto Node): NÃO instala, vai pro skipped', () => {
  writeFileSync(join(dir, 'package.json'), '{}'); // projeto node
  const py = createLanguageCatalog().recipe('python');
  const plan = createScaffoldGateway().plan(py, { packageManager: 'pip', framework: 'FastAPI' }, dir);
  expect(runArgs(plan.steps).some((c) => c.includes('fastapi'))).toBe(false);
  expect(marker(plan.steps).ecosystemFits).toBe(false);
  expect(marker(plan.steps).skipped).toContain('FastAPI');
});

test('apply(dryRun): ISOLAMENTO — tudo planned, NÃO toca o disco', () => {
  const plan = createScaffoldGateway().plan(ts(), { packageManager: 'npm' }, dir);
  const results = createScaffoldGateway().apply(plan, { dryRun: true });
  expect(results.every((r) => r.status === 'planned')).toBe(true);
  expect(readdirSync(dir)).toHaveLength(0);
});

test('apply real do passo write (seguro, sem rede): cria o marker', () => {
  const gw = createScaffoldGateway();
  const full = gw.plan(ts(), { packageManager: 'npm' }, dir);
  const writeOnly = { ...full, steps: full.steps.filter((s) => s.kind === 'write') };
  const results = gw.apply(writeOnly, { dryRun: false });
  expect(results.every((r) => r.status === 'done')).toBe(true);
  expect(existsSync(join(dir, '.nio-lang.json'))).toBe(true);
  expect(readFileSync(join(dir, '.nio-lang.json'), 'utf-8')).toContain('"language": "typescript"');
});
