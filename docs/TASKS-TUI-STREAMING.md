# Tasks — Streaming/UX da TUI (interface only)

> Origem: análise do kit externo `GETTING-STARTED-KIT-STREAMING.md` (2026-09-18) contra a arquitetura real da NIO-CLI. O kit foi escrito para um projeto diferente (client direto a um LLM + pipeline RAG próprio) — a maior parte dele não se aplica aqui. Este documento registra só o que sobreviveu à análise, com passo a passo e código real contra os arquivos de `src/tui/`. Escopo travado: **nenhuma mudança fora de `src/tui/` e `src/lib/clients/client-configs.ts` (import only)**. Sem Docker, sem Python, sem RAG, sem tocar `opencode`/`qwen-client.ts`.

## Como usar este documento

Cada task tem: **Objetivo**, **Por que** (ou por que não), **Onde mexe**, **Passo a passo com código**, **Critério de pronto**. Task marcada **[NÃO FAZER]** está aqui pra registrar a decisão e evitar retrabalho — não é pra implementar.

---

## Task 1 — Verificar se o campo `delta` chega populado no evento real

**Prioridade real: baixa.** Ver "Por que" abaixo antes de gastar tempo nisto.

### Objetivo
Confirmar empiricamente, com o app rodando, se `message.part.updated` chega com o campo opcional `delta` preenchido — pré-requisito pra decidir a Task 1b.

### Por que a expectativa de ganho é baixa (leia antes de implementar)
O tipo real do evento (`@opencode-ai/sdk@1.18.25`, `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:355-359`) é:

```typescript
export type EventMessagePartUpdated = {
    type: "message.part.updated";
    properties: {
        part: Part;       // snapshot completo do part (part.text = texto ATUAL inteiro)
        delta?: string;    // incremento desde o tick anterior
    };
};
```

`part` e `delta` chegam **juntos, no mesmo evento** — não há um evento "delta" que chega antes/mais barato que o snapshot. Isso significa que consumir `delta` em vez de `part.text` não reduz nem a quantidade de eventos SSE nem os bytes recebidos — só troca `text = raw.text` (replace) por `text += delta` (append), uma diferença de custo de CPU irrelevante para texto de chat. **O ganho de "TTFB 500ms→150ms" do kit não se sustenta neste evento real** — aquele número vem de um contexto onde streaming está desligado vs ligado (`stream:false` vs `stream:true` no backend), não de delta vs snapshot dentro de um stream que já está ligado. A NIO já usa streaming (SSE) ponta a ponta.

Ainda assim, documentado abaixo pra fechar a dúvida com dado real, não suposição.

### Onde mexe
`src/tui/state.ts` (temporário, reverter depois do teste).

### Passo a passo

1. Em `state.ts`, dentro de `applyEvent` (por volta da linha 359, logo após o `tlog('event', ...)` existente), adicione uma linha temporária:

```typescript
// TEMPORÁRIO — remover depois de verificar
if (etype === 'message.part.updated' && typeof p.delta === 'string') {
  tlog('DELTA-CHECK: delta presente, len=', p.delta.length);
}
```

2. Rode a TUI com debug ligado e converse um pouco:

```bash
NIO_DEBUG=1 bun run dev:cli ai
# (ou o binário instalado: NIO_DEBUG=1 nio ai)
```

3. Depois de uma resposta completa do modelo, cheque o log:

```bash
grep "DELTA-CHECK" ~/.nio/tui.log | wc -l
```

4. Critério:
   - **0 linhas** → `delta` nunca vem populado nesta versão do backend/opencode → **não implemente a Task 1b**, apague o log temporário e encerre aqui.
   - **> 0 linhas** → vem populado → avalie a Task 1b sabendo que o ganho é só de CPU (marginal), não de latência percebida.

5. Remova a linha temporária de `tlog` antes de commitar qualquer coisa (não é comportamento de produção).

### Critério de pronto
Resultado do `grep` registrado (0 ou N) e decisão sobre a Task 1b tomada com base nisso, não em suposição.

---

## Task 1b — Hybrid Delta+Snapshot (implementação condicional)

**Só implemente se a Task 1 confirmar `delta` populado E vocês decidirem que vale o esforço mesmo sabendo que o ganho é de CPU, não de latência.**

### Objetivo
Quando `delta` vier populado, usar `text += delta` em vez de `text = raw.text` — evita recriar a string inteira a cada tick para mensagens longas.

### Onde mexe
`src/tui/state.ts` — `RawPart` (interface), `applyEvent` (case `message.part.updated`), `computePart`.

### Passo a passo

1. Adicione `delta` à interface `RawPart` (`state.ts:262-271`):

```typescript
interface RawPart {
  id?: string;
  messageID?: string;
  type?: string;
  text?: string;
  delta?: string;   // NOVO — incremento, quando o server manda
  tool?: string;
  state?: { status?: string; output?: string; error?: string; title?: string; input?: Record<string, unknown> };
  tokens?: { input?: number; output?: number };
  cost?: number;
}
```

2. No case `message.part.updated` (`state.ts:403-414`), propague o `delta` que hoje é descartado (`p.delta` é irmão de `p.part`, e só `p.part` é usado):

```typescript
case 'message.part.updated': {
  const raw = (p.part ?? p) as RawPart;
  if (typeof p.delta === 'string') raw.delta = p.delta; // NOVO — repassa o delta do evento
  if (raw.messageID && raw.id) {
    state.messages = withMessage(
      withoutPending(state.messages, raw.messageID),
      raw.messageID,
      'assistant',
      (parts) => applyRawPart(parts, raw),
    );
  }
  break;
}
```

3. Em `computePart` (`state.ts:318-341`), prefira `delta` (append) quando presente e houver um `prev` do mesmo tipo; caia pro snapshot (`raw.text`, replace) em qualquer outro caso — isso é o "hybrid": delta quando dá pra confiar nele, snapshot sempre que não:

```typescript
function computePart(prev: ChatPart | undefined, raw: RawPart): ChatPart | null {
  const id = raw.id as string;
  const type = raw.type ?? 'text';
  if (type === 'step-start') return null;
  if (type === 'step-finish') {
    return {
      id, kind: 'step', text: prev?.text ?? '',
      step: { tokensIn: raw.tokens?.input ?? 0, tokensOut: raw.tokens?.output ?? 0, cost: raw.cost ?? 0 },
    };
  }
  if (type === 'tool') {
    return {
      id, kind: 'tool', text: raw.state?.title ?? raw.tool ?? 'tool',
      tool: {
        name: raw.tool ?? 'tool', status: raw.state?.status ?? 'running',
        input: raw.state?.input, output: String(raw.state?.output ?? raw.state?.error ?? ''),
      },
    };
  }
  const kind = type === 'reasoning' ? 'reasoning' : 'text';
  // NOVO — hybrid: delta só é confiável se já existe um part do MESMO id/kind pra
  // continuar (senão vira texto órfão). Snapshot (raw.text) é sempre a fonte
  // de verdade quando vem — nunca deixa o delta divergir por mais de 1 tick.
  if (typeof raw.delta === 'string' && prev && prev.kind === kind) {
    return { id, kind, text: prev.text + raw.delta };
  }
  if (typeof raw.text === 'string') {
    return { id, kind, text: raw.text };
  }
  return prev ?? null;
}
```

4. **Não** remova a leitura de `raw.text` — ela continua sendo a fonte de verdade quando `delta` não vem (primeiro tick de cada part, reconexão via `resync`/`syncMessages`, ou qualquer evento que venha sem `delta`). O `syncMessages` (re-sync do server, `state.ts:511-539`) nunca deve usar `delta` — ele já reconstrói do zero a partir do snapshot completo do server, isso é intencional e não muda.

5. Teste: adicionar em `state.test.ts` um caso que simula um `message.part.updated` com `delta` populado e outro sem, confirmando append num caso e replace no outro (padrão dos testes existentes no arquivo, ex. `'Sprint 2 — step-finish vira part step com tokens/custo'`).

### Critério de pronto
`bun test src/tui/state.test.ts` verde, incluindo o novo caso de `delta`; nenhuma mudança de comportamento visível pro usuário (é uma otimização interna, não uma feature).

---

## Task 2 — Token Budget visual no rodapé (recomendado)

### Objetivo
Mostrar no rodapé da TUI quanto da janela de contexto efetiva já foi consumido na sessão, com aviso visual perto do teto — hoje o rodapé mostra só a contagem bruta de tokens (`${kfmt(sessionTokens)} tok`), sem relação com o limite real.

### Por que faz sentido
O limite já existe e é real: `NIO_AI_EFFECTIVE_CONTEXT` (`src/lib/clients/client-configs.ts:242-245`) é o teto que o próprio opencode usa pra orçar a janela da sessão (`min(NIO_AI_CONTEXT, NIO_AI_MAX_INPUT + NIO_AI_OUTPUT)`, default 34048 tokens). A TUI já soma o consumo real (`sessionTokens`, `app.tsx:346-353`, via `messageUsage` em `state.ts:607-618`). Só falta ligar os dois — nenhuma infraestrutura nova, nenhuma dependência.

### Onde mexe
`src/tui/app.tsx`, `src/tui/components.tsx`.

### Passo a passo

1. Em `app.tsx`, importe a constante (linha ~12, junto dos outros imports de `client-configs.js`):

```typescript
import { NIO_AI_PROVIDER, NIO_AI_MODEL_ID, NIO_AI_EFFECTIVE_CONTEXT } from '../lib/clients/client-configs.js';
```

2. Ainda em `app.tsx`, passe a constante pro `Footer` (por volta da linha 436-442):

```tsx
<Footer
  model={modelLabel}
  cwd={cwd}
  session={session}
  mode={mode}
  sessionTokens={sessionTokens}
  contextLimit={NIO_AI_EFFECTIVE_CONTEXT}
/>
```

3. Em `components.tsx`, atualize a assinatura do `Footer` (linha 130-162):

```tsx
export function Footer({
  model,
  cwd,
  session,
  mode,
  sessionTokens = 0,
  contextLimit = 0,
}: {
  model: string;
  cwd: string;
  session: { name: string; profile: string } | null;
  mode?: string;
  sessionTokens?: number;
  /** NOVO — teto de contexto efetivo (NIO_AI_EFFECTIVE_CONTEXT), 0 = não mostra % */
  contextLimit?: number;
}): React.ReactElement {
  const folder = cwd.replace(/\/+$/, '').split('/').pop() || cwd;
  const pct = contextLimit > 0 ? sessionTokens / contextLimit : 0;
  const tokenColor = pct >= 0.9 ? theme.err : pct >= 0.7 ? theme.warn : theme.dim;
  const tokenLabel =
    sessionTokens > 0
      ? contextLimit > 0
        ? `${kfmt(sessionTokens)}/${kfmt(contextLimit)} tok (${Math.round(pct * 100)}%)`
        : `${kfmt(sessionTokens)} tok`
      : null;
  const bits: string[] = [`⏵ ${model}`, folder];
  if (session) bits.push(`${session.name} · ${session.profile}`);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={theme.dim}>{bits.join('  ·  ')}</Text>
        {mode ? <Text color={theme.accentBright}>{`  [${mode}]`}</Text> : null}
        {tokenLabel ? <Text color={tokenColor}>{`  ${tokenLabel}`}</Text> : null}
      </Text>
      <Text color={theme.dim}>
        <Text color={theme.accent}>/</Text> paleta{'   '}
        <Text color={theme.accent}>^R</Text> raciocínio{'   '}
        <Text color={theme.accent}>Tab</Text> modo{'   '}
        <Text color={theme.accent}>Esc</Text> abortar{'   '}
        <Text color={theme.accent}>^C</Text> sair
      </Text>
    </Box>
  );
}
```

Thresholds usados (ajustáveis, não são regra de negócio, só UX): **70%** = amarelo (`theme.warn`), **90%** = vermelho (`theme.err`) — mesmas cores já usadas pra erro/aviso em todo o resto da TUI (`ErrorBlock`, `Toasts`), não introduz cor nova.

4. Atualize/adicione teste em `components.test.tsx` cobrindo o novo `contextLimit` (renderiza `Footer` com `sessionTokens` alto e confirma que a cor/percentual aparecem) — siga o padrão dos testes existentes no arquivo.

### Critério de pronto
`bun test src/tui/components.test.tsx src/tui/app.test.tsx` verde; rodar a TUI manualmente (`NIO_DEBUG=1 nio ai`) e confirmar visualmente que o rodapé mostra `N/M tok (X%)` e muda de cor perto do teto.

---

## Padrões descartados (registrado para não haver retrabalho)

| Padrão | Decisão | Motivo |
|---|---|---|
| **Adaptive Chunking** | [NÃO FAZER] | Pressupõe um pipeline de RAG que a NIO não tem — `src/adapters/lang/knowledge-store.ts` é um key-value de arquivo, sem chunk/embedding/vetor (verificado, grep vazio). Implementar chunking sem retrieval é YAGNI. |
| **Late Chunking** | [NÃO FAZER] | Mesma dependência ausente (embeddings/RAG). |
| **Semantic Cache** | [NÃO FAZER] | Mesma dependência ausente; o próprio kit já marca como opcional. |
| **State Machine formal (lib de FSM)** | [NÃO FAZER] | A máquina de estados já existe, implicitamente e corretamente, em `state.ts`/`app.tsx` (mapeada em detalhe na sessão anterior), coberta por teste. Trocar por uma lib (xstate etc.) é abstração sem falha concreta nomeada — só se aparecerem bugs reais de estado inconsistente. |
| **Remoção do opencode / integração direta com vLLM** | [NÃO FAZER] | opencode é o motor inteiro de tool-calling, permissão, tools nativas (bash/edit/read/grep/glob/webfetch/websearch) e cliente MCP — nada disso existe em código próprio da NIO (`qwen-client.ts` é só uma chamada única de texto, sem tool-calling). Remover é reconstruir um motor de agente do zero, fora do escopo de "interface", decisão estrutural/irreversível. Ver `docs/arch/ARQUITETURA-CLIENTE-IA.md`. |

## Nota sobre o kit original

O restante do `GETTING-STARTED-KIT-STREAMING.md` (Task 1-5, Sprints 2-3: RAG com LlamaIndex/Chroma, Docker Compose, ambiente Python, LangGraph) não está listado aqui porque não é trabalho de interface — é infraestrutura nova inteira, fora do escopo definido para esta rodada. Não descartado por mérito técnico, só fora de escopo; se algum dia entrar em pauta, é uma decisão separada e maior (N3), não uma task de TUI.
