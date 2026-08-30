/** Abre uma URL ou arquivo no app padrão do SO (mac/linux/windows). Best-effort. */
import { spawn } from 'node:child_process';

export function openUrl(target: string): void {
  const bin =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
