import { test, expect } from 'bun:test';
import type { SkillDoc } from './skills.js';
import {
  buildSkillPrompt,
  skillPromptDescriptors,
  skillResourceDescriptors,
} from './skill-serve.js';

function doc(over: Partial<SkillDoc> & { id: string; path: string }): SkillDoc {
  return {
    uid: null,
    title: over.id,
    type: 'doc',
    description: '',
    frontmatter: {},
    content: '',
    clients: null,
    ...over,
  };
}

const skill = doc({
  id: 'minha-skill',
  path: 'skills/minha-skill/SKILL.md',
  type: 'skill',
  title: 'Minha Skill',
  description: 'Faz coisas',
  content: 'Corpo principal. $ARGUMENTS fim.',
});
const companion = (name: string, body: string) =>
  doc({ id: name, path: `skills/minha-skill/${name}.md`, type: 'doc', title: name, content: body });

test('resource descriptor corta descrição longa no teto', () => {
  const d = doc({
    id: 'x',
    path: 'agents/x.md',
    type: 'agent',
    title: 'X',
    description: 'd'.repeat(500),
  });
  const [res] = skillResourceDescriptors([d]);
  expect(res.description.length).toBeLessThanOrEqual(200);
  expect(res.uri).toBe('nio://skills/agents/x.md');
});

test('prompt descriptor mantém teto de 200 por padrão', () => {
  const cmd = doc({
    id: 'cmd',
    path: 'commands/cmd.md',
    type: 'command',
    title: 'Cmd',
    description: 'e'.repeat(500),
    content: 'body',
  });
  const [p] = skillPromptDescriptors([cmd]);
  expect(p.description.length).toBeLessThanOrEqual(200);
});

test('buildSkillPrompt inlina apoio quando cabe, sem aviso de corte', () => {
  const docs = [skill, companion('ajuda', 'texto curto de apoio')];
  const { text } = buildSkillPrompt('minha-skill', { args: 'ARG' }, docs);
  expect(text).toContain('Corpo principal. ARG fim.');
  expect(text).toContain('texto curto de apoio');
  expect(text).not.toContain('Condensado pra caber na janela');
});

test('buildSkillPrompt omite apoio que estoura o budget, com URIs sob demanda', () => {
  const docs = [skill, companion('grande', 'g'.repeat(5000))];
  const { text } = buildSkillPrompt('minha-skill', undefined, docs, 500);
  expect(text).toContain('Corpo principal.');
  expect(text).not.toContain('g'.repeat(100));
  expect(text).toContain('Condensado pra caber na janela');
  expect(text).toContain('nio://skills/skills/minha-skill/grande.md');
});

test('buildSkillPrompt com budget 0 restaura comportamento antigo (tudo inline)', () => {
  const docs = [skill, companion('grande', 'g'.repeat(5000))];
  const { text } = buildSkillPrompt('minha-skill', undefined, docs, 0);
  expect(text).toContain('g'.repeat(5000));
  expect(text).not.toContain('Condensado pra caber na janela');
});

test('buildSkillPrompt trunca corpo gigante no teto com aviso', () => {
  const big = doc({
    id: 'big',
    path: 'commands/big.md',
    type: 'command',
    title: 'Big',
    content: 'z'.repeat(2000),
  });
  const { text } = buildSkillPrompt('big', undefined, [big], 100);
  expect(text.length).toBeLessThan(2000);
  expect(text).toContain('truncada no teto');
});

test('buildSkillPrompt rejects prompt desconhecido', () => {
  expect(() => buildSkillPrompt('nao-existe', undefined, [skill])).toThrow(/Prompt desconhecido/);
});
