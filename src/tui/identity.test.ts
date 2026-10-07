import { test, expect } from 'bun:test';
import { ANIM } from '../avatar.js';
import { IDENTITY, REVEAL_MS, SPOKEN, isIdentityQuestion, revealAt } from './identity.js';

test('detector: variações curtas de "quem é você" disparam a cena', () => {
  for (const q of [
    'Quem é você?',
    'quem é você?...',
    'quem e voce',
    'Quem é vc',
    'quem você é?',
    'Oi, quem é você?',
    'afinal quem é você mesmo',
    'qual é o seu nome?',
    'como você se chama',
    'se apresente',
    'Apresente-se!',
    'o que é você?',
    'who are you?',
  ]) {
    expect(isIdentityQuestion(q)).toBe(true);
  }
});

test('detector: frase longa que só contém o trecho segue pro modelo', () => {
  for (const q of [
    'quem é você no git blame?',
    'quem é o autor deste arquivo',
    'qual seu nome de usuário no banco',
    'o que é docker?',
    'apresente o relatório de vendas',
    'explique quem é o usuário logado',
    '',
  ]) {
    expect(isIdentityQuestion(q)).toBe(false);
  }
});

test('contrato: a fala traz nome, sigla, nome por extenso e missão', () => {
  const fala = SPOKEN.join(' ');
  expect(fala).toContain(IDENTITY.agent);
  expect(fala).toContain(IDENTITY.org);
  expect(fala).toContain(IDENTITY.orgFull);
  expect(fala).toContain(IDENTITY.mission);
  expect(fala).toContain('análise');
  expect(fala).toContain('programação');
});

test('contrato: nunca se declara humano nem cita fornecedor/modelo', () => {
  const fala = SPOKEN.join(' ').toLowerCase();
  for (const proibido of ['humano', 'claude', 'anthropic', 'openai', 'qwen', 'gpt']) {
    expect(fala).not.toContain(proibido);
  }
});

test('linha do tempo: suspense → personagem se forma → fala → fim', () => {
  const start = revealAt(0);
  expect(start.suspense).toHaveLength(1);
  expect(start.sprite).toBeNull();
  expect(start.spoken).toHaveLength(0);
  expect(start.done).toBe(false);

  const end = revealAt(REVEAL_MS);
  expect(end.suspense).toHaveLength(3);
  expect(end.sprite).toMatchObject({ kind: 'hold' });
  expect(end.spoken).toEqual([...SPOKEN]);
  expect(end.done).toBe(true);
  expect(revealAt(Infinity)).toEqual(end);
  expect(revealAt(-5)).toEqual(start);
});

test('linha do tempo: o personagem integra antes de falar e nada some no meio', () => {
  let prev = revealAt(0);
  let falouComSpriteIntegrando = false;
  for (let t = 0; t <= REVEAL_MS; t += ANIM.frameMs) {
    const v = revealAt(t);
    expect(v.suspense.length).toBeGreaterThanOrEqual(prev.suspense.length);
    expect(v.spoken.length).toBeGreaterThanOrEqual(prev.spoken.length);
    if (v.spoken.length > 0 && v.sprite?.kind === 'integrate') falouComSpriteIntegrando = true;
    prev = v;
  }
  expect(falouComSpriteIntegrando).toBe(false);
});
