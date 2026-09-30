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
  engineErrorFrom,
  eventSessionId,
  isTurnEnd,
  permissionFrom,
  questionFrom,
  type PedidoBloqueante,
  type StepAccumulated,
} from './step-events.js';

/** Teto por step. Generoso para trabalho real, finito para não travar o worker. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Teto de sessões novas por estouro de contexto NO MESMO STEP. Se o resumo de
 * recuperação — que é montado localmente e deliberadamente curto — ainda assim
 * não cabe, insistir é desperdício: o step falha com diagnóstico honesto em vez
 * de ficar criando sessão atrás de sessão.
 */
const MAX_CONTEXT_RETRIES = 2;
/** Teto de "continue" por resposta cortada. Sem isto um step preso em saída
 * gigante (ou um modelo que nunca converge) pediria continuação pra sempre. */
const MAX_CONTINUATION_RETRIES = 3;

/** Teto do resumo de recuperação — pequeno de propósito: se ELE também
 * estourasse, a recuperação falharia pelo mesmo motivo do erro original. */
const RECOVERY_DIGEST_MAX_CHARS = 3000;
/** Teto por step concluído no resumo — um output gigante não pode comer o resto. */
const PRIOR_STEP_MAX_CHARS = 300;
/** Teto do progresso parcial (texto já acumulado nesta sessão antes do reset). */
const PARTIAL_PROGRESS_MAX_CHARS = 800;

const PROMPT_CONTINUAR =
  'Sua resposta anterior foi cortada por exceder o teto de tokens de saída. ' +
  'Continue EXATAMENTE de onde parou, sem repetir o que já foi dito.';

/** Sem política injetada nada roda — o cofre nasce fechado. */
const DECIDER_PADRAO: PermissionDecider = { decide: () => 'park' };

/** Detecta se é uma chat task delegada (não planejada pelo worker). */
function isChatDelegated(task: Task): boolean {
  return task.kind === 'chat' && task.status === 'running';
}

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

function haltDe(kind: 'approval' | 'question' | 'timeout', subject: string): StepHalt {
  const motivo = {
    approval: `a tool "${subject}" exige aprovação humana neste perfil`,
    question: `o motor perguntou "${subject}" e não há humano na sessão`,
    timeout: `o passo excedeu o tempo máximo`,
  }[kind];
  return { kind, subject, reason: motivo };
}

/** `engine_error` carrega diagnóstico livre — não um template dos outros 3 kinds. */
function haltErroDoMotor(subject: string, reason: string): StepHalt {
  return { kind: 'engine_error', subject, reason };
}

/**
 * Resumo local (SEM chamar o motor — é ele que estourou) pra retomar numa
 * sessão nova. Curto de propósito e feito só de dados já em mãos (a trilha
 * persistida + o que já saiu deste step antes do reset).
 */
function digestoDeRecuperacao(
  task: Task,
  step: TaskStep,
  priorSteps: readonly TaskStep[],
  progressoParcial: string,
): string {
  const linhas: string[] = [
    'A sessão anterior estourou a janela de contexto e foi reiniciada.',
    `Objetivo da tarefa: ${task.goal}`,
  ];

  const concluidos = priorSteps.filter((s) => s.status === 'done');
  if (concluidos.length > 0) {
    linhas.push('', 'Passos já concluídos:');
    for (const s of concluidos) {
      const saida =
        typeof s.output?.text === 'string' ? s.output.text : JSON.stringify(s.output ?? {});
      linhas.push(`- [${s.stepNumber}] ${s.name}: ${saida.slice(0, PRIOR_STEP_MAX_CHARS)}`);
    }
  }

  linhas.push('', `Passo atual (${step.stepNumber}): ${step.name}`);
  linhas.push((step.input?.instruction as string | undefined) ?? step.name);

  if (progressoParcial.trim()) {
    linhas.push(
      '',
      'Progresso parcial deste passo antes do reset (pode estar incompleto):',
      progressoParcial.slice(0, PARTIAL_PROGRESS_MAX_CHARS),
    );
  }

  linhas.push('', 'Continue a partir daqui. Não repita o que já foi feito.');
  const texto = linhas.join('\n');
  return texto.length > RECOVERY_DIGEST_MAX_CHARS
    ? `${texto.slice(0, RECOVERY_DIGEST_MAX_CHARS)}…`
    : texto;
}

export function createOpencodeStepExecutor(deps: OpencodeExecutorDeps): StepExecutor {
  const deciderFor = deps.deciderFor ?? ((): PermissionDecider => DECIDER_PADRAO);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subscribe = deps.subscribe;

  /** Cria uma sessão nova no motor, ignorando a da task (usado na recuperação). */
  async function criarSessaoNova(task: Task, sufixoTitulo = ''): Promise<string> {
    const criada = await deps.client.session.create({
      body: { title: `nio task ${task.id.slice(0, 8)}${sufixoTitulo}` },
    });
    const id = (criada as { data?: { id?: string } }).data?.id;
    if (!id) throw new Error('opencode não devolveu id de sessão.');
    return id;
  }

  /** Garante a sessão do motor: reusa a da task (re-attach) ou cria uma. */
  async function garantirSessao(task: Task): Promise<string> {
    return task.engineSessionId ?? criarSessaoNova(task);
  }

  return {
    async run(task: Task, step: TaskStep, priorSteps: readonly TaskStep[]): Promise<StepOutcome> {
      let sessionIdAtual = await garantirSessao(task);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let halt: StepHalt | undefined;
      let resultado: StepAccumulated = { text: '', toolCalls: [], tokensIn: 0, tokensOut: 0 };

      try {
        const consumo = await consumir(
          deciderFor(task),
          sessionIdAtual,
          step,
          task,
          priorSteps,
          ac,
          (novoId) => {
            sessionIdAtual = novoId;
          },
        );
        halt = consumo.halt;
        resultado = consumo.resultado;
      } finally {
        clearTimeout(timer);
        ac.abort();
        // Abortar SEMPRE, na sessão FINAL (pode ter trocado por recuperação de
        // estouro): saída por halt, erro ou timeout não pode deixar o motor
        // trabalhando numa sessão que ninguém mais está lendo.
        await deps.client.session.abort({ path: { id: sessionIdAtual } }).catch(() => {});
      }

      return {
        output: { text: resultado.text },
        toolCalls: resultado.toolCalls,
        tokensIn: resultado.tokensIn,
        tokensOut: resultado.tokensOut,
        engineSessionId: sessionIdAtual,
        ...(halt ? { halt } : {}),
      };
    },
  };

  interface ResultadoConsumo {
    halt?: StepHalt;
    resultado: StepAccumulated;
  }

  /**
   * Laço de eventos de UM step — mas pode atravessar VÁRIAS sessões do motor por
   * dentro (estouro de contexto) e VÁRIOS envios (resposta cortada), tudo
   * invisível pro `run()`: o stream SSE é global (não por sessão), então trocar
   * de sessão é só trocar qual `sessionId` o filtro e o próximo envio usam — não
   * precisa reconectar.
   */
  async function consumir(
    decider: PermissionDecider,
    sessionIdInicial: string,
    step: TaskStep,
    task: Task,
    priorSteps: readonly TaskStep[],
    ac: AbortController,
    onSessionChange: (novoId: string) => void,
  ): Promise<ResultadoConsumo> {
    let sessionIdAtual = sessionIdInicial;
    let acc = createStepAccumulator();
    let promptEnviado = false;
    let tentativasContexto = 0;
    let tentativasContinuacao = 0;

    const enviar = (texto: string): void => {
      void deps.client.session
        .prompt({
          path: { id: sessionIdAtual },
          body: { model: deps.model, parts: [{ type: 'text', text: texto }] },
        })
        .catch(() => {
          /* falha de envio aparece como turno que nunca fecha → timeout */
        });
    };

    for await (const evt of subscribe(deps.client, ac.signal)) {
      // `null` = (re)conectou. Na primeira vez é o sinal de que dá pra mandar o
      // prompt sem perder evento; nas seguintes é reconexão — reenviar duplicaria o turno.
      if (evt === null) {
        if (promptEnviado) continue;
        promptEnviado = true;
        enviar(buildStepPrompt(task, step));
        continue;
      }
      if (ac.signal.aborted) return { halt: haltDe('timeout', step.name), resultado: acc.result() };
      if (ehDeOutraSessao(evt, sessionIdAtual)) continue;

      const perm = permissionFrom(evt);
      if (perm) {
        const decisao: PermissionDecision = decider.decide(perm.subject, task.profile);
        if (decisao === 'park') {
          return { halt: haltDe('approval', perm.subject), resultado: acc.result() };
        }
        await responderPermissao(deps.client, perm, decisao === 'allow');
        continue;
      }

      const pergunta = questionFrom(evt);
      if (pergunta) {
        // Rejeita ANTES de sair: sem resposta o motor fica preso esperando.
        await rejeitarPergunta(deps.baseUrl, pergunta);
        return { halt: haltDe('question', pergunta.subject), resultado: acc.result() };
      }

      const erro = engineErrorFrom(evt);
      if (erro) {
        if (erro.kind === 'context_overflow') {
          if (tentativasContexto >= MAX_CONTEXT_RETRIES) {
            return {
              halt: haltErroDoMotor(
                erro.name,
                `estouro de contexto — ${MAX_CONTEXT_RETRIES} tentativa(s) de recuperação esgotada(s)`,
              ),
              resultado: acc.result(),
            };
          }
          tentativasContexto++;
          const digest = digestoDeRecuperacao(task, step, priorSteps, acc.result().text);
          // Sessão NOVA, não reenvio: é o histórico acumulado que estourou —
          // insistir na mesma sessão bateria no mesmo teto imediatamente.
          sessionIdAtual = await criarSessaoNova(task, ' (cont.)');
          onSessionChange(sessionIdAtual);
          acc = createStepAccumulator(); // descarta o acumulado contaminado — o digest leva o resumo
          enviar(digest);
          continue;
        }
        if (erro.kind === 'output_length') {
          if (tentativasContinuacao >= MAX_CONTINUATION_RETRIES) {
            return {
              halt: haltErroDoMotor(
                erro.name,
                `resposta cortada repetidamente — ${MAX_CONTINUATION_RETRIES} tentativa(s) de continuação esgotada(s)`,
              ),
              resultado: acc.result(),
            };
          }
          tentativasContinuacao++;
          // MESMA sessão: o problema é o teto de UMA geração, não o histórico
          // acumulado. O acumulador não é resetado — a parte nova concatena
          // com a parcial de antes (ids de part diferentes, ver step-events.ts).
          enviar(PROMPT_CONTINUAR);
          continue;
        }
        // 'other': erro genuíno do motor, sem recuperação conhecida.
        return { halt: haltErroDoMotor(erro.name, erro.message), resultado: acc.result() };
      }

      acc.apply(evt);
      if (isTurnEnd(evt)) return { halt: undefined, resultado: acc.result() };
    }
    // Stream acabou sem `idle`: o `subscribeEvents` só sai por abort.
    return { halt: haltDe('timeout', step.name), resultado: acc.result() };
  }
}
