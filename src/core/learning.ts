/**
 * Ports do aprendizado contínuo. Zero IO — os adapters implementam.
 *
 * A lição nasce de um par observável: uma tool falhou, a tentativa seguinte da MESMA
 * tool deu certo. O delta entre as duas, somado ao raciocínio que o modelo produziu no
 * meio, é o que vale guardar.
 */

/** Uma chamada de tool como a TUI a observa no stream de eventos. */
export interface ToolAttempt {
  /** Nome da tool (`nio_fabric_query`, `bash`, …). Filtro duro do recall. */
  tool: string;
  /** `completed` | `error` | … — vem do motor. */
  status: string;
  /** Entrada da chamada, quando disponível. */
  input?: Record<string, unknown>;
  /** Saída ou mensagem de erro. */
  output: string;
  /** Raciocínio que o modelo emitiu antes desta chamada, se houve. */
  reasoning?: string;
}

export interface Lesson {
  tool: string;
  profile?: string;
  /** O erro observado, normalizado. */
  sintoma: string;
  /** Chave de deduplicação: mesmo erro na mesma tool é UMA lição. */
  sintomaHash: string;
  /** O raciocínio que levou ao erro — o "aprender com o próprio reasoning". */
  causa?: string;
  /** O que funcionou depois. */
  solucao: string;
}

export interface ScoredLesson extends Lesson {
  score: number;
  usos: number;
  acertos: number;
}

export type LearningStatus = 'ok' | 'unconfigured' | 'unavailable' | 'failed';

export interface LearningResult<T> {
  status: LearningStatus;
  data?: T;
  error?: string;
}

/**
 * Persistência das lições. Contrato **nunca-lança**: aprendizado é acessório, e falha
 * aqui não pode derrubar o turno do usuário.
 */
export interface LessonStore {
  /** Grava ou soma ocorrência numa lição já conhecida (`tool` + `sintomaHash`). */
  save(lesson: Lesson, embedding: number[]): LearningResultPromise<number>;
  /**
   * Lições parecidas **da mesma tool**. O filtro por tool não é opcional: medimos que
   * similaridade sozinha não separa caso certo de caso parecido-porém-errado.
   */
  recall(tool: string, embedding: number[], topK: number): LearningResultPromise<ScoredLesson[]>;
  /** Marca que a lição foi usada, e se o turno seguinte deu certo. */
  registerOutcome(tool: string, sintomaHash: string, acertou: boolean): LearningResultPromise<void>;
}

type LearningResultPromise<T> = Promise<LearningResult<T>>;
