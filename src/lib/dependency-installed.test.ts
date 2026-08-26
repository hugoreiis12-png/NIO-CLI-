import { test, expect } from 'bun:test';
import { missingDependencies } from './dependency-installed.js';
import type { ScannedDependency } from './dependency-scan.js';

const deps: ScannedDependency[] = [
  { name: 'react', type: 'npm', filePath: 'package.json' },
  { name: 'lodash', type: 'npm', filePath: 'package.json' },
  { name: 'flask', type: 'pip', filePath: 'requirements.txt' },
];

test('missingDependencies: filtra as instaladas via check injetado', () => {
  // Só `lodash` conta como instalado.
  const check = (d: ScannedDependency) => d.name === 'lodash';
  const missing = missingDependencies(deps, '/proj', check).map((d) => d.name);
  expect(missing).toEqual(['react', 'flask']);
});

test('missingDependencies: nada instalado → todas faltam', () => {
  const missing = missingDependencies(deps, '/proj', () => false);
  expect(missing).toHaveLength(3);
});
