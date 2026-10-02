/**
 * Hashing de senha com **argon2id** — usado pela camada de aplicação antes de
 * qualquer senha tocar o banco. A coluna `user_cli.password` guarda a PHC string
 * resultante; a coluna `password_pepper_id` guarda qual pepper foi usado (ADR
 * 0011). Texto puro nunca é persistido nem logado.
 *
 * `@node-rs/argon2` (napi, binários pré-compilados). Params = default OWASP
 * (memória 19 MiB, 2 iterações, paralelismo 1), ajustáveis por env
 * (`NIO_ARGON2_*`, ADR 0011 §C). Pepper via o `secret` do argon2 (§A).
 */
import type { Algorithm } from '@node-rs/argon2';
import { currentPepperId, pepperFor } from './secrets.js';
import { MIN_PASSWORD_LENGTH } from './password-policy.js';

// `Algorithm` do @node-rs/argon2 é um `const enum` ambiente, que `isolatedModules`
// proíbe acessar por valor. Usamos o literal com cast (Argon2id === 2).
const ARGON2ID = 2 as Algorithm;

/** Reexportado por compatibilidade — a fonte é `./password-policy.js`. */
export { MIN_PASSWORD_LENGTH };

/** Cache do binding nativo: só o módulo resolvido entra, falha nunca é memoizada. */
let binding: typeof import('@node-rs/argon2') | null = null;

/**
 * Carrega `@node-rs/argon2` sob demanda — `import type` acima é erasado, então
 * nenhum consumidor paga o binding só por importar este módulo.
 */
async function argon2(): Promise<typeof import('@node-rs/argon2')> {
  if (binding) return binding;
  try {
    binding = await import('@node-rs/argon2');
    return binding;
  } catch (cause) {
    throw new Error(BINDING_AUSENTE, { cause });
  }
}

/** A mensagem do napi manda apagar o package-lock.json — que este pacote não publica. */
const BINDING_AUSENTE =
  'O binário nativo do argon2 (@node-rs/argon2) não foi encontrado — sem ele o nio-gateway ' +
  'não consegue hashear nem conferir senha.\n' +
  'Causa provável: o bug do npm com dependências opcionais (npm/cli#4828) deixou o pacote ' +
  'da sua plataforma de fora da instalação.\n' +
  'Correção: npm i -g @nio-cli/cli --force';

/** Um flag numérico de env com default. */
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Params de argon2id em vigor — default = piso OWASP, override por `NIO_ARGON2_*`. */
export function currentArgon2Options(): {
  algorithm: Algorithm;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} {
  return {
    algorithm: ARGON2ID,
    memoryCost: envInt('NIO_ARGON2_MEMORY_MIB', 19) * 1024,
    timeCost: envInt('NIO_ARGON2_TIME', 2),
    parallelism: envInt('NIO_ARGON2_PARALLELISM', 1),
  };
}

export interface PasswordHash {
  /** PHC string do argon2 — vai pra `user_cli.password`. */
  phc: string;
  /** Pepper usado — vai pra `user_cli.password_pepper_id`. */
  pepperId: number;
}

/** Gera o hash argon2id (com o pepper atual, se houver) de uma senha em texto puro. */
export async function hashPassword(plain: string): Promise<PasswordHash> {
  if (plain.length === 0) {
    return Promise.reject(new Error('Senha vazia não pode ser hasheada.'));
  }
  const pepperId = currentPepperId();
  const secret = pepperFor(pepperId);
  const { hash } = await argon2();
  const phc = await hash(plain, { ...currentArgon2Options(), ...(secret ? { secret } : {}) });
  return { phc, pepperId };
}

/**
 * Confere uma senha contra um hash argon2id. `pepperId` = o gravado junto do
 * hash (`user_cli.password_pepper_id`). Retorna `false` (nunca lança) se o hash
 * for inválido/ilegível ou o pepper não bater.
 */
export async function verifyPassword(
  storedHash: string,
  plain: string,
  pepperId: number,
): Promise<boolean> {
  // Fora do `try`: binding ausente é falha de instalação e precisa propagar —
  // engolido aqui viraria "senha incorreta" e mandaria o usuário caçar fantasma.
  const { verify } = await argon2();
  try {
    const secret = pepperFor(pepperId);
    return await verify(storedHash, plain, secret ? { secret } : undefined);
  } catch {
    return false;
  }
}

/**
 * O hash precisa ser refeito? `true` se os params do argon2 mudaram OU o pepper
 * está desatualizado (ADR 0011 §B — re-hash on login). Formato estranho → `true`.
 */
export function needsRehash(phc: string, pepperId: number): boolean {
  if (pepperId !== currentPepperId()) return true;
  const m = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
  if (!m) return true;
  const opt = currentArgon2Options();
  return (
    Number(m[1]) !== opt.memoryCost ||
    Number(m[2]) !== opt.timeCost ||
    Number(m[3]) !== opt.parallelism
  );
}
