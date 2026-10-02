/**
 * Política de senha — constantes puras, **zero dependência nativa**.
 *
 * Mora fora de `password.ts` de propósito: aquele módulo carrega o binding
 * nativo do argon2, e o CLI cliente precisa só do piso de tamanho pra validar
 * o prompt de `nio register`. Importar `password.ts` por um número arrastava
 * `@node-rs/argon2` pro cold start de `nio` e um binding ausente derrubava até
 * `nio --help` (ver `cli/native-binding-boundary.test.ts`).
 */

/** Piso de tamanho da senha de usuário (NIST SP 800-63B — mín. 8 p/ senha escolhida). */
export const MIN_PASSWORD_LENGTH = 8;
