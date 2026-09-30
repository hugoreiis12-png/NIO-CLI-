/**
 * Traduções puras do resultado de um step/veredito para estado de task. Sem IO,
 * para o worker não precisar de banco pra ser testado nas decisões que importam.
 */
import type { StepHalt } from '../core/agent.js';
import type { TaskStatus } from '../core/types.js';

export interface TransicaoTask {
  status: TaskStatus;
  /** Vai pra `tasks.error`. `null` = a task parou por decisão, não por falha. */
  error: string | null;
  /** `true` = o step fica `pending` (retomável); `false` = marca `failed`. */
  mantemStepPendente: boolean;
}

/**
 * Step que parou antes do fim. **Nunca** vira `done` — gravar sucesso aqui é o
 * erro que faria a task seguir para o próximo step com trabalho pela metade.
 *
 * `approval` e `question` mantêm o step pendente de propósito: a task dorme e,
 * quando o humano liberar, o worker retoma DESTE step, não do começo.
 */
export function haltParaTransicao(halt: StepHalt): TransicaoTask {
  if (halt.kind === 'timeout') {
    return {
      status: 'failed',
      error: `Passo "${halt.subject}" excedeu o tempo máximo.`,
      mantemStepPendente: false,
    };
  }
  return { status: 'waiting_approval', error: null, mantemStepPendente: true };
}

/**
 * Veredito incompleto sem próximos passos = orçamento esgotado. O Validator
 * corta `nextSteps` no teto (fatia 1.7) e não tem estado próprio pra "acabou o
 * orçamento" — é aqui que isso vira falha em vez de loop infinito.
 */
export function incompletoSemSaida(nextSteps: readonly unknown[], motivo: string): TransicaoTask {
  return {
    status: 'failed',
    error: `Teto de passos atingido sem concluir: ${motivo}`,
    mantemStepPendente: false,
  };
}

/** Mensagem de erro de um `unknown` vindo de catch, sem vazar objeto estranho. */
export function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
