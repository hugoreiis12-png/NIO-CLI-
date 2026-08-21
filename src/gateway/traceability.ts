/**
 * Log de acesso — MVP: linha estruturada em stderr. Sem storage persistente
 * ainda (spec 0002, limitação assumida pro uso interno).
 */

// Função para logar eventos de acesso, como login aprovado, login rejeitado ou sessão validada 
export interface AccessEvent {
  event: 'login_approved' | 'login_rejected' | 'session_validated' | 'session_revoked';
  userId?: string;
  email?: string;
  userAgent?: string | null;
  reason?: string;
}

export function logAccess(ev: AccessEvent): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), ...ev }));
}
