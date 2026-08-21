import { test, expect } from "bun:test";
import { resolveProvisionTargets } from "./provision-step.js";
import { opencodeTarget } from "../../../lib/targets.js";
import type { ClientChoice } from "./clients-step.js";

// ponytail: só a decisão pura de "quais targets provisionar" — o provision()
// em si (grava arquivos) não é exercitado aqui.

test("resolveProvisionTargets: escolha opencode-global aponta pro opencodeTarget", () => {
  const targets = resolveProvisionTargets(["opencode-global"]);
  expect(targets).toEqual(new Set([opencodeTarget]));
});

test("resolveProvisionTargets: lista vazia também cai no opencodeTarget (único cliente ativo)", () => {
  const choices: ClientChoice[] = [];
  expect(resolveProvisionTargets(choices)).toEqual(new Set([opencodeTarget]));
});
