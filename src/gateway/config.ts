/** 
 * Configuração do Gateway, só JWT por enquanto. 'JWT_SECRET'/'JWT_EXPIRES_IN'sem 
 *  prefixo "NIO"de proposito: são o segredo distribuido pela equipe (mesmo valor
 *  em toda maquina)não uma env var por-processo com as demais.
 */

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
