/**
 * `LanguageConfigurator` (app) — orquestra a pré-configuração de linguagens no
 * `nio init` (fullstack). Por linguagem: monta o plano, mostra o **preview
 * (dry-run)** e só executa o `apply` REAL **se o usuário confirmar**.
 *
 * GATE DE SEGURANÇA: nunca aplica sem passar pelo dry-run + confirm. A função de
 * confirmação é injetável (o wizard passa o prompt real; os testes passam um fake).
 *
 * Ver `docs/arch/ARQUITETURA-NIO-LANG.md` (fatia 4b).
 */
import type {
  LanguageId,
  LanguageCatalog,
  ScaffoldChoices,
  ScaffoldGateway,
  ScaffoldStep,
  ScaffoldStepResult,
} from '../core/lang.js';
import { createLanguageCatalog } from '../adapters/lang/language-catalog.js';
import { createScaffoldGateway } from '../adapters/lang/scaffold-gateway.js';

export interface LanguageSelection {
  language: LanguageId;
  choices: ScaffoldChoices;
}

export interface ConfigureResult {
  language: LanguageId;
  /** `false` = usuário não confirmou (nada foi instalado). */
  applied: boolean;
  steps: ScaffoldStepResult[];
}

/** Confirmação por linguagem — recebe o preview (dry-run) e decide. Injetável. */
export type ConfirmFn = (language: LanguageId, preview: string[]) => Promise<boolean>;

/** Descrição legível de um passo (pro preview e pro log). */
export function describeStep(step: ScaffoldStep): string {
  return step.kind === 'run' ? `${step.program} ${step.args.join(' ')}` : `escreve ${step.path}`;
}

export class LanguageConfigurator {
  private readonly catalog: LanguageCatalog;
  private readonly scaffold: ScaffoldGateway;

  constructor(deps: { catalog?: LanguageCatalog; scaffold?: ScaffoldGateway } = {}) {
    this.catalog = deps.catalog ?? createLanguageCatalog();
    this.scaffold = deps.scaffold ?? createScaffoldGateway();
  }

  /**
   * Por linguagem selecionada: plano → preview (dry-run) → `confirm` → apply real.
   * Linguagem não confirmada sai com `applied: false` e zero execução.
   */
  async configure(
    selections: LanguageSelection[],
    targetDir: string,
    confirm: ConfirmFn,
  ): Promise<ConfigureResult[]> {
    const results: ConfigureResult[] = [];
    for (const sel of selections) {
      const recipe = this.catalog.recipe(sel.language);
      const plan = this.scaffold.plan(recipe, sel.choices, targetDir);
      const preview = this.scaffold.apply(plan, { dryRun: true }).map((r) => describeStep(r.step));

      const ok = await confirm(sel.language, preview);
      if (!ok) {
        results.push({ language: sel.language, applied: false, steps: [] });
        continue;
      }

      const steps = this.scaffold.apply(plan, { dryRun: false });
      results.push({ language: sel.language, applied: true, steps });
    }
    return results;
  }
}
