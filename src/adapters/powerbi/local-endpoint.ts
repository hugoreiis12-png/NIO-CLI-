/**
 * Descobre o endpoint XMLA do Power BI Desktop (Analysis Services local).
 *
 * Existe porque o agente **chutava** `localhost:55100` — número que circula em tutoriais
 * — e concluía que o modo local estava fora do ar. Medido na máquina do dono: o Desktop
 * estava aberto e servindo em `127.0.0.1:31272`. A porta é **efêmera e sorteada a cada
 * abertura**; não existe valor fixo para lembrar.
 *
 * O método canônico (`msmdsrv.port.txt` em `AnalysisServicesWorkspaces`) **não serve
 * aqui**: essa pasta não existe nesta instalação (verificado). A descoberta confiável é
 * pelo processo: `msmdsrv.exe` → a porta em que ele escuta.
 *
 * Contrato nunca-lança.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Só existe Analysis Services embutido no Power BI Desktop, que é Windows-only. */
const PROCESSO = 'msmdsrv.exe';
const TIMEOUT_MS = 5000;

export type LocalXmlaStatus = 'ok' | 'not_running' | 'unsupported' | 'failed';

export interface LocalXmlaResult {
  status: LocalXmlaStatus;
  /** `localhost:31272` — pronto pra string de conexão. */
  endpoint?: string;
  port?: number;
  error?: string;
}

/**
 * PIDs do `tasklist /FO CSV /NH`. Casa pelo **nome da imagem**, não pela mensagem de
 * "nenhuma tarefa": essa mensagem é localizada e vem em codepage legada.
 */
export function parseTasklistPids(stdout: string): number[] {
  const pids: number[] = [];
  for (const linha of stdout.split(/\r?\n/)) {
    const m = /^"msmdsrv\.exe","(\d+)"/i.exec(linha.trim());
    if (m) pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * Porta de loopback em escuta de um dos `pids`, a partir do `netstat -ano`. Formato real:
 * `  TCP    127.0.0.1:31272        0.0.0.0:0              LISTENING       15812`
 *
 * Prefere IPv4 — a string de conexão do Power BI usa `localhost`, e `::1` confunde
 * cliente antigo.
 */
export function parseListeningPort(stdout: string, pids: readonly number[]): number | null {
  const alvo = new Set(pids);
  let ipv6: number | null = null;
  for (const linha of stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(linha);
    if (!m) continue;
    const [, host, porta, pid] = m;
    if (!alvo.has(Number(pid))) continue;
    if (host === '127.0.0.1') return Number(porta);
    if (host === '[::1]' || host === '::1') ipv6 = Number(porta);
  }
  return ipv6; // só o IPv6 apareceu: melhor que nada
}

export interface DiscoverDeps {
  /** Seam de teste: devolve o stdout de cada comando. */
  exec?: (cmd: string, args: string[]) => Promise<string>;
  platform?: string;
}

async function execReal(cmd: string, args: string[]): Promise<string> {
  // `latin1`: a saída do console vem em codepage legada e o UTF-8 corromperia os
  // acentos. Só precisamos dos números, mas decodificar errado quebraria as regex.
  const { stdout } = await run(cmd, args, { encoding: 'latin1', timeout: TIMEOUT_MS, windowsHide: true });
  return String(stdout);
}

/**
 * Onde o Power BI Desktop está servindo agora. `not_running` quando o Desktop está
 * fechado ou sem modelo aberto — que é uma resposta útil, não um erro.
 */
export async function discoverLocalXmla(deps: DiscoverDeps = {}): Promise<LocalXmlaResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    return { status: 'unsupported', error: 'o Power BI Desktop só roda no Windows' };
  }
  const exec = deps.exec ?? execReal;
  try {
    const listaProcessos = await exec('tasklist', ['/FI', `IMAGENAME eq ${PROCESSO}`, '/FO', 'CSV', '/NH']);
    const pids = parseTasklistPids(listaProcessos);
    if (pids.length === 0) {
      return {
        status: 'not_running',
        error: 'Power BI Desktop não está com um modelo aberto (nenhum msmdsrv.exe).',
      };
    }
    const conexoes = await exec('netstat', ['-ano']);
    const porta = parseListeningPort(conexoes, pids);
    if (!porta) {
      return { status: 'not_running', error: 'msmdsrv.exe está de pé mas ainda não escuta — reabra o modelo.' };
    }
    return { status: 'ok', port: porta, endpoint: `localhost:${porta}` };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
