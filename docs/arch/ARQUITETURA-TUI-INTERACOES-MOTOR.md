# TUI — mapa de todas as interações "motor → usuário"

> Tudo que o `opencode serve` / big-pickle pode **pedir ao usuário** pela
> interface: permissões, toasts, perguntas abertas, erros, e as features de UX
> que a gente ainda quer construir (respostas sugeridas, multiple-choice…).
>
> **Estado atual (2026-09-07):** só **1 tipo** é tratado — permissão, e mesmo
> assim num **slot único** que quebra com batch paralelo (o bug do "executando
> bash" eterno). Este doc é o mapa pra fazer todos direito.

---

## O bug que motivou o mapa

`nio ai` → task → big-pickle dispara 3 `bash` em paralelo → opencode emite **3
`permission.asked`** com ~0,2s entre si. `state.ts` guarda **`permission: {…} |
null`** (slot único): a 3ª sobrescreve a 2ª sobrescreve a 1ª. O usuário responde
o modal que apareceu; os outros 2 ficam órfãos; o opencode fica `busy` esperando
pra sempre. Confirmado ao vivo: `GET /permission` mostrava 1–3 pendentes e o
`session.status = busy` travado por 6 min.

**Fix base (categoria A):** `permission` vira **fila**.

---

## Categoria A — Permissões  ·  *mecanismo real, existe hoje*

### A.1 — Como funciona

- opencode avalia cada ação contra as regras (`opencode.json` `permission` +
  regras da sessão). Resultado: `allow` (roda), `deny` (recusa), **`ask`**
  (emite `permission.asked`).
- Evento: `permission.asked` (o que o opencode 1.18 emite) / `permission.updated`
  (nome nos tipos do SDK). Ambos caem no mesmo handler.
- Resposta: `POST /session/{id}/permissions/{permID}` com
  `{ response: "once" | "always" | "reject" }`.
- `permission.replied` confirma (`{ permissionID, response }`).

### A.2 — Shape do `permission.asked` (real, capturado ao vivo)

```jsonc
{
  "id": "per_07e4ee7b3001…",
  "sessionID": "ses_…",
  "permission": "bash",                 // o TIPO — ver A.3
  "patterns": ["find src -type f …", "sort"],   // os comandos/paths exatos
  "metadata": { "command": "find src … | sort" },
  "always": ["find *", "sort *"],       // ← o "checkbox de sugestão": o que
                                        //   "sempre" salva (glob amplo, não o
                                        //   comando exato)
  "tool": { "messageID": "msg_…", "callID": "call_…" },
  "title": "…"                          // (nos tipos; às vezes ausente no runtime)
}
```

### A.3 — TODOS os tipos de permissão (capturados no log)

| Grupo | `permission` | O que a ação faz | `always` sugere |
|---|---|---|---|
| **Shell** | `bash` | roda comando(s) shell — **`patterns` = cada comando do pipe** | glob por binário (`find *`, `git *`) |
| **Arquivo — escrita** | `edit` | edita/cria/apaga arquivo | `<dir>/**` ou `*` |
| **Arquivo — leitura** | `read` | lê um arquivo | pattern por path/glob |
| | `glob` | lista arquivos por padrão | `*` |
| | `grep` | busca conteúdo | `*` |
| **Fora do projeto** | `external_directory` | acessa path fora do cwd da sessão | o dir |
| **Rede** | `webfetch` | baixa uma URL | domínio / `*` |
| | `websearch` | busca na web | `*` |
| **Loop** | `doom_loop` | opencode acha que está repetindo — pede pra continuar | — |
| **Sub-agente** | `task` | delega a um sub-agente | `*` |
| | `skill` | roda uma skill | nome da skill |
| **Todo** | `todowrite` / `todowrite` | grava a checklist | `*` |
| **MCP tools** | `<server>_<tool>` | qualquer tool de MCP server — ex.: `nio_nio_session_list`, `pencil_execute`, `hexstrike_*`, `rive_*` | por tool |

> **~40 tipos hoje**, e cresce a cada MCP server plugado. A UI não pode ter um
> layout por tipo — precisa de um **modal genérico** que renderiza
> `permission` + `patterns` + `metadata` + as 3 ações, com um **rótulo
> humano por grupo** (Shell / Arquivo / Rede / MCP…).

### A.4 — As 3 respostas + o "checkbox"

| Resposta | Efeito | UI |
|---|---|---|
| `once` | permite **esta** vez | `[a] permitir uma vez` |
| `always` | adiciona `permission.always[]` (glob amplo) às regras → não pergunta de novo pra o padrão | `[s] sempre` — **mostrar o que vai virar regra**: `sempre: find *, sort *` |
| `reject` | recusa; a tool falha com erro; o modelo se vira | `[d] negar` |

### A.5 — O que muda no código

```ts
// state.ts
interface PermissionReq {
  id: string; sessionId: string; kind: string;   // 'bash' | 'edit' | 'nio_…'
  patterns: string[]; command?: string; always: string[]; title: string;
}
interface ChatState {
  …
  permissions: PermissionReq[];   // ← FILA (era `permission: {…} | null`)
}
```
- `permission.asked` → `push` na fila (dedup por `id`).
- App mostra `permissions[0]`. Ao responder: POST + `shift()` + mostra a próxima.
- `permission.replied` externo (respondido por outra ponta) → remove aquele `id` da fila.
- Contador no modal: `permissão 1 de 3`.
- **Auto-agrupar**: 3 `bash` do mesmo `callID`-batch → 1 modal "3 comandos"
  com `[s] permitir todos`. (fase 2 — a fila já resolve o travamento.)

### A.6 — Config persistente (o "sempre" mora aqui)  ·  ✅ FEITO 7.5 (2026-09-07)

> **Implementado:** `client-configs.ts` `DEFAULT_OPENCODE_PERMISSION` — `bash`
> com allowlist de comandos só-leitura (`ls`, `cat`, `head/tail`, `find`, `grep`,
> `rg`, `git log/status/diff/show/branch`, `wc`, `which`, `echo`, `pwd`…) →
> `allow`, `*` → `ask`. `edit`/`webfetch`/`external_directory` → `ask`.
> `planOpencodeUpdate` semeia isso **só se `!existing.permission`** (nunca
> sobrescreve o do usuário); a ausência força uma re-escrita única. Corta o
> grosso dos prompts da TUI (era o batch `ls -la`/`git log`/`find` que travava).
> Testes em `client-configs-install.test.ts`.


`opencode.json` / agente:
```jsonc
"permission": {
  "edit": "ask" | "allow" | "deny",
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "webfetch": "ask", "doom_loop": "ask", "external_directory": "ask"
}
```
- O `nio` pode **semear defaults sensatos** no `opencode.json` que ele já gera
  (`ensureHeadroomAndWire`): `bash: { "ls *": allow, "git log*": allow, "find *":
  allow, "cat *": allow, "*": ask }`, `read/glop/grep: allow`. Corta 80% dos
  prompts sem abrir mão do controle sobre `edit`/`rm`/rede.
- `nio ai --yolo` → escreve `"*": "allow"` temporário (opt-in explícito).

---

## Categoria B — `tui.*`  ·  *o motor dirige a interface*  ·  ✅ FEITO 7.2 (2026-09-07)

> **Implementado:**
> - `tui.toast.show` → `ChatState.toasts` (fila, teto 5). `<Toasts>` renderiza
>   acima do input, 1 linha por variant (`✓` verde / `·` cinza / `⚠` amarelo /
>   `✗` vermelho). Poda por `until` (effect de 700ms).
> - `tui.prompt.append` → `setDraft((d) => d + text)` no loop de eventos.
> - `tui.command.execute` → `tuiCommandRef` (closures frescas):
>   `prompt.clear` → limpa · `prompt.submit` → envia · `agent.cycle` → `cycleMode`
>   · `session.interrupt` → abort · `session.compact` → `session.summarize()` +
>   toast · resto → toast "comando ignorado: X".
>
> **Testes:** `state.test.ts` (toast variant/teto), `app.test.tsx` (toast +
> append + agent.cycle + prompt.clear ao vivo) · suíte 542 pass.


Eventos que o opencode/plugins emitem pra **comandar a TUI**. Nenhum é tratado
hoje — a NIO só ouve `message.*` / `permission.*` / `session.*`.

| Evento | Payload | O que fazer na NIO |
|---|---|---|
| `tui.toast.show` | `{ title?, message, variant: info\|success\|warning\|error, duration? }` | **Toast** — 1 linha colorida acima do input, some sozinho (`duration` ou 4s). Fila própria (pode vir em rajada). |
| `tui.prompt.append` | `{ text }` | Injeta `text` no `draft` do input (cursor no fim). Ex.: uma skill que pré-preenche um comando. |
| `tui.command.execute` | `{ command: "session.compact" \| "session.new" \| "agent.cycle" \| "prompt.submit" \| "prompt.clear" \| "session.interrupt" \| … }` | Mapeia cada um pra uma ação do App (compactar contexto, nova sessão, ciclar modo, enviar, limpar, abortar). |

---

## Categoria C — Perguntas abertas  ·  *não é evento, é padrão*  ·  ✅ FEITO 7.4 (2026-09-07)

> **Implementado:** `state.ts` `pendingQuestion(state)` — se `!busy`, sem
> permissão na fila, e a última mensagem do assistant termina com `?` (ignorando
> blocos de código), devolve a última linha. `app.tsx` mostra `↳ o nio
> perguntou: "<pergunta>"` em `accentBright` acima do input. Some no próximo
> prompt (nova mensagem). Testes: `state.test.ts` (6 casos) + `app.test.tsx` (cue
> aparece no idle). **Drop-list de opções numeradas = 7.6.**


O big-pickle **não tem** um mecanismo nativo de "faço uma pergunta e espero".
O que acontece: o assistant **termina o texto com uma pergunta** e para
(`step-finish reason=stop` → `session.idle`). Aí é uma vez do usuário digitar.

**Como a NIO detecta e melhora a UX:**
- Ao ficar `idle`, se a última mensagem do assistant termina com `?` (ou tem
  linha `**pergunta:**` / bloco `> …?`): **destaca** a pergunta (borda no bloco),
  **foca o input**, e mostra hint `↵ responder`.
- (fase 2) Se o texto tem **opções numeradas** (`1. …\n2. …`), vira uma
  **drop-list** (categoria E.1).

---

## Categoria D — Erros e avisos do motor  ·  ✅ FEITO 7.3 (2026-09-07)

> **Implementado:** `session.error` → `ChatState.error` (`{name, message,
> retryable}`; `MessageAbortedError` = usuário abortou → ignora; `ProviderAuthError`
> /`MessageOutputLengthError` usam dica humana; `APIError.isRetryable` → `retryable`).
> `<ErrorBlock>` — bloco vermelho abaixo do status, **não bloqueia o input**;
> some no próximo prompt. `session.compacted` → toast `✂ contexto compactado`.
> `installation.update-available` → toast `nova versão do opencode: X`.
> Testes: `state.test.ts` (4 casos de erro + compacted + update) · `app.test.tsx`
> (bloco aparece, input segue vivo). Suíte 545 pass.


| Evento | Payload | UI |
|---|---|---|
| `session.error` | `error: ProviderAuthError \| ApiError \| MessageOutputLengthError \| MessageAbortedError \| UnknownError` | Bloco vermelho no lugar da resposta + ação: `ProviderAuthError` → "rode `opencode auth login`"; `ApiError isRetryable` → "tentar de novo? [r]"; `MessageOutputLengthError` → "resposta longa demais — peça em partes". Limpa `busy`. |
| `session.compacted` | `{ sessionID }` | Linha dim no histórico: `✂ contexto compactado`. |
| `session.idle` | — | fim do turno (já tratado). |
| `installation.update_available` | `{ version }` | Toast: `nova versão do opencode: X` (não bloqueia). |
| `session.diff` | `{ diff: FileDiff[] }` (`{file, additions, deletions, before, after}`) | ✅ **7.8** — `<DiffSummary>`: `✎ N arquivo(s): a.ts +18 −4 · b.ts +42` abaixo da resposta; some no próximo prompt |

---

## Categoria E — Features a CONSTRUIR  ·  *não-nativas — o que o dono pediu*

### E.1 — Drop-list de sugestões / respostas rápidas  ·  ✅ FEITO 7.6 (fonte a)

> **Implementado:** `state.ts` `questionOptions(state)` — quando a última msg do
> assistant (idle, sem permissão) contém `?` e ≥ 2 linhas de opção (`1.` / `2)` /
> `- [ ]` / `a)`), devolve os textos. `<QuestionPicker>` (menu numerado, ↑↓/Enter)
> aparece acima do input **quando o input está vazio**; digitar volta pro modo
> texto livre. Enter no menu → `send(opção escolhida)`. Fonte b (`nio_ask` tool) = 7.7.


Quando o modelo faz uma pergunta com opções, ou uma confirmação:
- **Fonte a:** parse do texto da última mensagem — linhas `1. …` / `- [ ] …` /
  `a) …` viram itens navegáveis (↑↓, Enter = manda `"N"` ou o texto do item).
- **Fonte b:** um **MCP tool** `nio_ask` que o agente chama com
  `{ question, options: [...], multi?: bool }` → a NIO renderiza a lista/checkbox
  e devolve a escolha como a próxima mensagem. (o mais confiável — estruturado)
- Checkbox multi-select → manda `"1, 3, 4"` ou os textos.

### E.2 — Questions estruturadas (o modelo pede pra detalhar)

Um MCP tool `nio_clarify` com `{ fields: [{ name, prompt, kind: text|choice }] }`
→ a NIO abre um mini-form (um campo por vez, reusa o `PromptInput`), coleta, e
devolve como JSON na próxima mensagem. Pro "pedir pra detalhar melhor a request".

### E.3 — MCP elicitation / `/tui/control/*`  ·  ⏸️ SPIKE 7.7 (não construído)

> `nio_ask`/`nio_clarify` interativos de verdade precisam de um canal
> bidirecional: **MCP `elicitation/create`** (opencode 1.18 **não expõe** nos
> eventos SSE) OU o endpoint **`/tui/control/next`** + `/tui/control/response`
> (long-poll — `client.tui.control.next()` devolve `{ path, body }`, a TUI
> responde com `client.tui.control.response({ body })`; os `path` são
> **indocumentados**). Construir contra qualquer um dos dois às cegas = spike.
>
> **Por ora o 7.6 + `tui.prompt.append` (7.2) cobrem ~80%** do "choice
> estruturado" sem tool custom. Retomar quando: (a) opencode expor elicitation,
> ou (b) alguém mapear os `path` do `/tui/control/next` ao vivo.


MCP 2025 tem `elicitation/create` (server pede input estruturado do usuário).
Opencode 1.18 **não expõe** isso nos eventos do SDK ainda — **verificar** em
versão futura; se vier, é o caminho canônico pro E.1/E.2 (não precisa de tool
custom).

### E.4 — "Sempre" com escopo escolhível

No modal de permissão, além de `once/always/reject`: um sub-menu no `always` pra
escolher **qual** pattern salvar (`find *` vs `find src *` vs o comando exato) —
o opencode já manda as opções em `permission.always[]`.

---

## Design unificado — uma fila só

Em vez de um estado por tipo, **um** `interactions: EngineAsk[]` no `ChatState`:

```ts
type EngineAsk =
  | { kind: 'permission'; …PermissionReq }
  | { kind: 'question'; text: string; options?: string[] }   // C / E.1
  | { kind: 'choice'; prompt: string; options: string[]; multi: boolean }  // E.1 (tool)
  | { kind: 'form'; fields: Field[] }                          // E.2
  | { kind: 'error'; error: SessionError; retryable: boolean } // D
```
- **Toasts** ficam numa fila separada (`toasts: Toast[]`) — não bloqueiam, somem sozinhos.
- App renderiza `interactions[0]` no lugar do input (input `active=false`).
- Cada `kind` tem seu componente (`<PermissionModal>`, `<QuestionPicker>`,
  `<ClarifyForm>`, `<ErrorBlock>`), todos com o mesmo contrato:
  `{ ask, onAnswer(result), onSkip() }`.
- `onAnswer` → efeito (POST permissão / `session.prompt` com a resposta) + `shift()`.

---

## Fases

| Fase | Escopo | Esf. |
|---|---|:---:|
| **7.1** | ✅ **FEITO 2026-09-07.** `ChatState.permissions` = fila; `permission.asked` empilha (dedup por id), `permission.replied` remove por id. `respondPermission` responde `[0]` + `shift()`. `PermissionModal` genérico: grupo (`permGroupLabel`), `$ command` / patterns, `sempre = <globs>`, `(+N na fila)`, `[a]/↵ · [s] · [d]/Esc`. Testes: batch de 3 → fila, dedup, shift, 3 POSTs, nenhuma órfã. suíte 540 pass. | **M** |
| **7.1b** | ✅ **FEITO 2026-09-07 (bug ao vivo).** A fila do 7.1 assumia que **todo** `permission.asked` chega no SSE. Não chega: uma permissão de **sub-agente** (`task` / `@explore`) — ou um evento perdido numa reconexão do stream — nunca aparecia, e como o opencode **não repete** o evento, o motor travava pra sempre em "processando" (visto ao vivo: 2 `bash` de sub-agente pendentes há 19 min, sessão-mãe `busy`, sem modal). **Fix:** `resync()` (roda a cada 4s enquanto `busy` + em toda reconexão) agora também faz `GET /permission` (`fetchPendingPermissions` — `fetch` cru, o SDK não tipa) e `reconcilePendingPermissions(state, live)` reconcilia a fila com a verdade do server: adiciona as perdidas (dedup por id), tira as que sumiram. `toPermissionReq()` extraído (normaliza evento **e** REST). Recupera em ≤4s. Teste novo em `state.test.ts`. suíte 553 pass. | **P** |
| **7.2** | ✅ **FEITO** — `tui.toast.show` (fila + `<Toasts>`) · `tui.prompt.append` (injeta no draft) · `tui.command.execute` (clear/submit/agent.cycle/interrupt/compact + toast fallback) | P–M |
| **7.3** | ✅ **FEITO** — `session.error` (`<ErrorBlock>` não-bloqueante + dicas), `session.compacted` / `installation.update-available` → toast | P |
| **7.4** | ✅ **FEITO** — `pendingQuestion()` + cue `↳ o nio perguntou` acima do input | P |
| **7.5** | ✅ **FEITO** — `DEFAULT_OPENCODE_PERMISSION` semeado no `opencode.json` (bash allowlist só-leitura → allow, resto → ask) | P |
| **7.6** | ✅ **FEITO** — `questionOptions()` + `<QuestionPicker>` (menu ↑↓/Enter quando o input está vazio) | M |
| **7.7** | ⏸️ **SPIKE** — precisa de MCP elicitation (não exposto no 1.18) ou `/tui/control/*` (indocumentado). 7.6 + 7.2 cobrem ~80% | M–G |
| **7.8** | ✅ **FEITO** — `<DiffSummary>` (`✎ N arquivo(s): …`) a partir de `session.diff` | M |

---

## Superfície

`src/tui/state.ts` (fila + novos `EngineAsk`) · `src/tui/palette.tsx` /
componentes novos (`QuestionPicker`, `ClarifyForm`, `ErrorBlock`, `Toast`) ·
`src/tui/app.tsx` (renderiza `interactions[0]`, fila de toasts) ·
`src/tui/opencode.ts` (helper de reply) · `src/app/ai-client.ts` /
`opencode.json` (defaults de permissão) · `src/tools/` (`nio_ask`, `nio_clarify`).

## Ligações

- `docs/arch/ARQUITETURA-TUI-UX-SPRINTS.md` — Sprints 1–6 (feitas); isto é o **Sprint 7**.
- `@opencode-ai/sdk` `types.gen.d.ts` — a fonte dos eventos.
- Bug histórico: memória `security-audit` menciona *"loop infinito de processando
  — permission.asked não era tratado"* (corrigido pra 1 permissão; o batch nunca foi).
