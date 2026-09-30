/**
 * Liga a TUI ao registro de turnos (`app/turn-task.ts`) sem engordar o `App`,
 * que já tem 553 linhas (BACKLOG-TECNICO § 10.3).
 *
 * Contrato com o chamador: **nada aqui lança e nada aqui espera**. Os métodos
 * disparam e voltam na hora — registrar um turno não pode adiar a renderização
 * nem quebrar o chat se o Postgres estiver fora. Mesmo tratamento que a TUI já
 * dá ao aprendizado de lições.
 */
import { useCallback, useRef } from 'react';
import type { Profile } from '../core/types.js';
import type { ToolCallTrace } from '../core/tasks.js';
import { beginTurn, endTurn, abortTurn, type TurnRef } from '../app/turn-task.js';
import { loadSession } from '../lib/auth/cli-session-store.js';
import { tlog } from './debug.js';

export interface TurnTaskApi {
  /** Abre o registro do turno. Dispara e volta — não aguarda o banco. */
  begin: (texto: string) => void;
  /** Fecha com o que o motor produziu. */
  end: (outcome: { text: string; toolCalls?: ToolCallTrace[]; tokensIn?: number; tokensOut?: number }) => void;
  /** Encerra em falha (interrupção do usuário, erro do motor). */
  abort: (motivo: string) => void;
}

export interface UseTurnTaskOpts {
  /** Sessão de ambiente ativa — dá proveniência e perfil. `null` = sem sessão. */
  session: { id: string; profile: string } | null;
}

/**
 * `null` fora de sessão: sem perfil não há política de permissão, e inventar um
 * default gravaria trilha sob regra que não é a do usuário.
 */
export function useTurnTask({ session }: UseTurnTaskOpts): TurnTaskApi {
  const ref = useRef<TurnRef | null>(null);

  const begin = useCallback(
    (texto: string): void => {
      if (!session) return;
      ref.current = null;
      void (async () => {
        try {
          const stored = await loadSession();
          if (!stored) return;
          ref.current = await beginTurn({
            userId: stored.userId,
            sessionId: session.id,
            profile: session.profile as Profile,
            text: texto,
          });
        } catch (err) {
          tlog('registro do turno falhou', (err as Error).message);
        }
      })();
    },
    [session],
  );

  const end = useCallback((outcome: Parameters<TurnTaskApi['end']>[0]): void => {
    const atual = ref.current;
    ref.current = null;
    if (atual) void endTurn(atual, outcome);
  }, []);

  const abort = useCallback((motivo: string): void => {
    const atual = ref.current;
    ref.current = null;
    if (atual) void abortTurn(atual, motivo);
  }, []);

  return { begin, end, abort };
}
