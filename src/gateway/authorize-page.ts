/**
 * Página mínima do `/authorize` — só pede o email, sem senha (etapa inicial
 * sem verificação de credencial, ver spec 0002). Reenvia os parâmetros OAuth
 * como campos ocultos pro POST processar o code.
 */
export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderAuthorizePage(p: AuthorizeParams): string {
  const hidden = (name: string, value: string): string =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

  return `<!doctype html>
<html lang="pt-br">
<head><meta charset="utf-8"><title>nio — autorizar acesso</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto;">
  <h1>Autorizar ${escapeHtml(p.clientId)}</h1>
  <p>Confirme seu email para continuar.</p>
  <form method="POST" action="/authorize">
    ${hidden('client_id', p.clientId)}
    ${hidden('redirect_uri', p.redirectUri)}
    ${hidden('code_challenge', p.codeChallenge)}
    ${hidden('state', p.state)}
    <input type="email" name="email" placeholder="voce@exemplo.com" required
      style="width: 100%; padding: .5rem; font-size: 1rem; margin: .5rem 0;">
    <button type="submit" style="padding: .5rem 1rem; font-size: 1rem;">Autorizar</button>
  </form>
</body>
</html>`;
}
