import { test, expect } from 'bun:test';
import { createDeltaBuffer, DELTA_FLUSH_MS } from './delta-buffer.js';
import type { PartDelta } from './state.js';

const d = (delta: string, field = 'text'): PartDelta => ({
  messageID: 'm1',
  partID: 'p1',
  field,
  delta,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('coalesce: N pushes na mesma janela viram UM flush, na ordem de chegada', async () => {
  const lotes: PartDelta[][] = [];
  const buf = createDeltaBuffer((b) => lotes.push(b), 10);
  for (const ch of ['a', 'b', 'c', 'd']) buf.push(d(ch));
  expect(lotes).toHaveLength(0); // nada renderiza de forma síncrona
  await sleep(30);
  expect(lotes).toHaveLength(1);
  expect(lotes[0]!.map((x) => x.delta).join('')).toBe('abcd');
});

test('flushNow esvazia na hora e não deixa flush duplicado agendado', async () => {
  const lotes: PartDelta[][] = [];
  const buf = createDeltaBuffer((b) => lotes.push(b), 10);
  buf.push(d('x'));
  buf.flushNow();
  expect(lotes).toHaveLength(1);
  await sleep(30);
  expect(lotes).toHaveLength(1); // o timer antigo não disparou um lote vazio
});

test('flushNow com buffer vazio não chama o callback (não força re-render)', () => {
  let chamadas = 0;
  const buf = createDeltaBuffer(() => chamadas++, 10);
  buf.flushNow();
  buf.flushNow();
  expect(chamadas).toBe(0);
});

test('push de dentro do callback não se perde — a referência troca antes do flush', async () => {
  const lotes: PartDelta[][] = [];
  let reentrou = false;
  const buf = createDeltaBuffer((b) => {
    lotes.push(b);
    if (!reentrou) {
      reentrou = true;
      buf.push(d('tardio')); // chega enquanto o render do lote anterior roda
    }
  }, 10);
  buf.push(d('primeiro'));
  await sleep(60);
  expect(lotes.map((l) => l.map((x) => x.delta).join(''))).toEqual(['primeiro', 'tardio']);
});

test('stop descarta o pendente e cancela o agendamento (unmount)', async () => {
  const lotes: PartDelta[][] = [];
  const buf = createDeltaBuffer((b) => lotes.push(b), 10);
  buf.push(d('perdido'));
  buf.stop();
  await sleep(30);
  expect(lotes).toHaveLength(0);
});

test('a janela default é ~30fps — abaixo o texto salta, acima o terminal não acompanha', () => {
  expect(DELTA_FLUSH_MS).toBeGreaterThanOrEqual(16);
  expect(DELTA_FLUSH_MS).toBeLessThanOrEqual(50);
});
