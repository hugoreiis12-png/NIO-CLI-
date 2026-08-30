/**
 * Hashing de senha com **argon2id** — usado pela camada de aplicação antes de
 * qualquer senha tocar o banco. A coluna `user_cli.password` guarda a PHC string
 * resultante; texto puro nunca é persistido nem logado.
 *
 * `@node-rs/argon2` (napi, binários pré-compilados) — sem node-gyp, funciona em
 * Windows/macOS/Linux. Os parâmetros abaixo são o default recomendado do OWASP
 * para argon2id (memória 19 MiB, 2 iterações, paralelismo 1).
 */
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

// `Algorithm` do @node-rs/argon2 é um `const enum` ambiente, que `isolatedModules`
// proíbe acessar por valor. Usamos o literal com cast (Argon2id === 2).
const ARGON2ID = 2 as Algorithm;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Gera o hash argon2id (PHC string) de uma senha em texto puro. */
export function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) {
    return Promise.reject(new Error('Senha vazia não pode ser hasheada.'));
  }
  return hash(plain, OPTIONS);
}

/**
 * Confere uma senha contra um hash argon2id. Retorna `false` (nunca lança) se o
 * hash for inválido/ilegível — o chamador trata como "não confere".
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
