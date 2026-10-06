import { test, expect } from 'bun:test';
import type { McpSpec } from '../core/environment.js';
import {
  BI_GATEWAY_URL_ENV,
  PG_LEGACY_URL_ENV,
  PG_MAIN_URL_ENV,
  biGatewayPortainerMcp,
  biGatewaysCollide,
  daxStaffMcp,
  infraMcps,
  pgLegacyMcp,
  pgMainMcp,
} from './mcps-infra.js';

const URL_VELHA = 'postgresql://u:p@192.168.0.250:5432/postgres';
const URL_NOVO = 'postgresql://u:p@192.168.0.142:5432/postgres';

const comPg: NodeJS.ProcessEnv = {
  [PG_LEGACY_URL_ENV]: URL_VELHA,
  [PG_MAIN_URL_ENV]: URL_NOVO,
};

test('sem a env var da URL, o Postgres é omitido em vez de subir vazio', () => {
  expect(pgLegacyMcp({})).toBeNull();
  expect(pgMainMcp({})).toBeNull();
  expect(infraMcps({}).map((m) => m.id)).toEqual(['dax-staff-local', 'bi-gateway-portainer']);
});

/** Falha o teste (em vez de passar em silêncio) quando o spec vem nulo. */
function spec(m: McpSpec | null): McpSpec {
  if (!m) throw new Error('spec ausente — a env var da URL não foi lida');
  return m;
}

test('com a env var, a URL vai pro environment e a escrita fica desligada', () => {
  const velha = spec(pgLegacyMcp(comPg));
  expect(velha.id).toBe('postgres-velha');
  expect(velha.environment?.DATABASE_URL).toBe(URL_VELHA);
  expect(velha.environment?.WRITE_OPERATIONS_ENABLED).toBe('false');
  expect(spec(pgMainMcp(comPg)).environment?.DATABASE_URL).toBe(URL_NOVO);
});

test('os timeouts diferem por host — o banco com volume tem mais folga', () => {
  expect(spec(pgLegacyMcp(comPg)).timeout).toBe(10_000);
  expect(spec(pgMainMcp(comPg)).timeout).toBe(30_000);
  expect(daxStaffMcp({}).timeout).toBe(120_000);
  expect(biGatewayPortainerMcp({}).timeout).toBe(120_000);
});

test('nenhuma credencial no fonte: sem env var, nada de senha nos specs', () => {
  const serializado = JSON.stringify(infraMcps({}));
  expect(serializado).not.toContain('postgres:postgres');
  expect(serializado).not.toContain('@192.168.0.250');
});

test('os dois gateways de BI apontam pro mesmo endpoint — tools duplicadas', () => {
  // Não é bug do código, é o que o config do time declara. O teste registra o
  // fato pra que remover um deles seja uma decisão, não um acidente.
  expect(biGatewaysCollide({})).toBe(true);
  expect(daxStaffMcp({}).url).toBe('http://192.168.0.160:8011/mcp');
});

test('a URL dos gateways é sobreponível por env (host muda sem recompilar)', () => {
  const env = { [BI_GATEWAY_URL_ENV]: 'http://10.0.0.9:9000/mcp' };
  expect(daxStaffMcp(env).url).toBe('http://10.0.0.9:9000/mcp');
  expect(biGatewayPortainerMcp(env).url).toBe('http://10.0.0.9:9000/mcp');
});

test('todo spec de infra tem id único', () => {
  const ids = infraMcps(comPg).map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([
    'postgres-velha',
    'postgres-novo',
    'dax-staff-local',
    'bi-gateway-portainer',
  ]);
});
