import { test, expect } from 'bun:test';
import {
  powerbiMcp,
  postgresMcp,
  excelMcp,
  hasFabricServicePrincipal,
  localPowerBiDeclared,
  resolveFabricMcps,
} from './mcps.js';

const SP = { AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv;
const LOCAL = { NIO_PBI_LOCAL: '1' } as NodeJS.ProcessEnv;
const SP_LOCAL = { ...SP, ...LOCAL } as NodeJS.ProcessEnv;

test('hasFabricServicePrincipal: só true com as 3 credenciais', () => {
  expect(hasFabricServicePrincipal(SP)).toBe(true);
  expect(hasFabricServicePrincipal({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c' } as NodeJS.ProcessEnv)).toBe(false);
  expect(hasFabricServicePrincipal({} as NodeJS.ProcessEnv)).toBe(false);
});

test('localPowerBiDeclared: só com declaração explícita (flag --local ou env)', () => {
  expect(localPowerBiDeclared({ NIO_PBI_LOCAL: '1' } as NodeJS.ProcessEnv)).toBe(true);
  expect(localPowerBiDeclared({ NIO_PBI_LOCAL: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  expect(localPowerBiDeclared({ NIO_PBI_LOCAL: '0' } as NodeJS.ProcessEnv)).toBe(false);
  expect(localPowerBiDeclared({} as NodeJS.ProcessEnv)).toBe(false); // default = nuvem
});

test('sem declarar conexão local, o powerbi-modeling NÃO sobe (default)', () => {
  const out = resolveFabricMcps([powerbiMcp, postgresMcp, excelMcp], {} as NodeJS.ProcessEnv);
  expect(out.map((m) => m.id)).toEqual(['postgres', 'excel']);
});

test('sem declarar local, nem com service principal o powerbi sobe (nuvem = REST)', () => {
  const out = resolveFabricMcps([powerbiMcp, excelMcp], SP);
  expect(out.some((m) => m.id === powerbiMcp.id)).toBe(false);
});

test('NIO_PBI_LOCAL=1 sobe o powerbi em Desktop-local, sem authmode', () => {
  const out = resolveFabricMcps([powerbiMcp, excelMcp], LOCAL);
  const pbi = out.find((m) => m.id === powerbiMcp.id);
  expect(pbi).toBeDefined();
  expect(pbi!.command).not.toContain('--authmode=serviceprincipal');
  expect(pbi!.environment).toBeUndefined(); // sem SP no env, nada a isolar
});

test('local declarado COM service principal: isola os AZURE_* (senão drena pro Fabric)', () => {
  const out = resolveFabricMcps([powerbiMcp, postgresMcp], SP_LOCAL);
  const pbi = out.find((m) => m.id === powerbiMcp.id)!;
  expect(pbi.environment).toMatchObject({
    AZURE_TENANT_ID: '',
    AZURE_CLIENT_ID: '',
    AZURE_CLIENT_SECRET: '',
  });
  expect(pbi.command).not.toContain('--authmode=serviceprincipal');
  expect(out.find((m) => m.id === postgresMcp.id)).toBe(postgresMcp); // outros intactos
});

test('resolveFabricMcps nunca muta o spec original', () => {
  resolveFabricMcps([powerbiMcp], SP_LOCAL);
  expect(powerbiMcp.environment).toBeUndefined();
  expect(powerbiMcp.command).not.toContain('--authmode=serviceprincipal');
});

test('aceita "true" além de "1" na declaração de local', () => {
  const out = resolveFabricMcps([powerbiMcp], { NIO_PBI_LOCAL: 'true' } as NodeJS.ProcessEnv);
  expect(out.some((m) => m.id === powerbiMcp.id)).toBe(true);
});
