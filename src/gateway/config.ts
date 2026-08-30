/**
 * Configuração do Gateway. `JWT_SECRET`/`JWT_EXPIRES_IN` sem prefixo `NIO_`
 * de propósito: são o segredo distribuído pela equipe (mesmo valor em toda
 * máquina), não uma env var por-processo como as demais.
 */
import { env } from '../brand.js';

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

/** L6e e valida 'JWT_SECRET . Throw com mensagem acionavel se ausente . */
export function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret) {
        throw new Error(
            'JWT_SECRET não definida. Defina a variável de ambiente JWT_SECRET (ver `nio setup`, quando existir).',
        );
    }
    return secret;
}

/** Validade do token -string no formato do 'jsonwebtoken'(ex; '12h' , '30m'). Default 12h. */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '12h';
