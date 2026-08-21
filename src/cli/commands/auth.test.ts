import { test, expect } from "bun:test";
import { shouldSkipWhoamiSpinner, whoamiErrorMessage } from "./auth.js";
import type { Credentials } from "../../auth.js";

// ponytail: só as decisões puras extraídas do shell de prompts de `whoami` —
// o fluxo interativo em si é coberto pelo smoke test manual.

const CREDS_CACHED: Credentials = {
  pat: "nio_pat_x",
  user: { id: "1", email: "a@b.c", full_name: "A", username: "a" },
  fetched_at: "2026-01-01T00:00:00.000Z",
};

const CREDS_NO_USER: Credentials = { pat: "nio_pat_x" };

test("shouldSkipWhoamiSpinner: pula quando já tem user+fetched_at em cache e sem --refresh", () => {
  expect(shouldSkipWhoamiSpinner(CREDS_CACHED, undefined)).toBe(true);
});

test("shouldSkipWhoamiSpinner: não pula quando --refresh foi pedido, mesmo com cache", () => {
  expect(shouldSkipWhoamiSpinner(CREDS_CACHED, true)).toBe(false);
});

test("shouldSkipWhoamiSpinner: não pula quando não há cache (credencial legada só-pat)", () => {
  expect(shouldSkipWhoamiSpinner(CREDS_NO_USER, undefined)).toBe(false);
});

test("whoamiErrorMessage: 401 vira mensagem de sessão inválida", () => {
  expect(whoamiErrorMessage({ status: 401 })).toBe(
    "Sessão inválida. Rode `nio login <PAT>` novamente.",
  );
});

test("whoamiErrorMessage: 403 vira mensagem de sessão inválida", () => {
  expect(whoamiErrorMessage({ status: 403 })).toBe(
    "Sessão inválida. Rode `nio login <PAT>` novamente.",
  );
});

test("whoamiErrorMessage: outros erros mostram a mensagem original", () => {
  expect(whoamiErrorMessage(new Error("timeout"))).toBe(
    "Falha ao validar token: timeout",
  );
});
