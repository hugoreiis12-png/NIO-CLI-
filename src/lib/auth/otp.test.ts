import { describe, expect, test } from 'bun:test';
import { generateOtp, hashOtp, verifyOtp, isOtpFormat } from './otp.js';

const SECRET = 'test-jwt-secret';

describe('generateOtp', () => {
  test('sempre 6 dígitos, com zeros à esquerda', () => {
    for (let i = 0; i < 500; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtp / verifyOtp', () => {
  test('hash é hex de 64 chars (SHA-256), determinístico com mesmo secret', () => {
    const h = hashOtp('123456', SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp('123456', SECRET)).toBe(h);
  });
  test('secrets diferentes → hashes diferentes', () => {
    expect(hashOtp('123456', SECRET)).not.toBe(hashOtp('123456', 'outro'));
  });
  test('verify aceita o código certo, rejeita o errado', () => {
    const h = hashOtp('481920', SECRET);
    expect(verifyOtp('481920', h, SECRET)).toBe(true);
    expect(verifyOtp('481921', h, SECRET)).toBe(false);
  });
  test('verify não lança com hash malformado', () => {
    expect(verifyOtp('123456', 'zzz', SECRET)).toBe(false);
    expect(verifyOtp('123456', '', SECRET)).toBe(false);
  });
});

test('isOtpFormat', () => {
  expect(isOtpFormat('123456')).toBe(true);
  expect(isOtpFormat(' 123456 ')).toBe(true);
  expect(isOtpFormat('12345')).toBe(false);
  expect(isOtpFormat('1234567')).toBe(false);
  expect(isOtpFormat('12345a')).toBe(false);
});
