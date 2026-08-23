import { test, expect } from "bun:test";
import { parseStoredSession } from "./session-store.js";

test("parseStoredSession: aceita um shape válido", () => {
  const raw = { userId: 1, name: "hugo", token: "tok", loggedInAt: "2026-08-23T00:00:00.000Z" };
  expect(parseStoredSession(raw)).toEqual(raw);
});

test("parseStoredSession: null para valor não-objeto", () => {
  expect(parseStoredSession(null)).toBeNull();
  expect(parseStoredSession("string")).toBeNull();
  expect(parseStoredSession(42)).toBeNull();
});

test("parseStoredSession: null quando falta um campo", () => {
  expect(parseStoredSession({ userId: 1, name: "hugo", token: "tok" })).toBeNull();
});

test("parseStoredSession: null quando o tipo de um campo está errado", () => {
  expect(
    parseStoredSession({ userId: "1", name: "hugo", token: "tok", loggedInAt: "2026-08-23" }),
  ).toBeNull();
});

test("parseStoredSession: null para o shape antigo do v1 (pat/user/fetched_at)", () => {
  expect(parseStoredSession({ pat: "nio_x", fetched_at: "2026-08-23" })).toBeNull();
});
