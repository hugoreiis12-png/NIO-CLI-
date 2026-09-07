import { describe, expect, test } from 'bun:test';
import {
  generateBackupCodes,
  verifyBackupCode,
  markUsed,
  countRemaining,
  isBackupCodeFormat,
} from './backup-codes.js';

describe('generateBackupCodes', () => {
  test('10 códigos únicos de 8 chars do alfabeto sem confusáveis + pepperId', async () => {
    const { codes, hashes, pepperId } = await generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(hashes.split('|')).toHaveLength(10);
    expect(hashes).toContain('$argon2id$');
    expect(pepperId).toBe(0); // sem NIO_PEPPERS no ambiente de teste
  });
});

describe('verifyBackupCode / markUsed / countRemaining', () => {
  test('aceita código válido (case-insensitive), devolve o índice; rejeita inválido', async () => {
    const { codes, hashes, pepperId } = await generateBackupCodes();
    expect(await verifyBackupCode(codes[3]!, hashes, pepperId)).toBe(3);
    expect(await verifyBackupCode(codes[3]!.toLowerCase(), hashes, pepperId)).toBe(3);
    expect(await verifyBackupCode('AAAAAAAA', hashes, pepperId)).toBe(-1);
    expect(await verifyBackupCode(codes[0]!, null, pepperId)).toBe(-1);
  });

  test('markUsed torna a posição [USED]; countRemaining cai; não reaceita', async () => {
    const { codes, hashes, pepperId } = await generateBackupCodes();
    expect(countRemaining(hashes)).toBe(10);
    const after = markUsed(hashes, 3);
    expect(countRemaining(after)).toBe(9);
    expect(after.split('|')[3]).toBe('[USED]');
    expect(await verifyBackupCode(codes[3]!, after, pepperId)).toBe(-1); // já usado
    expect(await verifyBackupCode(codes[4]!, after, pepperId)).toBe(4); // outros seguem
  });

  test('countRemaining(null) = 0', () => {
    expect(countRemaining(null)).toBe(0);
  });
});

test('isBackupCodeFormat', () => {
  expect(isBackupCodeFormat('ABCD2345')).toBe(true);
  expect(isBackupCodeFormat(' abcd2345 ')).toBe(true);
  expect(isBackupCodeFormat('ABC-2345')).toBe(false);
  expect(isBackupCodeFormat('ABCD234')).toBe(false);
});
