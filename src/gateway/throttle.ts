/**
 * Rate limiting **em memória do processo do gateway** (auditoria M-3 + M-4).
 *
 * O `nio-gateway` é um processo único e long-lived (`http.createServer`) — o
 * estado vive enquanto o processo vive e zera no restart. Isso basta pro modelo
 * atual (nó único atrás do gateway-token).
 *
 * ponytail: contador global em memória, sem lock (Node é single-thread, cada
 * `hit`/`recordLoginFail` é síncrono). Se o gateway virar multi-réplica, trocar o
 * backing store por Postgres (tabela `auth_throttle`) ou Redis — a interface
 * (`hit` / `loginDelayMs` / `recordLogin*`) fica igual, só a implementação muda.
 */

// ─── janela fixa genérica (M-4: SMS) ────────────────────────────────

interface FixedWindow {
  count: number;
  resetAt: number;
}
const windows = new Map<string, FixedWindow>();

export interface HitResult {
  ok: boolean;
  /** ms até a janela reabrir (0 quando `ok`). */
  retryAfterMs: number;
}

/**
 * Marca um evento em `key`. `ok:false` quando já passou de `limit` na janela de
 * `windowMs`. Janela fixa (simples; um burst na virada é aceitável pro caso de
 * uso — envio de SMS).
 */
export function hit(key: string, limit: number, windowMs: number, now: number = Date.now()): HitResult {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  w.count++;
  if (w.count <= limit) return { ok: true, retryAfterMs: 0 };
  return { ok: false, retryAfterMs: w.resetAt - now };
}

// ─── cap de envio de SMS (M-4: toll fraud / SMS pumping) ────────────

/** SMS por usuário na janela. */
export const SMS_PER_USER = 3;
export const SMS_USER_WINDOW_MS = 15 * 60 * 1000;
/** SMS por número — 1 a cada minuto (evita flood no mesmo alvo). */
export const SMS_PHONE_WINDOW_MS = 60 * 1000;

/**
 * Pode disparar um SMS pra este usuário/número agora? **Conta a tentativa** nos
 * dois contadores. `false` = estourou o cap (por usuário OU por número) — o
 * caller deve recusar sem enviar.
 */
export function smsAllowed(userId: number, phone: string, now: number = Date.now()): boolean {
  const perUser = hit(`sms:u:${userId}`, SMS_PER_USER, SMS_USER_WINDOW_MS, now);
  const perPhone = hit(`sms:p:${phone}`, 1, SMS_PHONE_WINDOW_MS, now);
  return perUser.ok && perPhone.ok;
}

// ─── atraso escalonado de login (M-3: brute-force de senha) ─────────

interface LoginFails {
  n: number;
  /** entrada é descartada pelo `sweep` depois disto. */
  expiresAt: number;
}
const loginFails = new Map<string, LoginFails>();

/** 1h sem falha nova → esquece o histórico daquela chave. */
const LOGIN_FAIL_TTL_MS = 60 * 60 * 1000;
/** Teto do atraso — não vira DoS de conexão pendurada. */
const LOGIN_MAX_DELAY_MS = 20_000;
/** Falhas "de graça" antes do atraso começar (erro de digitação honesto). */
const LOGIN_FREE_ATTEMPTS = 4;

/**
 * Quanto atrasar a resposta do `/login` pra esta chave (normalmente o `name`),
 * dado o histórico de falhas. **Atraso, não bloqueio** — de propósito: um
 * bloqueio duro por `name` deixaria um terceiro trancar a conta de um colega. O
 * atraso exponencial (capado) já torna o brute-force online inviável, e some no
 * primeiro login certo.
 */
export function loginDelayMs(key: string, now: number = Date.now()): number {
  const f = loginFails.get(key);
  if (!f || now >= f.expiresAt || f.n <= LOGIN_FREE_ATTEMPTS) return 0;
  const step = f.n - LOGIN_FREE_ATTEMPTS; // 1, 2, 3, …
  return Math.min(2 ** (step - 1) * 500, LOGIN_MAX_DELAY_MS); // 500ms, 1s, 2s, 4s, …, 20s
}

/** Registra uma falha de credencial. */
export function recordLoginFail(key: string, now: number = Date.now()): void {
  const f = loginFails.get(key);
  if (f && now < f.expiresAt) {
    f.n++;
    f.expiresAt = now + LOGIN_FAIL_TTL_MS;
  } else {
    loginFails.set(key, { n: 1, expiresAt: now + LOGIN_FAIL_TTL_MS });
  }
}

/** Login OK → limpa o histórico da chave. */
export function recordLoginOk(key: string): void {
  loginFails.delete(key);
}

/** Remove janelas e históricos expirados. Chamar periodicamente (ver `index.ts`). */
export function sweep(now: number = Date.now()): void {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
  for (const [k, f] of loginFails) if (now >= f.expiresAt) loginFails.delete(k);
}

/** Só pra teste — zera todo o estado. */
export function __clear(): void {
  windows.clear();
  loginFails.clear();
}
