import { test, expect } from 'bun:test';
import { LanguageConfigurator } from './language-configurator.js';
import type { LanguageCatalog, LanguageRecipe, ScaffoldGateway, ScaffoldPlan } from '../core/lang.js';

const recipe: LanguageRecipe = {
  language: 'typescript',
  runtime: 'node',
  packageManagers: ['npm'],
  baseLibs: [],
  frameworks: ['Next.js'],
  orms: ['Prisma'],
  typings: ['typescript'],
  mcpSdk: '@modelcontextprotocol/sdk',
};

function fakeCatalog(): LanguageCatalog {
  return { recipe: () => recipe };
}

/** Fake que conta quantas vezes o apply REAL (não dry-run) foi chamado. */
function fakeScaffold() {
  const gw = {
    realCalls: 0,
    plan: (_r: LanguageRecipe, _c: unknown, targetDir: string): ScaffoldPlan => ({
      language: 'typescript',
      targetDir,
      steps: [{ kind: 'run', program: 'npm', args: ['init', '-y'], cwd: targetDir, label: 'init' }],
    }),
    apply(plan: ScaffoldPlan, opts?: { dryRun?: boolean }) {
      if (!opts?.dryRun) gw.realCalls++;
      return plan.steps.map((step) => ({
        step,
        status: (opts?.dryRun ? 'planned' : 'done') as 'planned' | 'done',
      }));
    },
  };
  return gw;
}

test('não confirmado → NÃO aplica de verdade (só dry-run), applied:false', async () => {
  const scaffold = fakeScaffold();
  const cfg = new LanguageConfigurator({ catalog: fakeCatalog(), scaffold: scaffold as ScaffoldGateway });

  const res = await cfg.configure([{ language: 'typescript', choices: {} }], '/tmp/x', async () => false);

  expect(res[0]?.applied).toBe(false);
  expect(res[0]?.steps).toEqual([]);
  expect(scaffold.realCalls).toBe(0); // gate funcionou: nada executado
});

test('confirmado → aplica de verdade e devolve steps done', async () => {
  const scaffold = fakeScaffold();
  const cfg = new LanguageConfigurator({ catalog: fakeCatalog(), scaffold: scaffold as ScaffoldGateway });

  const res = await cfg.configure([{ language: 'typescript', choices: {} }], '/tmp/x', async () => true);

  expect(res[0]?.applied).toBe(true);
  expect(scaffold.realCalls).toBe(1);
  expect(res[0]?.steps.every((s) => s.status === 'done')).toBe(true);
});

test('preview passado ao confirm é o dry-run (descrição dos passos)', async () => {
  const scaffold = fakeScaffold();
  const cfg = new LanguageConfigurator({ catalog: fakeCatalog(), scaffold: scaffold as ScaffoldGateway });
  let seen: string[] = [];

  await cfg.configure([{ language: 'typescript', choices: {} }], '/tmp/x', async (_l, preview) => {
    seen = preview;
    return false;
  });

  expect(seen).toEqual(['npm init -y']);
});
