import { test, expect } from 'bun:test';
import { toSkillDocs } from './skills.js';

// Caracterização do parser de frontmatter (função privada `parseFrontmatter`) via
// `toSkillDocs`, ANTES da extração de um helper — pina o comportamento atual.

test('key: value simples vira frontmatter + body', () => {
  const raw = '---\ntitle: Foo Command\ndescription: Does the thing\n---\nBody content here.\n';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter).toEqual({ title: 'Foo Command', description: 'Does the thing' });
  expect(doc.title).toBe('Foo Command');
  expect(doc.description).toBe('Does the thing');
  expect(doc.content).toBe('Body content here.');
});

test('valores entre aspas simples/duplas são desempacotados', () => {
  const raw = '---\ntitle: "Quoted Title"\n---\nbody\n';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter.title).toBe('Quoted Title');
});

test('bloco folded (>) junta linhas com espaço único e trima', () => {
  const raw = '---\ndescription: >\n  This is a long\n  description that\n  wraps.\n---\nbody\n';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter.description).toBe('This is a long description that wraps.');
});

test('bloco literal (|) junta linhas com \\n', () => {
  const raw = '---\nnotes: |\n  line one\n  line two\n---\nbody\n';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter.notes).toBe('line one\nline two');
});

test('indicador de chomp (>-) também é reconhecido como bloco folded', () => {
  const raw = '---\ndesc: >-\n  a\n  b\n---\nbody\n';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter.desc).toBe('a b');
});

test('sem bloco --- → frontmatter vazio e body = raw inteiro (trimado)', () => {
  const raw = 'Just plain content, no frontmatter block.';
  const [doc] = toSkillDocs([{ path: 'commands/foo.md', raw }]);
  expect(doc.frontmatter).toEqual({});
  expect(doc.content).toBe(raw);
});
