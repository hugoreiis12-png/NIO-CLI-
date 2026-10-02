/**
 * Colagem grande vira um token curto no campo de input (`[Pasted text #1 +120 lines]`),
 * como o Claude Code faz. O texto real fica num store à parte e só volta no envio.
 * Puro e testável: sem React, sem IO.
 */

/** A partir daqui o texto colado é compactado (o que for menor entra cru no input). */
export const PASTE_MIN_LINES = 6;
export const PASTE_MIN_CHARS = 500;
/**
 * Terminais entregam a colagem em vários chunks seguidos; dentro desta janela viram um só.
 * 100ms era curto: entre dois chunks o Ink re-renderiza a TUI inteira, e passando da janela
 * o chunk seguinte virava um token novo — a colagem aparecia picada em `[#1][#2][#3]`.
 */
export const PASTE_COALESCE_MS = 500;

const TOKEN_BODY = String.raw`\[Pasted text #(\d+)(?: \+\d+ lines| · \d+ chars)\]`;
const TOKEN_ANYWHERE = new RegExp(TOKEN_BODY, 'g');
const TOKEN_AT_END = new RegExp(`${TOKEN_BODY}$`);

export function countLines(content: string): number {
  return content.replace(/\n$/, '').split('\n').length;
}

export function isLargePaste(text: string): boolean {
  return text.length >= PASTE_MIN_CHARS || countLines(text) >= PASTE_MIN_LINES;
}

/** Uma linha só (texto corrido enorme) mostra caracteres; o resto mostra linhas. */
export function pasteToken(id: number, content: string): string {
  const lines = countLines(content);
  return lines > 1
    ? `[Pasted text #${id} +${lines} lines]`
    : `[Pasted text #${id} · ${content.length} chars]`;
}

export interface PasteStore {
  /** Guarda o conteúdo e devolve o id novo. */
  add(content: string): number;
  /** Acrescenta ao conteúdo de `id` (chunk seguinte da mesma colagem). */
  append(id: number, extra: string): void;
  has(id: number): boolean;
  /** Token atual de `id` (muda quando o conteúdo cresce). */
  tokenOf(id: number): string;
  /** Entrega os conteúdos e zera o store (a numeração recomeça no próximo prompt). */
  take(): ReadonlyMap<number, string>;
}

export function createPasteStore(): PasteStore {
  let contents = new Map<number, string>();
  let nextId = 1;
  return {
    add(content) {
      const id = nextId++;
      contents.set(id, content);
      return id;
    },
    append(id, extra) {
      contents.set(id, (contents.get(id) ?? '') + extra);
    },
    has: (id) => contents.has(id),
    tokenOf: (id) => pasteToken(id, contents.get(id) ?? ''),
    take() {
      const taken = contents;
      contents = new Map();
      nextId = 1;
      return taken;
    },
  };
}

/**
 * Troca cada token pelo conteúdo. Id desconhecido (token editado/colado de outro lugar)
 * fica como está. Replacer em função: o texto colado pode conter `$&`/`$1`, que uma
 * string de substituição interpretaria.
 */
export function expandPastes(text: string, contents: ReadonlyMap<number, string>): string {
  if (contents.size === 0) return text;
  return text.replace(TOKEN_ANYWHERE, (token, id: string) => contents.get(Number(id)) ?? token);
}

/** Tamanho do token que termina exatamente em `before` (texto até o cursor), ou 0. */
export function tokenLengthAtEnd(before: string): number {
  return TOKEN_AT_END.exec(before)?.[0].length ?? 0;
}

export interface LastPaste {
  id: number;
  at: number;
}

export interface PasteEdit {
  value: string;
  cursor: number;
  last: LastPaste;
}

/**
 * Decide se `text` (um chunk de entrada) é colagem a compactar. `null` = não é; o caller
 * insere o texto normalmente. O chunk que continua uma colagem recente é checado ANTES do
 * limite de tamanho: o último pedaço de uma colagem grande costuma ser pequeno.
 */
export function applyPaste(
  store: PasteStore,
  value: string,
  cursor: number,
  text: string,
  last: LastPaste | null,
  now: number,
): PasteEdit | null {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);

  if (last && now - last.at < PASTE_COALESCE_MS && store.has(last.id)) {
    const oldToken = store.tokenOf(last.id);
    if (before.endsWith(oldToken)) {
      store.append(last.id, text);
      const token = store.tokenOf(last.id);
      const head = before.slice(0, before.length - oldToken.length) + token;
      return { value: head + after, cursor: head.length, last: { id: last.id, at: now } };
    }
  }

  if (!isLargePaste(text)) return null;
  const id = store.add(text);
  const head = before + store.tokenOf(id);
  return { value: head + after, cursor: head.length, last: { id, at: now } };
}
