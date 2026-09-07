/**
 * Configuração do Gateway. `JWT_SECRET`/`JWT_EXPIRES_IN` sem prefixo `NIO_`
 */
import { randomBytes } from 'node:crypto';
import { env } from '../brand.js';

/**
 * Piso de tamanho do `JWT_SECRET`. HS256 + um JWT capturado = ataque de
 * força-bruta offline sobre o segredo; 32 chars aleatórios (>128 bits) tiram
 * isso da mesa. É o fallback da chave do HMAC do OTP quando `OTP_HMAC_SECRET`
 * não está setada (ADR 0011 §D).
 */
export const MIN_JWT_SECRET_LENGTH = 32;

/** Porta do `nio-gateway` em si. Default 3000 — Kong faz proxy pra cá por trás. */
export const GATEWAY_PORT = Number(env('GATEWAY_PORT')?.trim()) || 3000;

/**
 * Interface de bind do `nio-gateway`. Default `127.0.0.1` (loopback only). Ponha
 * `0.0.0.0` quando o Kong roda em container e precisa alcançar via `host.docker.internal`
 * — a segurança segue no `X-Nio-Gateway-Token` + rejeição de `Origin`, não no bind.
 */
export const GATEWAY_HOST = env('GATEWAY_HOST')?.trim() || '127.0.0.1';

/** Porta de proxy do Kong (padrão dele). Default 8000 — é o que a CLI chama agora, não mais o `nio-gateway` direto. */
/**
 * URL base pro cliente HTTP (CLI). **Default: o `nio-gateway` direto** (`:3000`) —
 * setup single-user não tem Kong. Quem roda o Kong na frente aponta
 * `NIO_GATEWAY_URL=http://127.0.0.1:8000`.
 */
export const GATEWAY_URL =
  env('GATEWAY_URL')?.trim() || `http://127.0.0.1:${GATEWAY_PORT}`;

/**
 * Valida a força de um `JWT_SECRET`. Devolve o motivo da rejeição, ou `null` se
 * passa. Pura (sem env) — reusada pelo wizard (`validateConfigShape`) e por
 * `getJwtSecret`. Regra: ≥ 32 chars e variedade mínima (barra
 * `"aaaa…"`/`"12121212…"` que "têm 32 chars" mas zero entropia).
 */
export function jwtSecretWeakness(secret: string): string | null {
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `muito curto (${secret.length} chars) — mínimo ${MIN_JWT_SECRET_LENGTH}`;
  }
  if (new Set(secret).size < 8) {
    return 'baixa variedade de caracteres — use um valor aleatório, não uma frase repetida';
  }
  return null;
}

/** Gera um `JWT_SECRET` forte (32 bytes aleatórios → 43 chars base64url). */
export function generateJwtSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Lê e valida `JWT_SECRET`. Throw com mensagem acionável se ausente ou fraco. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET não definida. Rode `nio config setup` (gera um valor forte) ou ' +
        'defina a env var com o segredo do time.',
    );
  }
  const weak = jwtSecretWeakness(secret);
  if (weak) {
    throw new Error(
      `JWT_SECRET fraco: ${weak}. Gere um novo com \`nio config setup\` e distribua ` +
        'o mesmo valor pra toda a equipe (invalida as sessões atuais).',
    );
  }
  return secret;
}

/** Validade do token -string no formato do 'jsonwebtoken'(ex; '12h' , '30m'). Default 12h. */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '12h';

/**
 * Claims `iss`/`aud` — assinados na emissão e exigidos na verificação (auditoria
 * L-6). Defesa em profundidade: um token assinado com o mesmo segredo pra outro
 * propósito não passa aqui. Trocar isto invalida os tokens em circulação (força
 * re-login) — soltar junto da rotação do `JWT_SECRET`.
 */
export const JWT_ISSUER = 'nio-gateway';
export const JWT_AUDIENCE = 'nio-cli';
