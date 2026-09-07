/** Abre uma URL ou arquivo no app padrão do SO (mac/linux/windows). Best-effort. */
import { spawn } from 'node:child_process';

export function openUrl(target: string): void {
  // Windows: `rundll32 url.dll,FileProtocolHandler` abre no handler padrão SEM
  // passar por `cmd` — o `cmd /c start` antigo reinterpretava `& | < >` no
  // `target` (injeção de comando, auditoria L-1). `open`/`xdg-open` já recebem
  // o alvo como um arg único, sem shell.
  const [bin, args] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]]
        : ['xdg-open', [target]];

  const child = spawn(bin as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
