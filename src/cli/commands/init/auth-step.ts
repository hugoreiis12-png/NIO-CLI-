import { loadCredentials } from "../../../auth.js";
import { createAuthenticatedClient, type AuthenticatedSession } from "../../../adapters/supabase/client.js";
import { startSpinner } from "../../../spinner.js";

/**
 * O `init` **não força mais login** — a auth está pausada até termos um backend
 * de alocação de logs (ver roadmap Fase 1/4). Aqui só checamos se já há
 * credenciais salvas de um `nio login` manual: se sim, o wizard segue o fluxo
 * completo (projeto + contexto do NOS); senão, cai no setup local. Nunca pede
 * PAT nem sai do processo.
 */
export async function hasCredentials(): Promise<boolean> {
  return Boolean(await loadCredentials());
}

/** Cria a sessão autenticada (client Supabase + user) usada pelo resto do wizard. */
export async function createSessionStep(): Promise<AuthenticatedSession> {
  const authSpinner = startSpinner("Carregando sessão...");
  try {
    const session = await createAuthenticatedClient();
    authSpinner.stop();
    return session;
  } catch (err) {
    authSpinner.fail((err as Error).message);
    process.exit(1);
  }
}
