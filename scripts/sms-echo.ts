/**
 * Mock de provedor de SMS pra testar o 2º fator sem SMS de verdade.
 * Uso: `bun run dev:sms-echo` (porta em SMS_ECHO_PORT, default 4545).
 *
 * Aceita o POST do adapter `http-generic` e imprime `{to, text}` + o código
 * de 6 dígitos no terminal; responde 200 como um provedor faria. Aponte o
 * gateway pra cá com SMS_ENDPOINT_URL=http://127.0.0.1:4545/send.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.SMS_ECHO_PORT?.trim()) || 4545;
let count = 0;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`sms-echo ativo. Aponte SMS_ENDPOINT_URL pra POST http://127.0.0.1:${PORT}/send\n`);
      return;
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    count += 1;
    const auth = Object.entries(req.headers)
      .filter(([k]) => !['host', 'content-type', 'content-length', 'connection', 'accept'].includes(k))
      .map(([k, v]) => `${k}: ${v}`);

    let to = '(?)';
    let text = raw;
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      to = String(body.to ?? body.phone ?? body.number ?? '(?)');
      text = String(body.text ?? body.message ?? body.body ?? raw);
    } catch {
      /* corpo não-JSON: mostra cru */
    }
    const code = text.match(/\b(\d{6})\b/)?.[1];

    console.log('\n' + '─'.repeat(60));
    console.log(`  SMS #${count}  ${req.method} ${req.url}`);
    console.log(`  para:   ${to}`);
    console.log(`  texto:  ${text}`);
    if (code) console.log(`  CÓDIGO: ${code}`);
    if (auth.length) console.log(`  headers: ${auth.join(' | ')}`);
    console.log('─'.repeat(60));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'queued', id: `echo-${count}`, to }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`sms-echo ouvindo em http://127.0.0.1:${PORT}  (POST /send)`);
  console.log('Env pro gateway:');
  console.log(`  SMS_ENDPOINT_URL=http://127.0.0.1:${PORT}/send`);
  console.log('  SMS_BODY_TEMPLATE={"to":"{to}","message":"{text}"}');
  console.log('  SMS_AUTH_HEADER=X-Echo-Token: dev   (opcional — só pra ver passar)');
});
