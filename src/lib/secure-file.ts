/**
 * Restringe um arquivo de segredo ao dono.
 *
 * `chmodSync(0o600)` **não protege nada no NTFS**: quem manda no Windows é a ACL, e o
 * modo POSIX do Node vira no máximo o bit de somente-leitura. Como o `config.env` guarda
 * `AZURE_CLIENT_SECRET`, `NIO_FABRIC_PASSWORD` e `JWT_SECRET`, aqui o Windows ganha
 * `icacls` de verdade e o POSIX segue no `chmod`.
 */
import { chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export type HardenOutcome = 'ok' | 'unsupported' | 'failed';

export interface HardenResult {
  outcome: HardenOutcome;
  /** Motivo, quando não deu — pro chamador avisar sem prometer proteção que não há. */
  error?: string;
}

/** Herança desligada + só o dono: sem isso os ACEs herdados da pasta continuam valendo. */
function hardenWindows(path: string): HardenResult {
  const user = process.env.USERNAME;
  if (!user) return { outcome: 'unsupported', error: 'USERNAME ausente' };
  try {
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

function hardenPosix(path: string): HardenResult {
  try {
    chmodSync(path, 0o600);
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Deixa o arquivo legível só pelo dono. Nunca lança — o chamador decide o que avisar. */
export function hardenSecretFile(path: string, platform: string = process.platform): HardenResult {
  return platform === 'win32' ? hardenWindows(path) : hardenPosix(path);
}
