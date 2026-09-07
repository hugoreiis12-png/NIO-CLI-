/**
 * Calibra os params do argon2id (ADR 0011 §C) NA MÁQUINA DO GATEWAY.
 *
 * Roda um sweep de (memória × iterações), mede o tempo mediano de `hash()`, e
 * recomenda os maiores valores que ainda ficam abaixo do alvo (~250–500 ms pra
 * login interativo — OWASP: "o mais alto que você tolerar").
 *
 * ESM puro (sem TS, sem bun-only) — roda com `node` OU `bun`, no host OU dentro
 * do container:
 *
 *   # no host do gateway (mesma CPU; sem limite de cgroup):
 *   node scripts/argon2-calibrate.mjs
 *
 *   # dentro do container (pega limites de CPU/memória reais, se houver):
 *   docker cp scripts/argon2-calibrate.mjs nio-gateway:/tmp/
 *   docker exec nio-gateway node /tmp/argon2-calibrate.mjs
 *
 * Env opcionais:
 *   TARGET_MS=300   alvo de tempo por hash (default 300)
 *   SAMPLES=5       medições por combo (mediana; default 5)
 *   MIB=19,32,47,64,96,128    memórias a testar (MiB)
 *   TIME=2,3,4                iterações a testar
 */
import { hash } from '@node-rs/argon2';

const ARGON2ID = 2;
const TARGET_MS = Number(process.env.TARGET_MS) || 300;
const SAMPLES = Number(process.env.SAMPLES) || 5;
const MIBS = (process.env.MIB || '19,32,47,64,96,128').split(',').map(Number);
const TIMES = (process.env.TIME || '2,3,4').split(',').map(Number);
const PARALLELISM = Number(process.env.PARALLELISM) || 1;

const PASSWORD = 'calibration-password-com-tamanho-realista-x';

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function measure(memoryCost, timeCost) {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    await hash(PASSWORD, { algorithm: ARGON2ID, memoryCost, timeCost, parallelism: PARALLELISM });
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

console.log(
  `argon2id · alvo ~${TARGET_MS} ms · ${SAMPLES} amostras/combo · p=${PARALLELISM} · ` +
    `cpus=${(await import('node:os')).availableParallelism?.() ?? '?'}\n`,
);
console.log('  MiB   t   mediana(ms)   ok?');
console.log('  ───   ─   ───────────   ───');

let best = null;
for (const mib of MIBS) {
  for (const t of TIMES) {
    let ms;
    try {
      ms = await measure(mib * 1024, t);
    } catch (err) {
      console.log(`  ${String(mib).padStart(3)}  ${t}   —             falhou: ${err.message}`);
      continue;
    }
    const ok = ms <= TARGET_MS;
    console.log(
      `  ${String(mib).padStart(3)}  ${t}   ${ms.toFixed(0).padStart(9)}     ${ok ? 'sim' : 'não'}`,
    );
    // "melhor" = maior trabalho (mib*t) que passa no alvo
    if (ok && (!best || mib * t > best.mib * best.t)) best = { mib, t, ms };
  }
}

console.log('');
if (best) {
  console.log(`Recomendado (maior custo ≤ ${TARGET_MS} ms):`);
  console.log(`  NIO_ARGON2_MEMORY_MIB=${best.mib}`);
  console.log(`  NIO_ARGON2_TIME=${best.t}`);
  if (PARALLELISM !== 1) console.log(`  NIO_ARGON2_PARALLELISM=${PARALLELISM}`);
  console.log(`  (~${best.ms.toFixed(0)} ms/hash)`);
} else {
  console.log(`Nenhum combo ficou ≤ ${TARGET_MS} ms — máquina lenta. Fique no default (19 MiB / t=2)`);
  console.log('ou suba o TARGET_MS se o time aceitar login mais lento.');
}

console.log(
  `\nNota: sob N logins simultâneos, o gateway aloca ~N × (memória) de RAM. ` +
    `Pra um time pequeno é raro, mas não escolha memória perto do limite da caixa.`,
);
