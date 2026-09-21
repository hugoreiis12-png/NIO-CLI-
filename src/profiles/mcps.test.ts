import { test, expect } from 'bun:test';
import { powerbiMcp, postgresMcp, hasFabricServicePrincipal, withFabricAuth } from './mcps.js';

const SP = { AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv;

test('hasFabricServicePrincipal: só true com as 3 credenciais', () => {
  expect(hasFabricServicePrincipal(SP)).toBe(true);
  expect(hasFabricServicePrincipal({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c' } as NodeJS.ProcessEnv)).toBe(false);
  expect(hasFabricServicePrincipal({} as NodeJS.ProcessEnv)).toBe(false);
});

test('withFabricAuth: com SP, anexa --authmode=serviceprincipal ao powerbi (imutável)', () => {
  const out = withFabricAuth(powerbiMcp, SP);
  expect(out.command).toContain('--authmode=serviceprincipal');
  expect(powerbiMcp.command).not.toContain('--authmode=serviceprincipal'); // não muta o original
});

test('withFabricAuth: sem SP, mantém o comando Desktop-local intacto', () => {
  expect(withFabricAuth(powerbiMcp, {} as NodeJS.ProcessEnv)).toBe(powerbiMcp);
});

test('withFabricAuth: idempotente e só afeta o powerbi', () => {
  const once = withFabricAuth(powerbiMcp, SP);
  const twice = withFabricAuth(once, SP);
  expect(twice.command!.filter((a) => a === '--authmode=serviceprincipal')).toHaveLength(1);
  expect(withFabricAuth(postgresMcp, SP)).toBe(postgresMcp); // outro MCP não é tocado
});
