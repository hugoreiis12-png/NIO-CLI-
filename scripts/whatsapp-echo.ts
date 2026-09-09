/**
 * Mock de provedor WhatsApp pra testar o 2º fator sem API de verdade.
 * Uso: `bun run dev:whatsapp-echo` (porta em WHATSAPP_ECHO_PORT, default 4545).
 *
 * Aceita o POST do adapter `whatsapp.ts`, extrai o código do template,
 * imprime `{to, code}` no terminal e grava em `~/.nio/whatsapp-echo-last.json`.
 * Responde 200 como a Meta Graph faria. Aponte o gateway pra cá com
 * WHATSAPP_ENDPOINT_URL=http://127.0.0.1:4545/v25.0/messages.
 */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.WHATSAPP_ECHO_PORT?.trim()) || 4545;
const LAST_FILE = join(homedir(), '.nio', 'whatsapp-echo-last.json');
let count = 0;

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`whatsapp-echo ativo. POST http://127.0.0.1:${PORT}/v25.0/messages\n`);
      return;
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    count += 1;
    const auth = Object.entries(req.headers)
      .filter(([k]) => !['host', 'content-type', 'content-length', 'connection', 'accept'].includes(k))
      .map(([k, v]) => `${k}: ${v}`);

    let to = '(?)';
    let code: string | undefined;
    let templateName = '(?)';
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      to = String(body.to ?? '(?)');
      const tmpl = body.template as Record<string, unknown> | undefined;
      templateName = String(tmpl?.name ?? '(?)');
      const components = (tmpl?.components ?? []) as Array<Record<string, unknown>>;
      for (const comp of components) {
        const params = (comp.parameters ?? []) as Array<Record<string, unknown>>;
        for (const p of params) {
          const txt = String(p.text ?? '');
          if (/^\d{6}$/.test(txt)) { code = txt; break; }
        }
        if (code) break;
      }
    } catch {
      /* corpo não-JSON: mostra cru */
    }

    if (code) {
      try {
        writeFileSync(LAST_FILE, JSON.stringify({ to, code, templateName, at: new Date().toISOString() }) + '\n');
      } catch {
        /* best-effort */
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`  WhatsApp #${count}  ${req.method} ${req.url}`);
    console.log(`  para:      ${to}`);
    console.log(`  template:  ${templateName}`);
    if (code) console.log(`  CÓDIGO:    ${code}`);
    if (auth.length) console.log(`  headers:   ${auth.join(' | ')}`);
    console.log('─'.repeat(60));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', status: 'queued', id: `echo-${count}` }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`whatsapp-echo ouvindo em http://127.0.0.1:${PORT}  (POST /v25.0/messages)`);
  console.log('Env pro gateway:');
  console.log(`  WHATSAPP_ENDPOINT_URL=http://127.0.0.1:${PORT}/v25.0/messages`);
  console.log(`  WHATSAPP_TOKEN=echo-dev-token`);
  console.log(`  WHATSAPP_TEMPLATE_NAME=autenticao`);
  console.log(`Último código também em ${LAST_FILE}`);
});
