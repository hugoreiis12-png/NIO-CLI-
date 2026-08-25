/**
 * Homologação da EXECUÇÃO REAL do `ScaffoldGateway` — opt-in.
 *
 * Só roda com `NIO_SCAFFOLD_APPLY=1` (o CI nunca seta → a suíte normal PULA este
 * teste e nunca instala nada). Quando ligado, executa de verdade (npm, com rede)
 * dentro de um tmp dir descartável, com guarda extra que recusa scaffoldar fora
 * do temp do SO. Cleanup no `finally`.
 *
 *   NIO_SCAFFOLD_APPLY=1 bun test src/adapters/lang/scaffold-apply.homolog.test.ts
 */
import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLanguageCatalog } from './language-catalog.js';
import { createScaffoldGateway } from './scaffold-gateway.js';

const homologar = process.env.NIO_SCAFFOLD_APPLY === '1';
const t = homologar ? test : test.skip;

/** Cinto e suspensório: recusa executar fora do temp do SO. */
function assertTemp(dir: string): void {
  if (!dir.startsWith(tmpdir())) {
    throw new Error(`Homologação recusada: "${dir}" não está sob o temp do SO (${tmpdir()}).`);
  }
}

t(
  'apply REAL (typescript/npm): materializa package.json + typescript em devDependencies',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nio-homolog-'));
    assertTemp(dir);
    try {
      const recipe = createLanguageCatalog().recipe('typescript');
      const gw = createScaffoldGateway();
      const plan = gw.plan(recipe, { packageManager: 'npm' }, dir);

      const results = gw.apply(plan, { dryRun: false });

      // Todos os passos concluíram (lista de falhas legível se algo quebrar).
      const failed = results.filter((r) => r.status !== 'done').map((r) => `${r.step.label}: ${r.error ?? ''}`);
      expect(failed).toEqual([]);

      // Materializou de verdade.
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
        devDependencies?: Record<string, string>;
      };
      expect(pkg.devDependencies?.typescript).toBeDefined();
      expect(pkg.devDependencies?.['@types/node']).toBeDefined();
      expect(existsSync(join(dir, '.nio-lang.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  180_000,
);
