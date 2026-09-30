/**
 * Ports do executor agêntico. Zero IO — `app/` e `adapters/agent/` implementam.
 *
 * A divisão de motor não é acidental: `Planner` e `Validator` são chamadas
 * single-shot sem tool (vão direto no vLLM via `qwenComplete`), enquanto o
 * `StepExecutor` precisa de tools e permissões, logo passa pelo `opencode serve`.
 * Subir o runtime agêntico para planejar seria pagar o custo sem usar nada dele.
 */
import type { Profile } from './types.js';
import type { Task, TaskStep, ToolCallTrace } from './tasks.js';

/** Um step como o Planner o descreve — ainda não persistido. */
export interface PlannedStep {
  name: string;
  /** O que o step deve fazer, em linguagem natural — vira o prompt do executor. */
  instruction: string;
  /** Tool que provavelmente resolve. Dica, não contrato: o motor decide. */
  toolHint?: string;
}

/**
 * Gera o plano inicial a partir do `goal`.
 *
 * **Nunca recebe conteúdo recuperado** (documento, resultado de busca): planejar
 * sobre texto de terceiro é o vetor de prompt injection mais direto deste
 * sistema. Conteúdo externo só entra nos steps de execução.
 */
export interface Planner {
  plan(task: Task): Promise<PlannedStep[]>;
}

/**
 * Motivo de um step ter parado sem concluir. O worker traduz isto em estado de
 * task: `approval` → `waiting_approval`; `timeout` → falha com retry possível.
 */
export interface StepHalt {
  kind: 'approval' | 'question' | 'timeout';
  /** Tool ou pergunta que exigiu o humano. */
  subject: string;
  reason: string;
}

/** O que um step produziu — vira `task_steps.output` + as métricas. */
export interface StepOutcome {
  output: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
  tokensIn: number;
  tokensOut: number;
  /** Sessão do motor, para o worker re-attachar depois de um restart. */
  engineSessionId?: string;
  /** Delta a fundir no `workingSet` da task (short-term memory, F2). */
  workingSet?: Record<string, unknown>;
  /**
   * Preenchido quando o step parou por precisar de um humano ou estourar o
   * tempo. Ausente = o step rodou até o fim. O worker **não** pode tratar um
   * step com `halt` como concluído.
   */
  halt?: StepHalt;
}

/**
 * O que fazer com um pedido de permissão do motor, num contexto sem humano na
 * frente. `park` é o default deliberado: negar em silêncio faz o modelo seguir
 * sem a ferramenta e produzir resultado pela metade, e permitir em silêncio é
 * execução não supervisionada.
 */
export type PermissionDecision = 'allow' | 'deny' | 'park';

/** Consultado a cada `permission.asked`. Implementação real: `ApprovalPolicy`. */
export interface PermissionDecider {
  decide(toolName: string, profile: Profile): PermissionDecision;
}

/**
 * Executa UM step. Um step = uma chamada `session.prompt` no motor.
 *
 * Pode rodar duas vezes para o mesmo step: o modelo é checkpoint-and-resume, não
 * replay determinístico (crash entre executar e gravar re-executa). Implementação
 * com efeito colateral externo precisa ser idempotente.
 */
export interface StepExecutor {
  run(task: Task, step: TaskStep): Promise<StepOutcome>;
}

/** Veredito do Validator: fechou, ou falta o quê. */
export type Verdict =
  | { complete: true; result: string }
  | { complete: false; reason: string; nextSteps: PlannedStep[] };

/** Julga se o goal foi atingido olhando a trilha de steps concluídos. */
export interface Validator {
  judge(task: Task, steps: readonly TaskStep[]): Promise<Verdict>;
}

/**
 * `auto` = o worker executa sozinho; `needs_approval` = a task dorme em
 * `waiting_approval` até `nio task approve`.
 */
export type ApprovalDecision = 'auto' | 'needs_approval';

/**
 * Decide se uma tool pode rodar sem humano. Puro — a allowlist vem do perfil
 * (`ProfileDefinition.autoApprove`), que é obrigatória em todos os 6.
 */
export interface ApprovalPolicy {
  check(toolName: string, profile: Profile): ApprovalDecision;
}
