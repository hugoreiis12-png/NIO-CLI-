/**
 * SP-7 — recusa senha comprometida. Duas camadas:
 *
 *  1. **Lista local** (`COMMON`) — sempre, sem rede. Pega o grosso das tentativas
 *     óbvias (`123456`, `senha`, keyboard-walk, `admin`…).
 *  2. **Have I Been Pwned** (range API) — best-effort. SHA-1 da senha, manda só
 *     os 5 primeiros hex chars (k-anonymity: o prefixo não identifica a senha),
 *     procura o sufixo na resposta. Rede fora / timeout / erro → **fail-open**
 *     (só a camada 1 vale) — a checagem nunca bloqueia o cadastro por causa de
 *     infra.
 *
 * Desligar o HIBP (ambiente sem saída pra internet): `NIO_HIBP_DISABLE=1`.
 */
import { createHash } from 'node:crypto';

/**
 * Senhas mais comuns em dumps públicos (RockYou / SecLists top). Minúsculas — o
 * check normaliza. Não é exaustivo de propósito: a camada 2 cobre a cauda longa.
 */
const COMMON = new Set<string>([
  '123456', '123456789', '12345678', '1234567', '12345', '1234567890', '123123', '111111',
  '000000', '654321', '666666', '888888', '1234', '12345678910', '121212', '112233',
  'password', 'password1', 'password123', 'passw0rd', 'senha', 'senha123', 'minhasenha',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1q2w3e4r5t',
  'admin', 'admin123', 'administrator', 'root', 'toor', 'user', 'guest', 'test', 'test123',
  'welcome', 'welcome1', 'letmein', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess',
  'football', 'baseball', 'superman', 'batman', 'trustno1', 'master', 'shadow', 'michael',
  'jennifer', 'jordan', 'harley', 'hunter', 'ranger', 'buster', 'thomas', 'robert', 'daniel',
  'ashley', 'nicole', 'chelsea', 'matthew', 'access', 'flower', 'hottie', 'loveme', 'zaq1zaq1',
  'abc123', 'abcd1234', 'abcdef', 'a1b2c3d4', 'qazwsx', 'qazwsxedc', 'asdf1234', 'p@ssw0rd',
  'changeme', 'secret', 'whatever', 'freedom', 'starwars', 'computer', 'internet', 'samsung',
  'google', 'facebook', 'linkedin', 'nintendo', 'pokemon', 'mustang', 'corvette', 'ferrari',
  'brasil', 'brazil', 'flamengo', 'corinthians', 'palmeiras', 'saopaulo', 'gremio',
  'deus', 'jesus', 'amor', 'familia', 'cachorro', 'gabriel', 'rafael', 'fernanda', 'juliana',
]);

/** Lido por chamada (não no load) — testes ligam/desligam sem reimportar. */
function hibpTimeoutMs(): number {
  return Math.max(200, Number(process.env.NIO_HIBP_TIMEOUT_MS) || 1500);
}
function hibpDisabled(): boolean {
  return /^(1|true|yes|on)$/i.test((process.env.NIO_HIBP_DISABLE ?? '').trim());
}

export type BreachResult = { breached: false } | { breached: true; source: 'common' | 'pwned' };

/** SHA-1 hex maiúsculo — formato que a HIBP range API usa. */
function sha1Upper(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

/**
 * `true` se a senha está na lista local ou aparece na HIBP. Nunca lança —
 * problema de rede vira `{ breached: false }` (fail-open).
 */
export async function checkPasswordBreach(password: string): Promise<BreachResult> {
  if (COMMON.has(password.toLowerCase())) return { breached: true, source: 'common' };
  if (hibpDisabled()) return { breached: false };

  const hash = sha1Upper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), hibpTimeoutMs());
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: ac.signal,
      // Add-Padding: a resposta vem com linhas-ruído de count 0 — o range fica
      // com tamanho uniforme, um observador não infere nada do Content-Length.
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return { breached: false };
    for (const line of (await res.text()).split('\n')) {
      const [lineSuffix, countStr] = line.trim().split(':');
      if (lineSuffix === suffix && Number(countStr) > 0) return { breached: true, source: 'pwned' };
    }
    return { breached: false };
  } catch {
    return { breached: false }; // offline / timeout / DNS — só a lista local valeu
  } finally {
    clearTimeout(timer);
  }
}
