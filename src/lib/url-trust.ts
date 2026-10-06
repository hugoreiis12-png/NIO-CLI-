/**
 * Confiança de transporte de uma URL de serviço: quando `http` puro é aceitável.
 *
 * `https` sempre serve. `http` só quando o host é literalmente desta máquina ou de
 * uma rede privada — loopback, RFC1918, link-local, ULA IPv6. É o caso da instância
 * self-hosted num IP de LAN (n8n doméstico, por exemplo). `http` para host público
 * segue recusado: ali o segredo do header atravessaria a internet em texto puro.
 *
 * Só IP **literal**: liberar por nome de host exigiria confiar na resolução
 * DNS/mDNS, que um atacante na mesma rede responde no lugar do servidor.
 *
 * Fonte única da política — `tools/lang-n8n.ts` (API REST) e
 * `adapters/n8n/native-client.ts` (MCP nativo) consomem daqui.
 */

/** Único nome liberado: resolve na própria máquina sem passar pela rede. */
const LOOPBACK_NAMES = new Set(['localhost']);

/** Dica da política, para as mensagens de erro dos callers não divergirem. */
export const PLAIN_HTTP_HINT = 'http só em localhost ou IP de rede privada (LAN)';

/** Os 4 octetos, ou `null` se não for um IPv4 literal. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

/** Loopback `127/8`, RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local `169.254/16`. */
function isPrivateIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return a === 169 && b === 254;
}

/** `::1`, ULA `fc00::/7` e link-local `fe80::/10`. O `hostname` vem com colchetes. */
function isPrivateIpv6(host: string): boolean {
  const addr = host.replace(/^\[/, '').replace(/\]$/, '');
  if (addr === '::1') return true;
  const head = addr.split(':')[0] ?? '';
  // Grupo de 4 dígitos: `fd::1` é 0x00fd, fora da ULA — por isso o tamanho é exato.
  return /^f[cd][0-9a-f]{2}$/.test(head) || /^fe[89ab][0-9a-f]$/.test(head);
}

/** `true` se o host é desta máquina ou de rede privada (IP literal ou `localhost`). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_NAMES.has(host)) return true;
  return host.includes(':') ? isPrivateIpv6(host) : isPrivateIpv4(host);
}

/** `true` se um segredo pode viajar nesta URL: https, ou http em host privado. */
export function isTransportTrusted(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return isPrivateHost(url.hostname);
}
