/**
 * Shapes do Gateway de Auth — módulo à parte, acionado só no fluxo de
 * autenticação. Ver docs/specs/auth/0002-cli-native-login.md.
 *
 * Sem integração com Supabase e sem permissão/perfil nesta etapa inicial —
 * decisão explícita (2026-07-27): simplificado de propósito, os dois ficam
 * pra uma iteração futura.
 */

/** Identidade mínima resolvida ao fim do fluxo PKCE (self-asserted por enquanto). */
export interface GatewayUser {
  id: string;
  email: string;
}

export type LoginResponse =
  | { approved: true; token: string; expires_in: number; user: GatewayUser }
  | { approved: false; reason: string };

export type ValidateResponse =
  | { approved: true; user: GatewayUser }
  | { approved: false; reason: string };
