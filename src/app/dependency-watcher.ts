/**
 * DependencyWatcher (fatia 5 — Sprint 3). Orquestra o ciclo por sessão ativa:
 * scan dos manifests → diff de instalados → registra evento novo (idempotente) →
 * auto-install OPT-IN. Um `tick` é um ciclo; `watch` roda ticks a cada
 * `intervalMs` até o `AbortSignal` disparar.
 *
 * Decisão de escopo (dono do projeto, 2026-08-26): detecção + registro são sempre
 * ligados (observabilidade segura); o auto-install real é opt-in (`autoInstall`),
 * divergindo do doc §3.4 ("sem pedir permissão") de propósito. As dependências de
 * IO são injetáveis (seams) pra manter o app layer testável sem disco/subprocesso.
 */
import type { Session, DependencyEvent, DependencyType } from '../core/session.js';
import type { DependencyEventRepository } from '../core/repositories.js';
import type { ScannedDependency } from '../lib/dependency-scan.js';
import type { InstallOutcome } from '../lib/dependencies.js';
import { scanProject } from '../lib/dependency-scan.js';
import { isInstalled, missingDependencies } from '../lib/dependency-installed.js';
import { installProjectDeps } from '../lib/dependency-install-project.js';

/** Seams de IO (default = implementações reais); injetadas nos testes. */
export interface WatcherDeps {
  repo: DependencyEventRepository;
  autoInstall?: boolean;
  intervalMs?: number;
  scan?: (projectPath: string) => ScannedDependency[];
  installedCheck?: (dep: ScannedDependency, projectPath: string) => boolean;
  install?: (type: DependencyType, projectPath: string) => InstallOutcome;
  /** Linha de log por evento (default: silencioso — o CLI passa o seu). */
  log?: (line: string) => void;
}

/** Resultado de um ciclo de scan. */
export interface TickResult {
  scanned: number;
  missing: ScannedDependency[];
  /** Eventos criados AGORA (deps detectadas pela primeira vez nesta sessão). */
  recorded: DependencyEvent[];
  /** Ecossistemas cujo instalador rodou com sucesso neste tick (só com autoInstall). */
  installed: DependencyType[];
}

const DEFAULT_INTERVAL_MS = 10_000;

export class DependencyWatcher {
  private readonly repo: DependencyEventRepository;
  private readonly autoInstall: boolean;
  private readonly intervalMs: number;
  private readonly scan: (p: string) => ScannedDependency[];
  private readonly installedCheck: (dep: ScannedDependency, p: string) => boolean;
  private readonly install: (t: DependencyType, p: string) => InstallOutcome;
  private readonly log: (line: string) => void;

  constructor(deps: WatcherDeps) {
    this.repo = deps.repo;
    this.autoInstall = deps.autoInstall ?? false;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.scan = deps.scan ?? scanProject;
    this.installedCheck = deps.installedCheck ?? isInstalled;
    this.install = deps.install ?? installProjectDeps;
    this.log = deps.log ?? (() => {});
  }

  /** Um ciclo: scan → diff → registra novos → (auto)instala o que falta. */
  async tick(session: Session): Promise<TickResult> {
    const scanned = this.scan(session.projectPath);
    const missing = missingDependencies(scanned, session.projectPath, this.installedCheck);

    // Registra cada faltante (idempotente); guarda o evento pra poder marcar instalado.
    const tracked: { dep: ScannedDependency; event: DependencyEvent }[] = [];
    const recorded: DependencyEvent[] = [];
    for (const dep of missing) {
      const { event, created } = await this.repo.recordIfNew({
        sessionId: session.id,
        filePath: dep.filePath,
        dependencyName: dep.name,
        dependencyType: dep.type,
      });
      tracked.push({ dep, event });
      if (created) {
        recorded.push(event);
        this.log(`detectado: ${dep.name} (${dep.type}) em ${dep.filePath}`);
      }
    }

    const installed: DependencyType[] = [];
    if (this.autoInstall && missing.length > 0) {
      for (const type of distinctTypes(missing)) {
        this.log(`instalando dependências ${type}...`);
        const outcome = this.install(type, session.projectPath);
        if (!outcome.ok) {
          this.log(`falha ao instalar ${type}: ${outcome.error ?? `código ${outcome.code}`}`);
          continue;
        }
        installed.push(type);
        // Marca instalado só o que de fato passou a existir no disco.
        for (const { dep, event } of tracked) {
          if (dep.type === type && this.installedCheck(dep, session.projectPath)) {
            await this.repo.markInstalled(event.id);
          }
        }
      }
    }

    return { scanned: scanned.length, missing, recorded, installed };
  }

  /** Loop de ticks a cada `intervalMs` até o `signal` abortar. Chama `onTick` por ciclo. */
  async watch(
    session: Session,
    signal: AbortSignal,
    onTick?: (result: TickResult) => void,
  ): Promise<void> {
    while (!signal.aborted) {
      const result = await this.tick(session);
      onTick?.(result);
      const interrupted = await sleep(this.intervalMs, signal);
      if (interrupted) break;
    }
  }
}

/** Tipos de ecossistema distintos presentes num conjunto de deps. */
function distinctTypes(deps: ScannedDependency[]): DependencyType[] {
  return [...new Set(deps.map((d) => d.type))];
}

/** Espera `ms` ou até o signal abortar. Resolve `true` se foi interrompido. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(true);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
