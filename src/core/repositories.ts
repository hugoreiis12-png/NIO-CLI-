/**
 * Ports de persistência do domínio v2 — interfaces que os adapters de banco
 * (`adapters/pg/*-repository.ts`) implementam. Sem import de driver aqui: é o
 * contrato, não a implementação.
 *
 * Contrato de erro: métodos de leitura por chave retornam `null` quando não acham
 * (não lançam); falha de infra (conexão, SQL inválido) propaga como throw.
 */
import type { UserCli } from './session.js';

/** Dados para criar um usuário. `password` é texto puro — o adapter hasheia (argon2id). */
export interface NewUserInput {
  name: string;
  password: string;
}

export interface UserRepository {
  /** Busca um usuário pelo nome único. `null` se não existir. */
  findByName(name: string): Promise<UserCli | null>;

  /** Cria um usuário (senha hasheada com argon2id antes de persistir). */
  create(input: NewUserInput): Promise<UserCli>;

  /**
   * Confere as credenciais. Retorna o usuário (sem hash) se a senha bate;
   * `null` se o nome não existe OU a senha não confere — sem distinguir os dois
   * casos para o chamador (evita enumeração de usuários).
   */
  verifyCredentials(name: string, password: string): Promise<UserCli | null>;

  /** Grava (ou limpa, com `null`) o token de sessão do usuário. */
  setSessionToken(userId: number, token: string | null): Promise<void>;

  /** Marca `timestamp_last_session = now()`. */
  touchLastSession(userId: number): Promise<void>;
}
