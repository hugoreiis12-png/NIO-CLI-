/**
 * Liveness e auto-start do `nio-worker`, no mesmo molde do `gateway-process.ts`.
 *
 * Diferente do gateway, o worker não sobe HTTP — então a prova de vida é um
 * arquivo de PID em `~/.nio/worker.pid` + `process.kill(pid, 0)`, que só testa
 * existência e não envia sinal nenhum.
 *
 * **Um worker por usuário**, não por máquina: o `claim` recorta por `user_id` e
 * o `~/.nio` já é estado por-usuário. Dois colaboradores no mesmo host têm cada
 * um o seu, sem disputar task.
 */
import { spawnPortable } from '../proc.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { homePath } from '../../brand.js';
import { dlog } from '../debug.js';

export function workerPidPath(): string {
  return homePath('worker.pid');
}

/** PID gravado, ou `null` se não há arquivo/é ilegível. */
export function readWorkerPid(path: string = workerPidPath()): number | null {
  if (!existsSync(path)) return null;
  const n = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * `true` se o PID existe. **Não prova que é o worker**: um PID reciclado pelo SO
 * daria falso positivo. É aceitável para ferramenta local — o custo do engano é
 * não subir um worker, e o próximo comando tenta de novo.
 */
export function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function workerRunning(): boolean {
  const pid = readWorkerPid();
  return pid !== null && pidVivo(pid);
}

/** Grava o PID do processo atual. Chamado pelo próprio worker no boot. */
export function claimPidFile(pid: number = process.pid): void {
  const path = workerPidPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${pid}\n`, 'utf8');
}

export function releasePidFile(): void {
  try {
    unlinkSync(workerPidPath());
  } catch {
    /* já removido */
  }
}

export interface WorkerEnsureResult {
  status: 'ja_rodando' | 'iniciado' | 'falhou';
  pid?: number;
  error?: string;
}

/** Como subir: o bin instalado, senão o `worker.js` irmão do entrypoint atual. */
function comandoDoWorker(): { cmd: string; args: string[] } {
  const aqui = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const irmao = `${aqui}/../../worker.js`;
  if (existsSync(irmao)) return { cmd: process.execPath, args: [irmao] };
  return { cmd: 'nio-worker', args: [] };
}

/**
 * Sobe o worker destacado se não houver um vivo. Não espera ficar pronto: a
 * task já está persistida na fila, então o worker a encontra quando subir.
 */
export function ensureWorkerRunning(): WorkerEnsureResult {
  if (workerRunning()) return { status: 'ja_rodando', pid: readWorkerPid() ?? undefined };

  const { cmd, args } = comandoDoWorker();
  try {
    const logFile = homePath('worker.log');
    mkdirSync(dirname(logFile), { recursive: true });
    const out = openSync(logFile, 'a');
    const child = spawnPortable(cmd, args, { detached: true, stdio: ['ignore', out, out] });
    child.unref();
    dlog(`worker iniciado (pid ${child.pid})`);
    return { status: 'iniciado', ...(child.pid !== undefined ? { pid: child.pid } : {}) };
  } catch (err) {
    return { status: 'falhou', error: err instanceof Error ? err.message : String(err) };
  }
}
