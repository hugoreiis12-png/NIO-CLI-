# Tarefa — Terminar a remoção do v1 (Supabase/NOS) — versão controlada

> **Reescrita em 25 ago 2026** para dar controle de escopo (evitar colisão com o
> trabalho do EnvironmentBuilder, que roda em paralelo). As versões anteriores
> ficaram desatualizadas várias vezes e o agente acabou editando arquivos fora do
> escopo (`index.ts`, `telemetry.ts`), quebrando o build fora de ordem. Esta
> versão é **curta, atual e delimitada**. Leia inteira antes de tocar em código.

## Objetivo

Remover o que sobrou do v1 (fluxo PAT→Supabase) **sem tocar em nada do v2** que
está em construção. O grosso já foi feito; resta um punhado de arquivos.

---

## ⛔ Regras de ambientação (LEIA — é o que evita quebrar o build de novo)

1. **Verde a cada commit.** `bunx tsc --noEmit` limpo **e** `bun test` sem falha
   NOVA antes de cada commit. Se um passo deixa o `tsc` vermelho, ele está grande
   ou fora de ordem — reverta e quebre menor. (As 4 falhas pré-existentes
   conhecidas — `cowork-extension` ×2, symlink EPERM ×2 — não contam.)
2. **De fora pra dentro, sempre.** Remova o CONSUMIDOR antes da dependência.
   Apagar um arquivo antes de quem o importa = build quebrado no meio. Foi
   exatamente o que quebrou da última vez (adapter apagado antes de `telemetry.ts`).
3. **🚫 ZONA PROIBIDA — não editar, não apagar, não criar dentro:**
   - `src/cli/commands/init/**` (todo o cluster do `nio init`)
   - `src/app/**`, `src/profiles/**`, `src/core/environment.ts`, `src/adapters/pkg/**`
   - `src/lib/client-configs.ts`, `src/lib/telemetry.ts`, `src/lib/dependency-install.ts`
   - `src/adapters/pg/**`, `src/core/session.ts`, `src/core/repositories.ts`,
     `src/gateway/services/**`, `src/gateway/middleware/**`
   Esses são o v2 / do EnvironmentBuilder. **Se você achar que PRECISA tocar num
   deles pra terminar o v1, PARE e pergunte ao dono do projeto** — não edite.
4. **Um passo = um commit pequeno.** Não junte "apagar auth.ts" com "mexer no
   package.json" no mesmo commit. Facilita reverter se algo quebrar.
5. **Registre em `docs/v2/PROGRESSO.md`** cada passo concluído (data, o que mudou,
   verificação), no formato das entradas existentes.

---

## ✅ Já concluído (NÃO refazer)

Verificado no disco em 25 ago 2026:

- **Apagados:** `src/adapters/supabase/*` (todos), `src/cli/commands/init/project-step.ts`
  (+ `.test.ts`), `src/lib/project-context.ts`, `src/lib/task-history.ts`.
- **`src/core/ports.ts`** — as interfaces v1 (`ContextGateway`/`TaskGateway`/
  `AllocationGateway`/`AnalyticsGateway`/`Gateway`) já foram removidas; **só
  `InvestigationGateway` permanece** (correto — é dual-IP read-only, não é v1).
- **`src/cli/ui/render.ts`** — `printContextSummary` + import de `ProjectContext`
  removidos (estava morto). Arquivo limpo.
- **`src/lib/telemetry.ts` + call sites** — desacoplado do `DbClient`:
  `track(event)` virou no-op v2, `provision-step.ts`/`sync.ts` ajustados,
  import de `flushTelemetry` restaurado em `index.ts`. **Feito pelo dono do
  projeto durante o EnvironmentBuilder — está fechado, não mexer.**
- **Tools v1, `session-factory.ts`, `token_session`, `sync.ts` (telemetria/overview)**
  — já removidos em rodadas anteriores.

---

## 🔜 O que falta (escopo desta rodada — só estes arquivos)

Grafo verificado: os únicos consumidores reais de Supabase/PAT restantes são
`auth.ts` (e seu teste) e as constantes que só ele usa.

### Passo 1 — Apagar `src/auth.ts` + `src/auth.test.ts`
`auth.ts` é o fluxo PAT→Supabase v1 (`loadCredentials`, `exchangePatForJwt`,
`resolveIdentity`). **Já substituído** por `gateway/services/login.ts` +
`cli/commands/auth.ts` (v2). Importado só por `auth.test.ts` — apague os dois
juntos. Confirme antes: `grep -rn "from.*['\"].*auth\.js" src` só deve casar
`gateway/middleware/auth.js`, `gateway/services/*` e `cli/commands/auth.js`
(todos v2, caminhos diferentes) — **nunca** `./auth.js`/`../auth.js` da raiz.

### Passo 2 — Limpar `src/constants.ts` + os casos em `src/brand.test.ts`
Depois que `auth.ts` sumir, ficam órfãs (só ele usava):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN_EXCHANGE_URL`, `CREDENTIALS_DIR`,
`CREDENTIALS_FILE`, `PAT_REGEX` — remover de `constants.ts`.
`brand.test.ts` importa/testa `CREDENTIALS_DIR`/`CREDENTIALS_FILE`/
`TOKEN_EXCHANGE_URL` (linhas ~7-10, 49-52) — remover esses casos junto.

### Passo 3 — Limpar `src/brand.ts`
Remover **só** `supabaseUrl` e `supabaseAnonKey`.
⚠️ **`patPrefix` e `patRegex` FICAM** — `src/lib/cowork-extension.ts` ainda usa
`brand.patPrefix`. Só saem quando o módulo Cowork sair (outra rodada).

### Passo 4 — Apagar `src/database.types.ts`
Tipos gerados pelo `supabase gen types`. **Zero importadores** hoje (confirmado).
Apague direto.

### Passo 5 — `package.json` (POR ÚLTIMO)
Remover a dependência `@supabase/supabase-js` e o script `gen:types`. Só depois
que os passos 1-4 já removeram todo uso — senão o `tsc`/instalação quebra antes.
Rodar `bun install` pra atualizar o lockfile.

### Passo 6 — Regenerar docs + registrar
`bun run gen:docs` (regenera a tabela de tools do `README.md`) e uma entrada em
`docs/v2/PROGRESSO.md`.

---

## Verificação (a cada passo e no fim)

```bash
bunx tsc --noEmit      # verde
bun test               # só as 4 falhas pré-existentes conhecidas

# No fim, nenhuma menção de código deve sobrar (comentários soltos tudo bem):
grep -rn "supabase" src package.json --include="*.ts" -i | grep -iv "//\|^\s*\*"
grep -rn "from ['\"]\.\./\?auth\.js['\"]" src   # esperado: vazio (raiz auth.ts foi-se)
```

---

## 🧭 Fora de escopo (NÃO fazer nesta rodada)

- **Órfãos do Gateway spec 0002** (`src/gateway/server.ts`, `sessions.ts`,
  `pkce.ts`, `authorize-*.ts`, `traceability.ts`, `types.ts`) — **não são
  Supabase**, são OAuth/PKCE superseded. Rodada separada.
- **Módulo Cowork** (`src/lib/cowork-extension.ts` + `brand.patPrefix`/`patRegex`)
  — decisão à parte; enquanto existir, `patPrefix` fica.
- **`workers/edge-filter/`** — confirmar destino com o dono do projeto antes.
- **Qualquer arquivo da ZONA PROIBIDA** acima.
