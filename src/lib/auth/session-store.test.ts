import { test, expect } from "bun:test";
import { parseStoredSession } from "./session-store.js";

const VALID = {
  userId: 1,
  name: "hugo",
  token: "eyJhbGciOiJIUzI1NiJ9.tok.sig",
  sessionId: "a1b2c3d4-0000-4000-8000-000000000001",
  loggedInAt: "2026-08-23T00:00:00.000Z",
  expiresAt: "2026-08-23T12:00:00.000Z",
};

test("parseStoredSession: aceita um shape válido", () => {
  expect(parseStoredSession(VALID)).toEqual(VALID);
});

test("parseStoredSession: null para valor não-objeto", () => {
  expect(parseStoredSession(null)).toBeNull();
  expect(parseStoredSession("string")).toBeNull();
  expect(parseStoredSession(42)).toBeNull();
});

test("parseStoredSession: null quando falta um campo", () => {
  const { expiresAt, ...semExpiresAt } = VALID;
  expect(parseStoredSession(semExpiresAt)).toBeNull();
});

test("parseStoredSession: null quando o tipo de um campo está errado", () => {
  expect(parseStoredSession({ ...VALID, userId: "1" })).toBeNull();
});

test("parseStoredSession: null para o shape antigo do v1 (pat/user/fetched_at)", () => {
  expect(parseStoredSession({ pat: "nio_x", fetched_at: "2026-08-23" })).toBeNull();
});

test("parseStoredSession: null para o shape v2 anterior (sem sessionId/expiresAt — token_session)", () => {
  const { sessionId, expiresAt, ...semJwt } = VALID;
  expect(parseStoredSession(semJwt)).toBeNull();
});
