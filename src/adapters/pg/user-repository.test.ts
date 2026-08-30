import { test, expect } from 'bun:test';
import { mapUserRow } from './user-repository.js';

const baseRow = {
  id: '42',
  name: 'hugo',
  password: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
  timestamp_creation: new Date('2026-08-21T10:00:00Z'),
  timestamp_password_change: null,
  auth_2: false,
  phone: null,
  backup_codes: null,
  timestamp_last_session: null,
  ips_using: '["10.0.0.1","10.0.0.2"]',
};

test('mapUserRow descarta o hash de senha da entidade', () => {
  const user = mapUserRow({ ...baseRow });
  expect('password' in user).toBe(false);
});

test('mapUserRow converte BIGSERIAL (string) para number', () => {
  expect(mapUserRow({ ...baseRow }).id).toBe(42);
});

test('mapUserRow parseia ips_using (JSON em TEXT) para string[]', () => {
  expect(mapUserRow({ ...baseRow }).ipsUsing).toEqual(['10.0.0.1', '10.0.0.2']);
});

test('mapUserRow tolera ips_using nulo ou inválido → []', () => {
  expect(mapUserRow({ ...baseRow, ips_using: null }).ipsUsing).toEqual([]);
  expect(mapUserRow({ ...baseRow, ips_using: 'não-json' }).ipsUsing).toEqual([]);
});

test('mapUserRow preserva flags', () => {
  const user = mapUserRow({ ...baseRow, auth_2: true });
  expect(user.auth2).toBe(true);
});

test('mapUserRow expõe phone mas nunca backup_codes', () => {
  const user = mapUserRow({ ...baseRow, phone: '+5511999999999', backup_codes: 'h1|h2' });
  expect(user.phone).toBe('+5511999999999');
  expect('backup_codes' in user).toBe(false);
  expect('backupCodes' in user).toBe(false);
  expect(mapUserRow({ ...baseRow }).phone).toBeNull();
});
