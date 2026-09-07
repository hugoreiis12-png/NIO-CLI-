import { test, expect, beforeEach } from 'bun:test';
import {
  __clear,
  hit,
  loginDelayMs,
  recordLoginFail,
  recordLoginOk,
  smsAllowed,
  sweep,
  SMS_PER_USER,
} from './throttle.js';

beforeEach(__clear);

// ─── hit (janela fixa) ──────────────────────────────────────────────

test('hit: libera até o limite, bloqueia depois, reabre na virada da janela', () => {
  const t0 = 1_000_000;
  expect(hit('k', 2, 1000, t0).ok).toBe(true);
  expect(hit('k', 2, 1000, t0 + 100).ok).toBe(true);
  const blocked = hit('k', 2, 1000, t0 + 200);
  expect(blocked.ok).toBe(false);
  expect(blocked.retryAfterMs).toBe(800);
  // passou a janela → conta zera
  expect(hit('k', 2, 1000, t0 + 1001).ok).toBe(true);
});

test('hit: chaves independentes', () => {
  const t = 5_000;
  expect(hit('a', 1, 1000, t).ok).toBe(true);
  expect(hit('a', 1, 1000, t).ok).toBe(false);
  expect(hit('b', 1, 1000, t).ok).toBe(true);
});

// ─── smsAllowed (M-4) ───────────────────────────────────────────────

test('smsAllowed: cap por número = 1/min', () => {
  const t = 0;
  expect(smsAllowed(1, '+5511999998888', t)).toBe(true);
  expect(smsAllowed(1, '+5511999998888', t + 10_000)).toBe(false); // mesmo número, <60s
  expect(smsAllowed(1, '+5511999998888', t + 61_000)).toBe(true); // janela reabriu
});

test('smsAllowed: cap por usuário na janela', () => {
  const t = 0;
  // números diferentes pra não bater no cap por-número
  for (let i = 0; i < SMS_PER_USER; i++) {
    expect(smsAllowed(7, `+55110000000${i}`, t)).toBe(true);
  }
  expect(smsAllowed(7, '+5511000000098', t)).toBe(false); // 4º na janela do usuário 7
  expect(smsAllowed(9, '+5511000000097', t)).toBe(true); // outro usuário, número novo → ok
});

// ─── loginDelayMs (M-3) ─────────────────────────────────────────────

test('loginDelayMs: 4 falhas de graça, depois escala e capa em 20s', () => {
  const k = 'hugo';
  const t = 0;
  for (let i = 0; i < 5; i++) {
    expect(loginDelayMs(k, t)).toBe(0); // n = 0..4 → sem atraso
    recordLoginFail(k, t);
  }
  expect(loginDelayMs(k, t)).toBe(500); // n=5 → 2^0 * 500
  recordLoginFail(k, t);
  expect(loginDelayMs(k, t)).toBe(1000); // n=6 → 2^1 * 500
  for (let i = 0; i < 20; i++) recordLoginFail(k, t);
  expect(loginDelayMs(k, t)).toBe(20_000); // capado
});

test('recordLoginOk: zera o histórico', () => {
  const k = 'hugo';
  for (let i = 0; i < 8; i++) recordLoginFail(k, 0);
  expect(loginDelayMs(k, 0)).toBeGreaterThan(0);
  recordLoginOk(k);
  expect(loginDelayMs(k, 0)).toBe(0);
});

test('loginDelayMs: histórico esquecido após o TTL', () => {
  const k = 'hugo';
  for (let i = 0; i < 8; i++) recordLoginFail(k, 0);
  expect(loginDelayMs(k, 0)).toBeGreaterThan(0);
  expect(loginDelayMs(k, 61 * 60 * 1000)).toBe(0); // > 1h depois
});

// ─── sweep ──────────────────────────────────────────────────────────

test('sweep: descarta janelas e históricos expirados sem afetar os vivos', () => {
  hit('velho', 1, 1000, 0);
  hit('novo', 1, 100_000, 0);
  recordLoginFail('velho-fail', 0);
  sweep(2000); // janela "velho" expirou (resetAt=1000); "novo" ainda vale
  expect(hit('velho', 1, 1000, 2000).ok).toBe(true); // recriada = como nova
  expect(hit('novo', 1, 100_000, 2000).ok).toBe(false); // sobreviveu, já tinha 1
});
