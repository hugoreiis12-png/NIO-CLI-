import { test, expect } from "bun:test";
import { resolveChosenClientIds, CLIENT_INSTALLERS, type ClientChoice } from "./clients-step.js";

// ponytail: decisões puras de mapeamento de clientes — a instalação em si
// (grava arquivo em disco) e o checkbox interativo não são exercitados aqui.

test("resolveChosenClientIds: opencode-global vira opencode", () => {
  const ids = resolveChosenClientIds(["opencode-global"]);
  expect(ids).toEqual(new Set(["opencode"]));
});

test("resolveChosenClientIds: lista vazia vira set vazio", () => {
  expect(resolveChosenClientIds([]).size).toBe(0);
});

test("CLIENT_INSTALLERS: cobre só a escolha do OpenCode", () => {
  const choices: ClientChoice[] = ["opencode-global"];
  expect(Object.keys(CLIENT_INSTALLERS).sort()).toEqual(choices.sort());
});

test("CLIENT_INSTALLERS: rótulo bate com o exibido no install", () => {
  expect(CLIENT_INSTALLERS["opencode-global"].label).toBe("OpenCode (global)");
});
