/**
 * `StepExecutor` sobre o `opencode serve`. Um step = uma chamada `session.prompt`;
 * a NIO orquestra a SEQUÊNCIA de steps, o OpenCode executa UM deles com tools.
 *
 * Contrato de segurança deste arquivo:
 *  - **Nada executa sem decisão explícita.** O default do `PermissionDecider` é
 *    `park`: sem política injetada, nenhuma tool roda.
 *  - **Nenhum caminho de saída deixa o motor pendurado.** Todo pedido bloqueante
 *    (permissão ou pergunta) recebe resposta ou a sessão é abortada. Headless,
 *    um turno preso não aparece para ninguém — é o pior modo de falha do sistema.
 *  - **Timeout é obrigatório**, não opcional: step sem teto trava o worker.
 */
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import type {
  PermissionDecider,
  PermissionDecision,
  StepExecutor,
  StepHalt,
  StepOutcome,
} from '../../core/agent.js';
import type { Task, TaskStep } from '../../core/tasks.js';
import {
  createStepAccumulator,
  eventSessionId,
  isTurnEnd,
  permissionFrom,
  questionFrom,
  type PedidoBloqueante,
} from './step-events.js';

/** Teto por step. Generoso para trabalho real, finito para não travar o worker. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Sem política injetada nada roda — o cofre nasce fechado. */
const DECIDER_PADRAO: PermissionDecider = { decide: () => 'park' };

export interface OpencodeExecutorDeps {
  client: OpencodeClient;
  /** Base do `opencode serve` — a resposta a `question` não está no SDK. */
  baseUrl: string;
  model: { providerID: string; modelID: string };
  /**
   * Política POR TASK: a decisão depende das concessões pontuais que o humano
   * deu a ela (`tasks.approved_tools`), não só do perfil. Ausente = cofre
   * fechado, nada roda.
   */
  deciderFor?: (task: Task) => PermissionDecider;
  timeoutMs?: number;
  /**
   * Stream SSE do motor. **Obrigatório**: o executor é um adapter e não pode
   * importar de `tui/` (seta invertida). Quem liga os fios é o entrypoint do
   * worker, que pode conhecer as duas pontas.
   */
  subscribe: (client: OpencodeClient, signal: AbortSignal) => AsyncGenerator<Event | null>;
}

/**
 * Prompt do step. O `goal` da task entra como contexto, a `instruction` como a
 * ordem — o modelo precisa dos dois para não perder o fio entre steps.
 */
export function buildStepPrompt(task: Task, step: TaskStep): string {
  const instrucao = (step.input?.instruction as string | undefined) ?? step.name;
  return [
    `Objetivo geral da tarefa: ${task.goal}`,
    '',
    `Passo atual (${step.stepNumber}): ${step.name}`,
    instrucao,
  ].join('\n');
}

/** Responde uma permissão. `once` nunca `always`: o "sempre" é decisão do humano. */
async function responderPermissao(
  client: OpencodeClient,
  pedido: PedidoBloqueante,
  permitir: boolean,
): Promise<void> {
  await client
    .postSessionIdPermissionsPermissionId({
      path: { id: pedido.sessionId, permissionID: pedido.id },
      body: { response: permitir ? 'once' : 'reject' },
    })
    .catch(() => {
      /* motor já pode ter desistido; abortar depois cobre */
    });
}

/** Rejeita uma pergunta via REST — o SDK não expõe essa rota. */
async function rejeitarPergunta(baseUrl: string, pedido: PedidoBloqueante): Promise<void> {
  await fetch(new URL(`/session/${pedido.sessionId}/question/${pedido.id}/reject`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    /* idem: o abort da sessão é a rede de segurança */
  });
}

/** Evento de OUTRA sessão não pode entrar neste step. Sem `sessionID`, passa. */
function ehDeOutraSessao(evt: unknown, sessionId: string): boolean {
  const id = eventSessionId(evt);
  return id !== undefined && id !== sessionId;
}

function haltDe(kind: StepHalt['kind'], subject: string): StepHalt {
  const motivo = {
    approval: `a tool "${subject}" exige aprovação humana neste perfil`,
    question: `o motor perguntou "${subject}" e não há humano na sessão`,
    timeout: `o passo excedeu o tempo máximo`,
  }[kind];
  return { kind, subject, reason: motivo };
}

export function createOpencodeStepExecutor(deps: OpencodeExecutorDeps): StepExecutor {
  const deciderFor = deps.deciderFor ?? ((): PermissionDecider => DECIDER_PADRAO);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subscribe = deps.subscribe;

  /** Garante a sessão do motor: reusa a da task (re-attach) ou cria uma. */
  async function garantirSessao(task: Task): Promise<string> {
    if (task.engineSessionId) return task.engineSessionId;
    const criada = await deps.client.session.create({ body: { title: `nio task ${task.id.slice(0, 8)}` } });
    const id = (criada as { data?: { id?: string } }).data?.id;
    if (!id) throw new Error('opencode não devolveu id de sessão.');
    return id;
  }

  return {
    async run(task: Task, step: TaskStep): Promise<StepOutcome> {
      const sessionId = await garantirSessao(task);
      const acc = createStepAccumulator();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let halt: StepHalt | undefined;

      try {
        halt = await consumir(deciderFor(task), sessionId, step, task, acc, ac);
      } finally {
        clearTimeout(timer);
        ac.abort();
        // Abortar SEMPRE: saída por halt, erro ou timeout não pode deixar o
        // motor trabalhando numa sessão que ninguém mais está lendo.
        await deps.client.session.abort({ path: { id: sessionId } }).catch(() => {});
      }

      const { text, toolCalls, tokensIn, tokensOut } = acc.result();
      return {
        output: { text },
        toolCalls,
        tokensIn,
        tokensOut,
        engineSessionId: sessionId,
        ...(halt ? { halt } : {}),
      };
    },
  };

  /** Laço de eventos. Devolve o `halt` que interrompeu, ou `undefined` no fim normal. */
  async function consumir(
    decider: PermissionDecider,
    sessionId: string,
    step: TaskStep,
    task: Task,
    acc: ReturnType<typeof createStepAccumulator>,
    ac: AbortController,
  ): Promise<StepHalt | undefined> {
    let promptEnviado = false;

    for await (const evt of subscribe(deps.client, ac.signal)) {
      // `null` = (re)conectou. Na primeira vez é o sinal de que dá pra mandar o
      // prompt sem perder evento; nas seguintes é reconexão — reenviar duplicaria o turno.
      if (evt === null) {
        if (promptEnviado) continue;
        promptEnviado = true;
        void deps.client.session
          .prompt({
            path: { id: sessionId },
            body: { model: deps.model, parts: [{ type: 'text', text: buildStepPrompt(task, step) }] },
          })
          .catch(() => {
            /* falha de envio aparece como turno que nunca fecha → timeout */
          });
        continue;
      }
      if (ac.signal.aborted) return haltDe('timeout', step.name);
      if (ehDeOutraSessao(evt, sessionId)) continue;

      const perm = permissionFrom(evt);
      if (perm) {
        const decisao: PermissionDecision = decider.decide(perm.subject, task.profile);
        if (decisao === 'park') return haltDe('approval', perm.subject);
        await responderPermissao(deps.client, perm, decisao === 'allow');
        continue;
      }

      const pergunta = questionFrom(evt);
      if (pergunta) {
        // Rejeita ANTES de sair: sem resposta o motor fica preso esperando.
        await rejeitarPergunta(deps.baseUrl, pergunta);
        return haltDe('question', pergunta.subject);
      }

      acc.apply(evt);
      if (isTurnEnd(evt)) return undefined;
    }
    // Stream acabou sem `idle`: o `subscribeEvents` só sai por abort.
    return haltDe('timeout', step.name);
  }
}
