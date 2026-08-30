/**
 * Mensageria do 2º fator — port `SmsSender`. Sem broker/fila: o gateway chama
 * `send()` em processo no `/login`. Contrato de erro igual aos ports de IO: nunca
 * lança — falha vira `SmsResult` com `status`. Ver ADR 0006 / spec 0004.
 */

/**
 * `sent` = provedor aceitou; `skipped` = canal não configurado (`SMS_*` ausente,
 * gateway responde "2FA não configurado"); `failed` = recusa/erro (`error` diz).
 */
export interface SmsResult {
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
}

export interface SmsSender {
  /** Envia `text` pro número E.164 `to`. Nunca lança. */
  send(to: string, text: string): Promise<SmsResult>;
}
