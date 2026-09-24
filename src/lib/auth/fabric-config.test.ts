import { test, expect } from 'bun:test';
import { fabricConfigStatus, describeFabricConfig } from './fabric-config.js';

const SP = {
  AZURE_TENANT_ID: 't',
  AZURE_CLIENT_ID: 'c',
  AZURE_CLIENT_SECRET: 's',
} as NodeJS.ProcessEnv;

test('sem credencial → grant nulo', () => {
  expect(fabricConfigStatus({} as NodeJS.ProcessEnv).grant).toBeNull();
});

test('tenant+client+secret → service principal', () => {
  expect(fabricConfigStatus(SP).grant).toBe('service_principal');
});

test('par de usuário vence o secret (é o que respeita RLS)', () => {
  const env = { ...SP, NIO_FABRIC_USERNAME: 'a@b.c', NIO_FABRIC_PASSWORD: 'x' } as NodeJS.ProcessEnv;
  expect(fabricConfigStatus(env).grant).toBe('user');
});

test('client id sem tenant não vale credencial', () => {
  expect(fabricConfigStatus({ AZURE_CLIENT_ID: 'c' } as NodeJS.ProcessEnv).grant).toBeNull();
});

test('workspace/dataset default só contam se os dois existirem', () => {
  const so_ws = { ...SP, NIO_FABRIC_WORKSPACE: 'w' } as NodeJS.ProcessEnv;
  expect(fabricConfigStatus(so_ws).hasTarget).toBe(false);
  const ambos = { ...so_ws, NIO_FABRIC_DATASET: 'd' } as NodeJS.ProcessEnv;
  expect(fabricConfigStatus(ambos).hasTarget).toBe(true);
});

test('ACEITE: sem credencial a mensagem diz o que quebra e como resolver', () => {
  // A regressão era o `config check` dizer "config ok" e o `nio fabric` recusar logo depois.
  const linha = describeFabricConfig({ grant: null, hasTarget: false });
  expect(linha).toContain('sem credencial');
  expect(linha).toContain('nio config setup');
});

test('token de usuário é anunciado como tal (RLS depende disso)', () => {
  expect(describeFabricConfig({ grant: 'user', hasTarget: true })).toContain('RLS');
});

test('service principal configurado mas sem alvo default avisa', () => {
  const linha = describeFabricConfig({ grant: 'service_principal', hasTarget: false });
  expect(linha).toContain('sem workspace/dataset default');
});
