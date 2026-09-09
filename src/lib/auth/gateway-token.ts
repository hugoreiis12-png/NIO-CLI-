/**
 * Segredo local compartilhado entre a CLI e o `nio-gateway` — não é
 * autenticação de usuário (isso é o JWT), é uma prova de que quem está
 * chamando conhece a instalação local. Defesa contra script genérico que
 * não foi escrito pra atacar a NIO-CLI especificamente; não defende contra
 * outro processo rodando com o mesmo usuário do SO (esse já tem acesso ao
 * arquivo, igual teria à sessão).
 *
 * `~/.nio/gateway.token`, chmod 600. Gerado por quem chegar primeiro (CLI ou
 * gateway) — o outro só lê. Uso normal (gateway sobe antes do login) evita a
 * corrida de dois processos gerando tokens diferentes ao mesmo tempo.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homePath } from '../../brand.js';

export const GATEWAY_TOKEN_FILE = homePath('gateway.token');

export async function getOrCreateGatewayToken(file: string = GATEWAY_TOKEN_FILE): Promise<string> {
  const envToken = process.env.NIO_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;

  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  // `mode` fecha a janela do arquivo novo em 0644 (auditoria L-4).
  await writeFile(file, token + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(file, 0o600);
  } catch {
    // chmod pode falhar em Windows — ignoramos silenciosamente.
  }
  return token;
}
