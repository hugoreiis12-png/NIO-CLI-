import { test, expect } from "bun:test";
import {
  resolveSelectedProject,
  resolveRepositoryChoice,
  buildBaseConfig,
} from "./project-step.js";

// ponytail: só as decisões puras do wizard de projeto/repo — os prompts em si
// (select/input) são cobertos pelo smoke test manual, não aqui.

const PROJECTS = [
  { id: "p1", name: "Projeto Um" },
  { id: "p2", name: "Projeto Dois" },
];

test("resolveSelectedProject: acha o projeto pelo id na lista", () => {
  expect(resolveSelectedProject("p2", PROJECTS)).toEqual({ id: "p2", name: "Projeto Dois" });
});

test("resolveSelectedProject: cai num objeto sintético quando o id não está na lista (ex.: colado manualmente)", () => {
  expect(resolveSelectedProject("uuid-manual", PROJECTS)).toEqual({
    id: "uuid-manual",
    name: "uuid-manual",
  });
});

test("resolveRepositoryChoice: __none__ vira null", () => {
  expect(resolveRepositoryChoice("__none__")).toBeNull();
});

test("resolveRepositoryChoice: qualquer outro valor passa direto como repository_id", () => {
  expect(resolveRepositoryChoice("repo-123")).toBe("repo-123");
});

test("buildBaseConfig: sem repositório, config só tem project_id", () => {
  expect(buildBaseConfig("p1", null)).toEqual({ project_id: "p1" });
});

test("buildBaseConfig: com repositório, inclui repository_id", () => {
  expect(buildBaseConfig("p1", "r1")).toEqual({ project_id: "p1", repository_id: "r1" });
});
