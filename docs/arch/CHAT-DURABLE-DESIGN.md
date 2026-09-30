# Arquitetura: Chat Tasks Duráveis (Opção A)

## Objetivo
Permitir que requests intensas em `nio ai` sejam executadas pelo `nio-worker`, garantindo durabilidade: se a CLI morrer, o worker retoma de onde parou.

---

## 1. Fluxo Arquitetural

### Hoje (ephemeral):
```
User (nio ai)
    ↓
TUI in-process
    ├─ Cria task (kind: 'chat')
    ├─ Executa INLINE
    └─ Se morre → orphaned
```

### Amanhã (durable, Opção A):
```
User (nio ai)
    ↓
TUI in-process
    ├─ Cria task (kind: 'chat')
    ├─ Monitora intensidade (tokens/min)
    │
    ├─ Se BAIXA intensidade:
    │  └─ Executa INLINE (experiência rápida)
    │
    └─ Se ALTA intensidade (threshold):
       ├─ PAUSA execução local
       ├─ Envia digest ao worker (checkpoint)
       ├─ Muda status da task: 'chat' → 'running' (worker)
       └─ Mostra: "delegando pro background… `nio task show <id>` pra acompanhar"

nio-worker
    ├─ Reclama tasks (kind: 'chat') do banco
    ├─ Retoma da última step DONE
    ├─ Executa via opencode-executor (mesma lógica headless)
    ├─ Persiste outcomes
    └─ Se morre → próximo worker retoma
```

---

## 2. Mudanças de Código (escopo preciso)

### 2.1 TUI: Monitoramento e Delegação (`src/tui/app.tsx`)

**Adicionar:**

```typescript
// Constantes
const INTENSITY_THRESHOLD_TOKENS_PER_SEC = 500;  // tokens/s dispara delegação
const INTENSITY_CHECK_INTERVAL_MS = 5000;         // verifica a cada 5s

// Interface de tracking
interface IntensityMetrics {
  startTime: number;
  tokensSoFar: number;
  isIntense: boolean;
}

// Hook novo
function useIntensityMonitor(): {
  recordTokens(delta: number): void;
  shouldDelegate(): boolean;
} {
  const metricsRef = useRef<IntensityMetrics>({ startTime: 0, tokensSoFar: 0, isIntense: false });
  
  const recordTokens = useCallback((delta: number) => {
    if (!metricsRef.current.startTime) {
      metricsRef.current.startTime = Date.now();
    }
    metricsRef.current.tokensSoFar += delta;
  }, []);
  
  const shouldDelegate = useCallback(() => {
    const elapsed = (Date.now() - metricsRef.current.startTime) / 1000;
    if (elapsed < 1) return false;
    const tokensPerSec = metricsRef.current.tokensSoFar / elapsed;
    return tokensPerSec > INTENSITY_THRESHOLD_TOKENS_PER_SEC;
  }, []);
  
  return { recordTokens, shouldDelegate };
}

// Função de delegação
async function delegateToWorker(
  task: Task,
  currentSessionId: string,
  lastStepOutput: string,
) {
  // Cria checkpoint no banco
  await taskRepository.setStatus(task.id, 'running', task.fence, {
    engineSessionId: currentSessionId,
    awaiting_kind: null,  // limpa qualquer bloqueio anterior
  });
  
  // Pausa a sessão local
  await handle.client.session.abort({ path: { id: currentSessionId } });
  
  // Informa o usuário
  toast(`delegando pro background… rodando via nio-worker\n\nAcompanhe com:\nnio task show ${task.id.slice(0, 8)}`);
  
  // Retorna controle (TUI sai)
  return { delegated: true, taskId: task.id };
}
```

### 2.2 Worker: Suporte a Chat Tasks (`src/adapters/agent/opencode-executor.ts`)

**Modificar linha 11 (migration 0014 comment):**

```typescript
// ANTES:
// "O `nio-worker` nunca reivindica `kind = 'chat'` (migration 0014)."

// DEPOIS:
// "O `nio-worker` reivindica AMBAS: kind='agent' (planejadas) e kind='chat' (delegadas da TUI)."
```

**Adicionar:**

```typescript
// Pré-processor: detecta se é chat delegada
function isChatDelegated(task: Task): boolean {
  return task.kind === 'chat' && task.status === 'running';
}

// Em createOpencodeStepExecutor.run():
if (isChatDelegated(task)) {
  // Sessão já existe (foi criada na TUI)
  // Retoma a partir do último step DONE
  // Sem re-planejar (é chat, não agent)
  sessionIdAtual = task.engineSessionId ?? await garantirSessao(task);
}
```

### 2.3 Task Manager: Clarifique Kind='chat' (`src/app/task-manager.ts`)

**Adicionar comentário:**

```typescript
/**
 * kind='chat': criada por `nio ai` inline, mas pode ser delegada a worker.
 * - Se BAIXA intensidade: executa na TUI, nunca entra na queue do worker
 * - Se ALTA intensidade: TUI delega, worker a reclama e retoma
 * - Worker trata igual a 'agent', mas sem Planner (já tem instrução)
 */
```

### 2.4 Worker Loop: Aceite Chat Tasks (`src/app/task-runner.ts`)

**Modificar queue.claim():**

```typescript
// ANTES:
const task = await this.queue.claim(workerId, userId);

// DEPOIS:
// Trata 'chat' e 'agent' por igual na fila
// SQL já traz ambos por status='pending' ou 'running' (delegadas)
const task = await this.queue.claim(workerId, userId, { kinds: ['agent', 'chat'] });
```

---

## 3. Garantias de Segurança

### 3.1 Transições de Estado (invariantes)

```
TUI cria task:
  status: 'planning' → 'running' (status atual)
         ↓
Monitora intensidade
  ├─ BAIXA: executa inline
  │         ↓
  │         step.finish() → status: 'completed'
  │
  └─ ALTA: delega ao worker
           ↓
           status: 'running' (persiste) [CHECKPOINT]
           ↓
           worker.claim() retoma
           ↓
           step.finish() → status: 'completed'
```

**Invariante:** Só UMA entidade (TUI OU worker) executa um step por vez.
- **Guardrail:** `tasks.fence` (otimistic lock) protege transições
- Se TUI tenta salvar após worker começar → collision → TUI vê erro e sai
- Se worker está rodando → TUI não pode delegação (já em flight)

### 3.2 Durabilidade

| Cenário | Hoje | Com Opção A |
|---------|------|------------|
| CLI morre em step intenso | ❌ Task orphaned | ✅ Worker retoma |
| Worker morre no meio | N/A | ✅ Próximo worker retoma (mesmo lease/fencing) |
| TUI e worker conflitam | N/A | ✅ Fence detecta, um falha (re-tenta) |

### 3.3 Integridade do Histórico

```typescript
// Nunca reescrever steps já DONE
if (priorStep.status === 'done') {
  // Step é imutável — worker só acumula novas steps
  // TUI que delegou não tocou nele mais
  const trilha = await this.steps.listByTask(task.id);
  // Começa do PRIMEIRO step pending (não feito ainda)
}
```

---

## 4. Fluxo Detalhado: Delegação

### 4.1 Trigger (TUI, a cada 5s)

```typescript
// No sendMessage(), após cada evento:
if (shouldDelegate()) {
  await delegateToWorker(task, sessionId.current, chatRef.current.messages.map(m => m.text).join('\n'));
  // TUI para de executar, worker assume
  return;
}
```

### 4.2 Handoff (TUI → Worker)

```
1. TUI detecta intensidade
   └─ tokens/s > 500

2. TUI checkpoint:
   ├─ tasks.setStatus(task, 'running', fence)
   ├─ Persiste engineSessionId (sessão do OpenCode)
   └─ Limpa error/awaiting (clean slate pro worker)

3. TUI aborta sessão local:
   └─ session.abort() (evita duas cópias executando)

4. Worker na próxima volta:
   ├─ queue.claim() pega tasks status='running'
   ├─ Detecta kind='chat' (é delegação, não planning)
   ├─ Retoma engineSessionId do banco
   └─ Continua via opencode-executor (mesma máquina de estados)
```

### 4.3 Resumption (Worker)

```typescript
// Em TaskRunner.processar():
if (task.kind === 'chat' && task.status === 'running') {
  // Sem planning (já tem meta-instrução: a mensagem do usuário)
  // Pula direto pra executarSteps()
  const parou = await this.executarSteps(task, workerId);
  if (parou) return; // halt (waiting_approval etc)
  if (await this.validar(task, workerId)) return; // complete
}
```

---

## 5. Mudanças por Arquivo

### Core
| Arquivo | Mudança | Tipo |
|---------|---------|------|
| `src/core/tasks.ts` | Redefine `kind: 'chat'` (delegável, não ephemeral) | Doc clareza |

### App
| Arquivo | Mudança | Tipo |
|---------|---------|------|
| `src/app/task-manager.ts` | Comentário: chat pode ser delegada | Doc |
| `src/app/task-runner.ts` | `queue.claim()` aceita `kinds: ['agent','chat']` | Feature |

### Adapters
| Arquivo | Mudança | Tipo |
|---------|---------|------|
| `src/adapters/agent/opencode-executor.ts` | Remove bloqueio `kind='chat'`, reusa `garantirSessao()` | Feature |

### TUI
| Arquivo | Mudança | Tipo |
|---------|---------|------|
| `src/tui/app.tsx` | `useIntensityMonitor()` hook + `delegateToWorker()` func | Feature |
| `src/tui/use-turn-task.ts` | Nenhuma mudança necessária | - |

---

## 6. Testes Necessários

### Unit
- `task-runner.test.ts`: Confirma que kind='chat' é processada (não skipped)
- `opencode-executor.test.ts`: Simula resumption via `isChatDelegated()`
- `app.test.tsx`: Monitora intensidade, dispara delegação no threshold

### Integration
- Fluxo completo: nio ai → intenso → delega → worker retoma → completa
- Crash simulation: matar worker no meio de chat delegada, verificar retomada

### Safety
- Fence test: TUI tenta salvar após worker começou → colisão detectada
- Orphan cleanup: task nunca fica presa em limbo (status mismatch)

---

## 7. Roadmap de Implementação (fases)

### Fase 1: Fundação (1-2 commits)
- [ ] Remove bloqueio `kind='chat'` no worker
- [ ] Adiciona `isChatDelegated()` no executor
- [ ] Testes: worker processa chat tasks

### Fase 2: Monitoramento (1 commit)
- [ ] `useIntensityMonitor()` na TUI
- [ ] Testes: intensidade detectada corretamente

### Fase 3: Delegação (1 commit)
- [ ] `delegateToWorker()` no app.tsx
- [ ] Checkpoint seguro (fence + persist)
- [ ] Testes: TUI delega, worker retoma

### Fase 4: Validação (1-2 commits)
- [ ] Testes integração (E2E)
- [ ] Crash simulation tests
- [ ] Docs: atualizar AGENT.md

---

## 8. Propriedades Garantidas

✅ **Durability**: Se TUI morrer, worker retoma do último step DONE
✅ **Atomicity**: Estado transições são persisted (fence protege)
✅ **Consistency**: Histórico nunca é reescrito, só estendido
✅ **Isolation**: Só TUI OU worker executa (não ambos)
✅ **Backward Compat**: Chat ephemeral (baixa intensidade) continua funcionando igual

---

## 9. Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| TUI delega, worker morre antes de reivindicar | Lease timeout + próximo worker assume |
| Worker muda engineSessionId, TUI tenta usar antigo | Fence mismatch detecta, TUI sai |
| Chat task fica presa em 'running' forever | Heartbeat + lease timeout (30min) reseta |
| Delegação acontece no meio de um step | Impossible: checkpoints antes de delegar |

---

## 10. Exemplo: Traço de uma Request Intensa

```
17:30:00 user@nio ai
         └─ "Analisa esses 500 arquivos e gera relatório"

17:30:01 TUI cria task (kind='chat', status='planning')
         └─ sessionId: s-abcd1234

17:30:05 tokens acumulam: 450/s (normal)
         └─ Executa inline

17:30:10 tokens disparam: 850/s (INTENSA!)
         └─ shouldDelegate() = true

17:30:11 TUI checkpoint:
         ├─ tasks.setStatus(task, 'running', fence)
         ├─ engineSessionId: s-abcd1234 persisted
         └─ session.abort()
         
         Toast: "delegando pro background…"

17:30:12 Worker tick:
         ├─ queue.claim() → task (kind='chat', status='running')
         ├─ opencode-executor retoma sessão s-abcd1234
         ├─ executa steps restantes
         └─ step.finish() → task complete

17:30:45 Task finaliza:
         └─ tasks.complete(task, fence, result)

---

Fim.
