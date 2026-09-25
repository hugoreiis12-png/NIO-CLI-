import { test, expect } from 'bun:test';
import { fabricConfigStatus, describeFabricConfig, GRANT_CHOICES } from './fabric-config.js';

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

test('ACEITE: token de usuário vem primeiro e é o default — o SP não consulta aqui', () => {
  // Bug de prod: a 1ª opção era "service principal — o mesmo pra toda a equipe". Medido
  // no tenant: ele LISTA 24 workspaces e sincroniza schema, mas o executeQueries devolve
  // 401 PowerBINotAuthorizedException. O colaborador escolheu o que soava de time e
  // ficou sem conseguir consultar.
  expect(GRANT_CHOICES[0]!.value).toBe('user');
  expect(GRANT_CHOICES[1]!.value).toBe('service_principal');
});

test('a opção do service principal avisa do 401 em vez de parecer a escolha de time', () => {
  const sp = GRANT_CHOICES.find((o) => o.value === 'service_principal')!;
  expect(sp.name).toContain('401');
  expect(sp.name).not.toContain('toda a equipe');
});

test('o rótulo do usuário diz que ele executa consulta (é o diferencial real)', () => {
  const u = GRANT_CHOICES.find((o) => o.value === 'user')!;
  expect(u.name).toContain('executa');
});
