/**
 * Log estruturado do gateway — uma linha JSON por evento, sempre em stderr.
 *
 * stderr e não stdout porque o gateway pode um dia escrever dado em stdout; a
 * trilha operacional fica separada e o `docker logs` continua pegando as duas.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Emite um evento. `fields` é achatado na raiz do JSON para o log virar consulta
 * (`jq 'select(.traceId=="…")'`) sem precisar de caminho aninhado.
 *
 * Nunca passe senha, OTP, token ou JWT em `fields` — isto vai para o stdout do
 * container, que não tem o mesmo controle de acesso que `auth_events`.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: LogLevel = 'info',
): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}