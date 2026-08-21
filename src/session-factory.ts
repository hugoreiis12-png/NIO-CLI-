import { createAuthenticatedClient } from './adapters/supabase/client.js';
import { createSupabaseGateway } from './adapters/supabase/gateway.js';
import type { Gateway } from './core/ports.js';
import type { User } from './core/types.js';

/**
 * Sessão pronta para injetar no `ToolContext`: identidade + gateway de dados.
 * Nenhum client cru vaza daqui — TODO acesso ao backend passa pelo `gateway`.
 */
export interface Session {
  gateway: Gateway;
  user: User;
}

export type Backend = 'supabase';

/**
 * Escolhe o backend e monta a sessão. Este `switch` é o ÚNICO ponto que decide
 * qual adaptador roda — trocar de dependência = adicionar um `case` novo aqui,
 * sem tocar em nenhuma tool nem no `mcp-server`.
 */
export async function createSession(backend: Backend = 'supabase'): Promise<Session> {
  switch (backend) {
    case 'supabase': {
      const { supabase, user } = await createAuthenticatedClient();
      return { user, gateway: createSupabaseGateway(supabase) };
    }
    default:
      // ponytail: guard exaustivo — um backend novo sem case vira erro de tipo aqui.
      throw new Error(`Backend desconhecido: ${backend satisfies never}`);
  }
}
