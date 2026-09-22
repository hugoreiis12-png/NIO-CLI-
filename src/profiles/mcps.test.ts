import { test, expect } from 'bun:test';
import {
  powerbiMcp,
  postgresMcp,
  excelMcp,
  hasFabricServicePrincipal,
  withFabricAuth,
  resolveFabricMcps,
} from './mcps.js';

const SP = { AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv;
const SP_XMLA = { ...SP, NIO_FABRIC_XMLA: '1' } as NodeJS.ProcessEnv;

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

test('resolveFabricMcps: sem SP, powerbi em Desktop-local (sem authmode)', () => {
  const specs = [powerbiMcp, excelMcp];
  const out = resolveFabricMcps(specs, {} as NodeJS.ProcessEnv);
  expect(out).toEqual(specs);
  expect(out.find((m) => m.id === powerbiMcp.id)?.command).not.toContain('--authmode=serviceprincipal');
});

test('resolveFabricMcps: com SP e sem opt-in, MANTÉM o powerbi em Desktop-local (Fabric = REST)', () => {
  const out = resolveFabricMcps([powerbiMcp, postgresMcp, excelMcp], SP);
  expect(out.map((m) => m.id)).toEqual(['powerbi-modeling', 'postgres', 'excel']); // nada removido
  expect(out.find((m) => m.id === powerbiMcp.id)?.command).not.toContain('--authmode=serviceprincipal');
});

test('resolveFabricMcps: opt-in NIO_FABRIC_XMLA=1 liga o Fabric-XMLA por service principal', () => {
  const out = resolveFabricMcps([powerbiMcp, excelMcp], SP_XMLA);
  const pbi = out.find((m) => m.id === powerbiMcp.id);
  expect(pbi?.command).toContain('--authmode=serviceprincipal');
  expect(out.find((m) => m.id === excelMcp.id)).toBe(excelMcp); // outro MCP intacto
});
