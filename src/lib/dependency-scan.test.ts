import { test, expect } from 'bun:test';
import {
  parsePackageJson,
  parseRequirementsTxt,
  parseCargoToml,
  scanContent,
} from './dependency-scan.js';

test('parsePackageJson: runtime + dev + peer + optional, sem duplicar', () => {
  const content = JSON.stringify({
    dependencies: { react: '^18', lodash: '^4' },
    devDependencies: { typescript: '^5', lodash: '^4' }, // lodash repetido
    peerDependencies: { 'react-dom': '^18' },
    optionalDependencies: { fsevents: '^2' },
  });
  const names = parsePackageJson(content).sort();
  expect(names).toEqual(['fsevents', 'lodash', 'react', 'react-dom', 'typescript']);
});

test('parsePackageJson: JSON inválido → lista vazia (não lança)', () => {
  expect(parsePackageJson('{ isso não é json')).toEqual([]);
});

test('parseRequirementsTxt: tira versão/extras/markers, ignora comentário e diretiva', () => {
  const content = [
    '# comentário',
    'flask==2.0.1',
    'requests>=2,<3',
    'django[bcrypt]==4.2 ; python_version >= "3.8"',
    '-r outro.txt',
    'git+https://github.com/x/y.git',
    '',
    '  numpy  ',
  ].join('\n');
  expect(parseRequirementsTxt(content).sort()).toEqual(['django', 'flask', 'numpy', 'requests']);
});

test('parseCargoToml: dependencies + dev + build', () => {
  const content = [
    '[dependencies]',
    'serde = "1.0"',
    'tokio = { version = "1", features = ["full"] }',
    '[dev-dependencies]',
    'criterion = "0.5"',
    '[build-dependencies]',
    'cc = "1.0"',
  ].join('\n');
  expect(parseCargoToml(content).sort()).toEqual(['cc', 'criterion', 'serde', 'tokio']);
});

test('scanContent: monta ScannedDependency com type e filePath do manifest', () => {
  const deps = scanContent('package.json', JSON.stringify({ dependencies: { react: '^18' } }));
  expect(deps).toEqual([{ name: 'react', type: 'npm', filePath: 'package.json' }]);
});

test('scanContent: arquivo desconhecido → vazio', () => {
  expect(scanContent('Gemfile', 'gem "rails"')).toEqual([]);
});
