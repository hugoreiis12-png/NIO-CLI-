# Quarta passada de segurança — QP-1 a QP-6

> Auditoria de 2026-09-29 sobre a `v0.17.0` (commit `ebabc46`). Segue a numeração
> das passadas anteriores: original (`H-*`/`M-*`/`L-*`/`I-*`), 2ª (`SP-*`),
> 3ª (`TP-*`), **4ª = `QP-*`**.
>
> Cada achado foi confirmado em execução (`bun audit`, `bun test`, inspeção do
> `dist/` construído), não por leitura isolada. **Nenhum foi corrigido** — este
> documento é o plano de implementação.

| ID | Sev | Título | Arquivos | Esforço |
|----|-----|--------|----------|---------|
| [QP-1](#qp-1-xlsx-com-2-cves-high-sem-versão-corrigida-no-npm-alto) | **ALTO** | `xlsx` com 2 CVEs high, alcançável por anexo do usuário | `package.json`, `tui/attachments.ts` | decisão + ~5 linhas |
| [QP-2](#qp-2-mitigação-de-symlink-do-adm-zip-roda-depois-da-extração-alto) | **ALTO** | Mitigação de symlink roda **depois** do `extractAllTo` | `fetch-zipball.ts` +2 | ~30 linhas |
| [QP-3](#qp-3-jwt-e-gateway-token-no-disco-sem-o-hardening-do-próprio-projeto-médio) | **MÉDIO** | JWT e gateway token sem `hardenSecretFile` (NTFS) | `cli-session-store.ts`, `gateway-token.ts` | ~8 linhas |
| [QP-4](#qp-4-rotação-de-jwt-não-aposenta-a-chave-legada-médio) | **MÉDIO** | Rotação de JWT não consegue aposentar `JWT_SECRET` | `gateway/auth/secrets.ts` | ~10 linhas |
| [QP-5](#qp-5-otp_hmac_secret-cai-no-jwt_secret-baixo) | BAIXO | `OTP_HMAC_SECRET` cai no `JWT_SECRET` (reuso de chave) | `gateway/auth/secrets.ts` | ~6 linhas |
| [QP-6](#qp-6-checagem-de-sub-tem-caminho-de-escape-baixo) | BAIXO | Checagem de `sub` tem caminho de escape | `gateway/middleware/auth.ts` | 2 linhas |

**Regressão de escopo:** o `bun audit` está em **6 vulnerabilidades (3 high, 3
moderate)**. O `package.json` documenta o bloco `overrides` como *"pra deixar o
`bun audit` limpo"* e o `docs/security/README.md` registra H-4 e SP-4 como
**fechados** com `bun audit` limpo (0 vulns). Isso não é mais verdade — QP-1 e
QP-2 são a causa.

---

## QP-1 — `xlsx` com 2 CVEs high, sem versão corrigida no npm [ALTO]

### Evidência

```
$ bun audit
xlsx  <0.19.3
  (direct dependency)
  high: Prototype Pollution in sheetJS — GHSA-4r6h-8v6p-xvw6
  high: SheetJS Regular Expression Denial of Service (ReDoS) — GHSA-5pgg-2g8v-p4x9
```

```ts
// src/tui/attachments.ts:62-66 — caminho de produção, import dinâmico
if (det.kind === 'xlsx') {
  const XLSX = await import('xlsx'); // lazy: só carrega SheetJS quando há xlsx
  const wb = XLSX.readFile(det.path);
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n]!)).join('\n\n');
}
```

> **Nota de método**: um `grep "from 'xlsx'"` encontra só o arquivo de teste e dá
> a impressão de que a dependência é órfã. O uso de produção é `await
> import('xlsx')` — import dinâmico, deliberado (`lazy`, fora do cold start). Ao
> auditar alcance de dependência neste repo, sempre incluir `import(` no padrão:
> `jimp` (`attachments.ts:115`) e `@huggingface/transformers` (`adapters/embed`)
> seguem o mesmo estilo.

### Risco

`.xlsx` é um dos tipos de anexo aceitos pela TUI (`AttachKind` em
`attachments.ts:14`). Anexar uma planilha em `nio ai` faz o SheetJS 0.18.5 parsear
o arquivo **dentro do processo do CLI** — o mesmo processo que tem o JWT em
memória e acesso de escrita a `~/.nio/`. Prototype pollution ali não é teórica.

O vetor exige que o usuário anexe um arquivo hostil (planilha recebida por e-mail,
baixada de um cliente, gerada por terceiro), então não é remoto não-autenticado.
Mas é exatamente o fluxo que a feature de anexo existe para servir.

**Não há fix por versão no npm.** O SheetJS saiu do registry a partir da `0.20.x`
e distribui em `cdn.sheetjs.com`; o `latest` publicado no npm continua sendo a
`0.18.5` vulnerável. `bun update` não resolve, e o `overrides` do `package.json`
também não — é preciso mudar a origem ou o parser.

### Fix — três caminhos, exige decisão

**A. Trocar a origem para a build mantida (menor mudança de código):**

```diff
  "dependencies": {
-   "xlsx": "^0.18.5",
+   "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  }
```

Zero mudança em `attachments.ts`. Custo: entra uma dependência de URL no
`bun.lock`, fora do registry — o `bun install --frozen-lockfile` do CI passa a
depender da disponibilidade do CDN do SheetJS, e a org perde a verificação de
integridade do npm. Se escolhido, **registrar ADR** (é uma mudança de política de
supply chain, e o H-3 desta pasta trata exatamente disso).

**B. Trocar de parser:** `exceljs` ou `node-xlsx` estão no npm e são mantidos. O
código a substituir são 3 linhas (`readFile` → `sheet_to_csv`). Custo: uma
dependência nova + reescrever `attachments.test.ts`.

**C. Mover `xlsx` para `devDependencies` e remover o suporte a `.xlsx`:** o usuário
converte para CSV antes de anexar — `csv` já é um `AttachKind` suportado. Menor
superfície de ataque das três, ao custo de uma feature.

Recomendação: **B**, se o suporte a `.xlsx` for usado de fato. Mantém o pacote no
registry e resolve as duas CVEs sem política nova. Confirmar o uso real antes —
se ninguém anexa planilha, **C** é melhor negócio.

### Verificação

```bash
bun install && bun audit           # as 2 linhas `xlsx` somem
bun test src/tui/attachments.test.ts
```

Mais um teste de aceite manual, porque nenhuma das 3 opções é coberta por teste
automatizado de ponta a ponta: anexar um `.xlsx` real em `nio ai` e confirmar que
o conteúdo chega ao prompt como CSV.

---

## QP-2 — Mitigação de symlink do `adm-zip` roda depois da extração [ALTO]

### Evidência

```
$ bun audit
adm-zip  >=0.5.9 <=0.6.0
  (direct dependency)
  moderate: adm-zip extraction follows destination symlinks, allowing arbitrary
            file overwrite — GHSA-vwc7-r8mq-g2x9
  high:     adm-zip: Uncontrolled memory allocation via the declared
            uncompressed size (DoS) — GHSA-7q85-xj36-vmfc
```

```ts
// src/lib/skills/skills-cache.ts:139-142  (idêntico em src/adapters/lang/vendor.ts:47-50)
new AdmZip(buf).extractAllTo(staging, true);
const dirs = readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
const root = dirs.length === 1 ? join(staging, dirs[0].name) : staging;
rejectSymlinks(root); // TP-4 — nada de `x -> ~/.ssh/id_rsa` no bundle
```

### Risco

O TP-4 resolve **o problema que ele se propôs a resolver** e isso continua válido:
impede que um symlink chegue ao cache (`~/.nio/skills`) e seja seguido numa leitura
posterior. O `throw` acontece antes do `cpSync`. Essa parte está correta.

O que ele **não** cobre é a CVE em si. `GHSA-vwc7-r8mq-g2x9` é sobre a escrita
durante o `extractAllTo`: um zipball com a entrada `a` como symlink para fora do
staging, seguida da entrada `a/payload`, faz o `adm-zip` gravar **através** do
symlink — fora do diretório de staging. Quando o `rejectSymlinks` roda, a escrita
arbitrária já ocorreu; ele detecta e lança, mas o arquivo de fora já foi
sobrescrito.

Cadeia de exposição: `brand.skillsRef` não é um SHA pinado hoje (o próprio código
emite `AVISO: skills vêm de "<ref>" (não é um commit SHA)` em
`skills-cache.ts:124`), então o conteúdo do `NIO-SKILLS-` em `main` é entrada
não-confiável. O H-3 (branch protection na org) está registrado como **pendente de
ops** no `README.md` desta pasta — ou seja, o controle compensatório também não
está em vigor.

A metade DoS (`GHSA-7q85-xj36-vmfc`) **já está mitigada**: `fetchZipball` aborta
por `maxBytes` durante o stream, e o comentário em `fetch-zipball.ts:4` registra
que isso encadeia com a CVE do `adm-zip`.

### Fix

Inspecionar as entradas **antes** de escrever qualquer byte. Adicionar em
`src/lib/fetch-zipball.ts`, ao lado do `rejectSymlinks` existente:

```ts
/**
 * QP-2: valida as entradas do zip ANTES do `extractAllTo`. O `rejectSymlinks`
 * (TP-4) protege o cache, mas roda depois da escrita — a CVE do adm-zip
 * (GHSA-vwc7-r8mq-g2x9) é a escrita seguir um symlink de destino durante a
 * própria extração. Aqui nada é gravado até a árvore estar aprovada.
 *
 * Recusa: path absoluto, travessia (`..`), e entrada com bit de symlink no
 * modo externo do header (o adm-zip preserva `attr >>> 16`).
 */
const S_IFLNK = 0o120000;

export function assertSafeZipEntries(entries: readonly ZipEntryLike[]): void {
  for (const e of entries) {
    const name = e.entryName;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      throw new Error(`entrada com path absoluto recusada no bundle: ${name}`);
    }
    if (name.split(/[/\\]/).includes('..')) {
      throw new Error(`entrada com travessia de path recusada no bundle: ${name}`);
    }
    if (((e.attr ?? 0) >>> 16 & S_IFLNK) === S_IFLNK) {
      throw new Error(`entrada symlink recusada no bundle: ${name}`);
    }
  }
}

/** Shape mínimo de entrada do adm-zip — evita acoplar o tipo da lib. */
export interface ZipEntryLike {
  entryName: string;
  attr?: number;
}
```

Aplicar nos dois pontos de extração:

```diff
  // src/lib/skills/skills-cache.ts
- new AdmZip(buf).extractAllTo(staging, true);
+ const zip = new AdmZip(buf);
+ assertSafeZipEntries(zip.getEntries()); // QP-2 — valida antes de gravar
+ zip.extractAllTo(staging, true);
  const dirs = readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
  const root = dirs.length === 1 ? join(staging, dirs[0].name) : staging;
  rejectSymlinks(root); // TP-4 — defesa em profundidade, agora redundante de propósito
```

Mesma mudança em `src/adapters/lang/vendor.ts:47`. Manter o `rejectSymlinks`:
duas barreiras independentes custam pouco e o TP-4 já tem teste.

**`lib/cowork-extension.ts` não precisa de fix.** Ele usa `new AdmZip()` para
**criar** um `.mcpb` (linha 139) e recebe um `AdmZip` já construído como parâmetro
(linha 96) — não extrai zipball remoto. Verificado; registrado aqui para não
reabrir a dúvida numa próxima passada.

### Teste

```ts
// src/lib/fetch-zipball.test.ts
test('QP-2: recusa entrada symlink antes de extrair', () => {
  const entries = [{ entryName: 'a', attr: (0o120777 << 16) >>> 0 }];
  expect(() => assertSafeZipEntries(entries)).toThrow(/symlink/);
});
test('QP-2: recusa travessia de path', () => {
  expect(() => assertSafeZipEntries([{ entryName: '../fora.txt' }])).toThrow(/travessia/);
});
test('QP-2: aceita bundle normal', () => {
  expect(() => assertSafeZipEntries([{ entryName: 'repo-sha/skill.md', attr: 0 }])).not.toThrow();
});
```

---

## QP-3 — JWT e gateway token no disco sem o hardening do próprio projeto [MÉDIO]

### Evidência

`src/lib/secure-file.ts:1-8` existe exatamente por causa deste problema:

> `chmodSync(0o600)` **não protege nada no NTFS**: quem manda no Windows é a ACL, e
> o modo POSIX do Node vira no máximo o bit de somente-leitura.

E aplica `icacls /inheritance:r /grant:r <user>:F` de verdade. Mas só dois
arquivos o chamam:

```
$ grep -rn "secure-file" src --include=*.ts | grep -v test
src/adapters/fabric/refresh-store.ts:12
src/lib/auth/nio-config.ts:16
```

Os dois arquivos que guardam credencial de sessão ficaram de fora:

```ts
// src/lib/auth/cli-session-store.ts:62-66   → ~/.nio/session.json, contém o JWT
await writeFile(file, JSON.stringify(session, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
try {
  await chmod(file, 0o600);
} catch {
  // chmod pode falhar em Windows — ignoramos silenciosamente.
}
```

```ts
// src/lib/auth/gateway-token.ts:34-39   → ~/.nio/gateway.token
```

### Risco

No Windows — plataforma primária de desenvolvimento do time — `~/.nio/session.json`
fica com as ACEs herdadas de `%USERPROFILE%\.nio`, legível por qualquer principal
que herde da pasta. O arquivo contém o **JWT de sessão** (`token`) e o `jti`
(`sessionId`). O `mode: 0o600` no `writeFile` e o `chmod` seguinte são no-ops
efetivos em NTFS, e a falha é engolida em silêncio — o usuário não recebe aviso
de que a proteção não existe.

O `gateway.token` é o segredo que autoriza as rotas `/register`, `/login`,
`/logout*` e `/security/*` (ver `TOKEN_REQUIRED` em `gateway/index.ts:47`).

Isto é uma regressão parcial do **L-4** (*"Segredo: `writeFile` → `chmod` (janela
0644)"*, marcado ✅ feito): o fix de L-4 fechou a janela de tempo, mas a proteção
em NTFS nunca existiu — foi o que motivou o `secure-file.ts` depois.

### Fix

```diff
  // src/lib/auth/cli-session-store.ts
- import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
+ import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
+ import { hardenSecretFile } from '../secure-file.js';

  export async function saveSession(session: StoredSession, file: string = SESSION_FILE): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
-   // `mode` no writeFile fecha a janela em que o arquivo NOVO fica 0644 (auditoria
-   // L-4); o chmod cobre o caso de o arquivo já existir com permissão frouxa.
+   // `mode` fecha a janela do arquivo NOVO em 0644 (L-4); o harden cobre o arquivo
+   // preexistente com permissão frouxa e a ACL do NTFS, onde chmod é no-op (QP-3).
    await writeFile(file, JSON.stringify(session, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
-   try {
-     await chmod(file, 0o600);
-   } catch {
-     // chmod pode falhar em Windows — ignoramos silenciosamente.
-   }
+   const hardened = hardenSecretFile(file);
+   if (hardened.outcome !== 'ok') {
+     console.error(
+       `[${brand.mcpBinName}] AVISO: não foi possível restringir "${file}" ao dono ` +
+         `(${hardened.error ?? hardened.outcome}). O JWT de sessão pode estar legível por outros usuários.`,
+     );
+   }
  }
```

Mesma mudança em `src/lib/auth/gateway-token.ts:34-39`, trocando a mensagem para
citar o token do gateway.

**O aviso não é opcional.** O contrato de `hardenSecretFile` é *"nunca lança — o
chamador decide o que avisar"*. Engolir o resultado reproduz o bug atual num
formato novo: o ponto do fix é o usuário saber quando a proteção não aconteceu.

### Verificação (Windows)

```powershell
nio login
icacls "$env:USERPROFILE\.nio\session.json"
# esperado: apenas <USUÁRIO>:(F), sem linhas herdadas (I)
```

---

## QP-4 — Rotação de JWT não aposenta a chave legada [MÉDIO]

### Evidência

```ts
// src/gateway/auth/secrets.ts — jwtVerifyKey()
export function jwtVerifyKey(kid: string | undefined): string | null {
  if (kid) return jwtSecrets().get(kid) ?? null;
  return process.env.JWT_SECRET?.trim() || null;
}
```

### Risco

Um token **sem `kid`** sempre verifica contra `JWT_SECRET`, mesmo com `JWT_SECRETS`
configurado. A consequência é que a rotação introduzida pela **ADR 0011 §E** nunca
fecha o ciclo: adicionar um `kid` novo passa a assinar com a chave nova, mas
qualquer token antigo emitido sob `JWT_SECRET` continua válido para sempre.

Se o motivo da rotação for **comprometimento** do `JWT_SECRET`, rotacionar não
resolve — um atacante com o segredo antigo forja um token sem `kid` e ele passa.
A única forma de fechar hoje é remover a env `JWT_SECRET` de todos os nós, o que
o `getJwtSecret()` provavelmente trata como erro fatal de boot.

Isso torna o **H-1** (*"rotacionar o `JWT_SECRET` em prod"*, pendente de ops)
menos eficaz do que o runbook sugere. Ver `§ 6.6` do `BACKLOG-TECNICO.md`.

### Fix

Kill-switch explícito para o modo legado, default preservando o comportamento atual
(compatibilidade) e com caminho documentado para desligar:

```diff
+ /**
+  * QP-4: `NIO_JWT_LEGACY=0` recusa token sem `kid`. Sem isso, um `JWT_SECRET`
+  * comprometido continua assinando tokens válidos mesmo após a rotação por
+  * `JWT_SECRETS` — a rotação da ADR 0011 §E nunca fecha. Default `1` mantém a
+  * compatibilidade; vire `0` depois que todas as sessões tiverem sido reemitidas
+  * (`nio logout --all` no time, ou após `expires_at` da última auth_session).
+  */
+ function legacyJwtAllowed(): boolean {
+   return process.env.NIO_JWT_LEGACY?.trim() !== '0';
+ }
+
  export function jwtVerifyKey(kid: string | undefined): string | null {
    if (kid) return jwtSecrets().get(kid) ?? null;
+   if (!legacyJwtAllowed()) return null;
    return process.env.JWT_SECRET?.trim() || null;
  }
```

Documentar em `.env.example` e adicionar o passo ao runbook de rotação
(`BACKLOG-TECNICO.md § 6.6`):

1. Adicionar o `kid` novo em `JWT_SECRETS` → passa a assinar com ele.
2. Aguardar o maior `expires_at` de `auth_sessions`, **ou** rodar `logout-all`
   para todos os usuários.
3. Setar `NIO_JWT_LEGACY=0` e remover `JWT_SECRET` do ambiente.

### Teste

```ts
test('QP-4: com NIO_JWT_LEGACY=0, token sem kid é recusado', () => {
  process.env.JWT_SECRET = 'x'.repeat(MIN_JWT_SECRET_LENGTH);
  process.env.NIO_JWT_LEGACY = '0';
  expect(jwtVerifyKey(undefined)).toBeNull();
});
```

---

## QP-5 — `OTP_HMAC_SECRET` cai no `JWT_SECRET` [BAIXO]

### Evidência

```ts
// src/gateway/auth/secrets.ts
export function otpHmacSecret(): string {
  return process.env.OTP_HMAC_SECRET?.trim() || getJwtSecret();
}
```

### Risco

Mesma chave em dois papéis criptográficos: assinatura HS256 dos JWTs e HMAC-SHA256
dos códigos OTP (`login_challenges.code_hash`). O `§4.3` da auditoria original
(*"`JWT_SECRET` 3 papéis, sem rotação"*) está marcado ✅ feito justamente por ter
introduzido o `OTP_HMAC_SECRET` — mas como **fallback**, não como obrigatório, o
papel duplo persiste em qualquer deploy que não tenha setado a variável.

Severidade baixa: não há oráculo conhecido que transforme isso em quebra prática
aqui, e o espaço do OTP é curto/TTL baixo. É higiene de separação de domínio, e o
custo de fechar é uma linha de config.

### Fix

Não quebrar deploys existentes de imediato. Avisar agora, exigir na próxima major:

```diff
  export function otpHmacSecret(): string {
    const own = process.env.OTP_HMAC_SECRET?.trim();
-   return own || getJwtSecret();
+   if (own) return own;
+   // QP-5: fallback mantido por compat (§4.3). Reusar o JWT_SECRET no HMAC do OTP
+   // mistura dois domínios cripto — vira erro fatal na v1.0.
+   warnOnce(
+     'OTP_HMAC_SECRET ausente — usando JWT_SECRET no HMAC do OTP. ' +
+       'Gere um próprio com `openssl rand -base64 32`.',
+   );
+   return getJwtSecret();
  }
```

Marcar `OTP_HMAC_SECRET` como **obrigatório** em `.env.example` e abrir o item de
remoção do fallback para a v1.0.

---

## QP-6 — Checagem de `sub` tem caminho de escape [BAIXO]

### Evidência

```ts
// src/gateway/middleware/auth.ts
// defesa em profundidade: o `sub` do token tem que bater com o dono da
// auth_session (a fonte da verdade). Um token com jti válido mas sub trocado
// não passa.
if (typeof sub === 'string' && sub !== String(session.userId)) {
  return { ok: false, reason: 'token_invalido' };
}
```

### Risco

A condição só roda quando `sub` é string. Um token com `sub` ausente, `null`, ou
numérico (`sub: 42`) pula a verificação inteira e é aceito. O `SP-2` foi criado
justamente para fechar esse vetor.

Impacto prático limitado: o `userId` retornado vem da `auth_session` do banco, não
do token, então não há escalação por aqui — a falha é a defesa em profundidade não
defender. Mas o comentário afirma um invariante que o código não garante, que é o
tipo de coisa que a próxima refatoração acredita.

### Fix

```diff
- if (typeof sub === 'string' && sub !== String(session.userId)) {
+ // QP-6: `sub` ausente ou não-string também é recusado — a checagem do SP-2 não
+ // pode ter caminho de escape por tipo.
+ if (typeof sub !== 'string' || sub !== String(session.userId)) {
    return { ok: false, reason: 'token_invalido' };
  }
```

`issueSession` (`gateway/services/login.ts:135`) sempre emite `sub` como string —
confirmar antes de aplicar, senão isto invalida todas as sessões vivas. Se houver
tokens legados sem `sub`, coordenar com o passo 2 do QP-4 (reemissão).

### Teste

```ts
test('QP-6: token sem sub é recusado', async () => { /* jti válido, sub ausente */ });
test('QP-6: token com sub numérico é recusado', async () => { /* sub: 42 */ });
```

---

## Ordem de implementação sugerida

| Ordem | Item | Razão |
|:---:|---|---|
| 1 | **QP-3** | 8 linhas, protege o ativo mais sensível no disco do usuário |
| 2 | **QP-6** | 2 linhas, fecha o SP-2 de verdade |
| 3 | **QP-2** | Maior do lote, mas é o único com escrita arbitrária de arquivo |
| 4 | **QP-1** | Maior impacto, mas **bloqueado por decisão** (A/B/C) — decidir primeiro |
| 5 | **QP-4** | Precisa do passo de ops (reemissão) — agendar junto do H-1 |
| 6 | **QP-5** | Aviso agora; remoção do fallback fica pra v1.0 |

QP-2, QP-3 e QP-6 são **100% dev** — código, teste, merge, sem nada a decidir.
QP-1 precisa de uma escolha de produto/supply-chain antes de virar código. QP-4 e
QP-5 têm componente de ops (variável de ambiente nos nós de prod), igual ao
H-1/H-2.

Os três primeiros somam ~40 linhas e podem sair numa única sprint cirúrgica, no
mesmo formato da de 2026-09-19.

## Achados não-de-segurança

Arquitetura, banco, qualidade de código e estabilidade da suíte desta mesma
passada estão em [`../BACKLOG-TECNICO.md`](../BACKLOG-TECNICO.md) — seções 8 a 11.
