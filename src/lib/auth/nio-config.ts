/**
 * Config compartilhada da equipe em `~/.nio/config.env` (`NIO_DATABASE_URL`,
 * `JWT_SECRET`). Ler/gravar (chmod 600), validar, e o wizard que `nio init`/
 * `register`/`login` disparam quando falta algo. `load-env.ts` carrega no boot.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { brand, homePath } from '../../brand.js';
import { NIO_AI_BASE_URL, NIO_AI_MODEL_ID } from '../clients/client-configs.js';
import { closePool, ping } from '../../adapters/pg/client.js';
import { generateJwtSecret, jwtSecretWeakness } from '../../gateway/config.js';
import { input, password, confirm } from '../prompts.js';
import { c, sym, box, cmd } from '../colors.js';
import { dlog } from '../debug.js';

export const CONFIG_FILE = homePath('config.env');
const PG_URL = /^postgres(ql)?:\/\/.+/i;

export interface ConfigProblem {
  key: string;
  issue: 'missing' | 'invalid' | 'unreachable';
  hint: string;
}

/** Parse simples de `KEY=value` (ignora `#` comentário e linha vazia). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function readConfigFile(path = CONFIG_FILE): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** Funde `updates` no arquivo (cria se não existe), preservando o resto. chmod 600. */
export function writeConfigFile(updates: Record<string, string>, path = CONFIG_FILE): void {
  const merged = { ...readConfigFile(path), ...updates };
  const body =
    '# Config da NIO-CLI — gerado por `nio config setup`. Não commitar.\n' +
    Object.entries(merged)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // `mode` fecha a janela do arquivo novo em 0644 (auditoria L-4); o chmod cobre
  // um arquivo pré-existente com permissão frouxa.
  writeFileSync(path, body, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* chmod não existe no Windows */
  }
}

/** Validação síncrona (sem rede): `NIO_DATABASE_URL` e `JWT_SECRET` presentes/ok. */
export function validateConfigShape(env: NodeJS.ProcessEnv): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const url = env.NIO_DATABASE_URL?.trim();
  const jwt = env.JWT_SECRET?.trim();

  if (!url) {
    problems.push({ key: 'NIO_DATABASE_URL', issue: 'missing', hint: 'endereço do Postgres da equipe' });
  } else if (!PG_URL.test(url)) {
    problems.push({ key: 'NIO_DATABASE_URL', issue: 'invalid', hint: 'precisa começar com postgres://' });
  }
  // `JWT_SECRETS` (rotação por kid, ADR 0011) supre o `JWT_SECRET` — o gateway
  // lança no boot se a lista estiver malformada, então aqui só checamos presença.
  const hasJwtSecrets = Boolean(env.JWT_SECRETS?.trim());
  if (!jwt && !hasJwtSecrets) {
    problems.push({ key: 'JWT_SECRET', issue: 'missing', hint: 'segredo compartilhado do time (assina o login) — ou use JWT_SECRETS' });
  } else if (jwt) {
    const weak = jwtSecretWeakness(jwt);
    if (weak) problems.push({ key: 'JWT_SECRET', issue: 'invalid', hint: weak });
  }
  return problems;
}

/** Mascara a senha da connection string pro log. */
function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@');
}

/** Checa a config já carregada em `process.env`, incluindo um `SELECT 1`. `[]` = ok. */
export async function checkConfig(): Promise<ConfigProblem[]> {
  dlog('config: NIO_DATABASE_URL =', process.env.NIO_DATABASE_URL ? maskUrl(process.env.NIO_DATABASE_URL) : '(vazio)');
  dlog('config: JWT_SECRET =', process.env.JWT_SECRET ? `(${process.env.JWT_SECRET.length} chars)` : '(vazio)');
  dlog('config: NIO_GATEWAY_URL =', process.env.NIO_GATEWAY_URL ?? '(default :3000 = nio-gateway direto)');
  const problems = validateConfigShape(process.env);
  if (!problems.some((p) => p.key === 'NIO_DATABASE_URL')) {
    await closePool();
    const ok = await ping();
    dlog('config: SELECT 1 =>', ok ? 'ok' : 'FALHOU');
    if (!ok) {
      problems.push({
        key: 'NIO_DATABASE_URL',
        issue: 'unreachable',
        hint: 'não conectou — confira host/porta/credencial e a rede/VPN',
      });
    }
  }
  return problems;
}

export interface AiBackendStatus {
  ok: boolean;
  models: string[];
  detail: string;
}

/**
 * Sonda o backend de IA (`GET <base>/models`): precisa estar no ar **e** servir
 * o `NIO_AI_MODEL_ID`. Consultivo — `nio config check` avisa sem reprovar, e o
 * `ensureConfig` não bloqueia por isso (comandos sem IA seguem funcionando).
 * `baseURL` é seam pra teste (default = `NIO_AI_BASE_URL`).
 */
export async function probeAiBackend(
  timeoutMs = 8000,
  baseURL: string = NIO_AI_BASE_URL,
): Promise<AiBackendStatus> {
  const base = baseURL.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models`, { signal: controller.signal });
    if (!res.ok) return { ok: false, models: [], detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    if (!models.includes(NIO_AI_MODEL_ID)) {
      return {
        ok: false,
        models,
        detail: `no ar, mas não serve ${NIO_AI_MODEL_ID} (serve: ${models.join(', ') || 'nada'})`,
      };
    }
    return { ok: true, models, detail: `no ar e serve ${NIO_AI_MODEL_ID}` };
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return { ok: false, models: [], detail: `inacessível (${cause})` };
  } finally {
    clearTimeout(timer);
  }
}

interface WizardValues {
  url: string;
  ssl: boolean;
  jwt: string;
}

/** Os prompts do wizard (default = valor atual, se houver). */
async function promptWizard(): Promise<WizardValues> {
  const file = readConfigFile();
  const url = (
    await input({
      message: 'NIO_DATABASE_URL  (postgres://user:senha@host:5432/nio_cli)',
      default: process.env.NIO_DATABASE_URL ?? file.NIO_DATABASE_URL,
      validate: (v) => PG_URL.test(v.trim()) || 'precisa começar com postgres://',
    })
  ).trim();
  const ssl = await confirm({ message: 'O banco exige TLS/SSL? (gerenciado/nuvem)', default: false });
  const jwt = await promptJwtSecret(file.JWT_SECRET ?? process.env.JWT_SECRET);
  return { url, ssl, jwt };
}

/**
 * `JWT_SECRET`: se o time ainda não tem um, gera um forte aqui e o usuário
 * distribui; senão, cola o valor do time (validado por `jwtSecretWeakness`).
 */
async function promptJwtSecret(current: string | undefined): Promise<string> {
  if (!current || jwtSecretWeakness(current)) {
    const gen = await confirm({
      message: 'Gerar um JWT_SECRET novo? (só se o time ainda não tem um — invalida sessões atuais)',
      default: !current,
    });
    if (gen) {
      const secret = generateJwtSecret();
      console.log(
        box(
          `${c.bold('JWT_SECRET gerado')} — distribua ${c.bold('este mesmo valor')} pra toda\n` +
            `máquina que roda o \`nio-gateway\` (ele assina/verifica o login):\n\n  ${c.green(secret)}`,
          { borderColor: 'green', title: 'guarde agora' },
        ),
      );
      return secret;
    }
  }
  return (
    await password({
      message: 'JWT_SECRET  (segredo compartilhado do time)',
      mask: '*',
      validate: (v) => jwtSecretWeakness(v.trim()) ?? true,
    })
  ).trim();
}

/** Wizard: cola `NIO_DATABASE_URL` + `JWT_SECRET`, testa a conexão, grava o arquivo. */
export async function runConfigWizard(): Promise<boolean> {
  console.log(
    box(
      `${c.bold('Configuração da NIO-CLI')}\n` +
        `${c.dim('Cole os valores que o time te passou — vão pra')} ${cmd(CONFIG_FILE)}\n` +
        `${c.dim('(só nesta máquina, chmod 600, nunca commitado).')}`,
      { borderColor: 'cyan', title: 'nio config' },
    ),
  );
  const { url, ssl, jwt } = await promptWizard();

  await closePool();
  process.env.NIO_DATABASE_URL = url;
  process.env.NIO_DATABASE_SSL = ssl ? 'true' : '';
  process.env.JWT_SECRET = jwt;

  process.stdout.write(c.dim('  testando a conexão com o Postgres… '));
  if (!(await ping())) {
    console.log(c.red(sym.err));
    console.error(`  ${c.red('Não conectei.')} Confira o endereço/credencial e a rede/VPN, e rode de novo.`);
    return false;
  }
  console.log(c.green(sym.ok));

  const updates: Record<string, string> = { NIO_DATABASE_URL: url, JWT_SECRET: jwt };
  if (ssl) updates.NIO_DATABASE_SSL = 'true';
  writeConfigFile(updates);
  console.log(`  ${c.green(sym.ok)} salvo em ${cmd(CONFIG_FILE)}`);
  return true;
}

function problemsBox(problems: ConfigProblem[]): string {
  const label = { missing: 'faltando', invalid: 'inválido', unreachable: 'sem conexão' };
  return box(
    `${c.yellow(sym.warn)} ${c.bold('Config incompleta ou inválida.')}\n\n` +
      problems
        .map((p) => `${c.red(sym.err)} ${c.bold(p.key)} ${c.dim('— ' + label[p.issue])}\n   ${c.dim(p.hint)}`)
        .join('\n') +
      `\n\n${c.dim('Rode')} ${cmd(`${brand.name} config setup`)} ${c.dim('ou crie')} ${cmd(CONFIG_FILE)} ${c.dim('com:')}\n` +
      `   ${c.dim('NIO_DATABASE_URL=postgres://user:senha@host:5432/nio_cli')}\n` +
      `   ${c.dim('JWT_SECRET=<segredo-do-time>')}`,
    { borderColor: 'yellow', title: 'Configuração necessária' },
  );
}

/**
 * Garante a config antes de um comando que precisa dela. TTY + algo faltando/
 * inválido → dispara o wizard. Só rede fora, ou não-TTY → erro e `exit 1`.
 */
export async function ensureConfig(opts: { interactive: boolean }): Promise<void> {
  let problems = await checkConfig();
  if (problems.length === 0) return;

  const fixable = problems.some((p) => p.issue !== 'unreachable');
  if (opts.interactive && process.stdin.isTTY && fixable && (await runConfigWizard())) {
    problems = await checkConfig();
    if (problems.length === 0) return;
  }

  console.error(problemsBox(problems));
  process.exit(1);
}
