import { test, expect } from 'bun:test';
import { generateVerifier, challengeFromVerifier, randomState } from './pkce.js';

test('generateVerifier/randomState: geram strings não-vazias e distintas a cada chamada', () => {
  const v1 = generateVerifier();
  const v2 = generateVerifier();
  expect(v1.length).toBeGreaterThan(0);
  expect(v1).not.toBe(v2);

  const s1 = randomState();
  const s2 = randomState();
  expect(s1.length).toBeGreaterThan(0);
  expect(s1).not.toBe(s2);
});

test('challengeFromVerifier: determinístico e sensível ao verifier', () => {
  const verifier = 'um-verifier-fixo-de-teste';
  expect(challengeFromVerifier(verifier)).toBe(challengeFromVerifier(verifier));
  expect(challengeFromVerifier(verifier)).not.toBe(challengeFromVerifier(verifier + 'x'));
});

test('challengeFromVerifier: base64url sem padding nem caracteres +/', () => {
  const challenge = challengeFromVerifier(generateVerifier());
  expect(challenge).not.toMatch(/[+/=]/);
});
