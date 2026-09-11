# Arquitetura do Cliente de IA (OpenCode + Qwen vLLM local)

> Documento de referência — estado atual (2026-09-10). Duas camadas, bem
> distintas:
>
> 1. **Superfície**: o NIO é autocontido com um **único cliente de IA ativo** —
>    OpenCode, como runtime (`serve`/TUI/SDK). A superfície multi-cliente foi
>    decidida e revertida (ADR 0004); o desenho futuro vive em
>    `ARQUITETURA-CLIENTES-MULTI-FUTURO.md`. Cowork/Claude Desktop fica como
>    cliente de **chat** via MCP (prompts servidos ao vivo), **não** como alvo de
>    provisionamento.
> 2. **Motor**: a CLI **não** roteia mais pelo provider `opencode` (Zen) — ele
>    fica no default `big-pickle` e fora da competência da CLI. A CLI semeia um
>    **provider dedicado OpenAI-compatível** (`nio-local`, Qwen vLLM local) que
>    fala **direto** no backend, e é esse o `model` gravado no `opencode.json`.
>    O OpenCode vira só o runtime.
>
> Headroom (proxy de compressão) está **dormente** (ADR 0010): desativado e não
> obrigatório; `ensureHeadroomAndWire` só garante o `opencode.json` pronto e
> nunca bloqueia.

## Resumo executivo

- **Um cliente só.** `ALL_TARGETS = [opencodeTarget]` (`src/lib/clients/targets.ts`)
  desde 27 jul 2026: o OpenCode é o único alvo de provisionamento. `KNOWN_CLIENTS =
  ['cowork', 'opencode']` (`src/lib/skills/skills.ts`). Claude Code e Codex saíram
  de vez do código ativo (config/instaladores/engines removidos).
- **Motor dedicado.** `installOpencodeGlobal` semeia `model: NIO_OPERATOR_MODEL` na
  raiz e um provider `nio-local` (`@ai-sdk/openai-compatible`) apontando pra
  `NIO_AI_BASE_URL`. Overrides: `NIO_AI_PROVIDER`, `NIO_AI_MODEL`, `NIO_AI_BASE_URL`,
  `NIO_AI_CONTEXT`, `NIO_AI_OUTPUT`.
- **Delegação local.** Os motores de raciocínio/implementação da CLI — `nio exec`,
  `nio plan`, `nio validate-plan` e as tools MCP `delegate_exec`/`plan`/
  `validate_plan` — chamam o **Qwen vLLM local** via `qwenComplete()` (fetch direto
  `/v1/chat/completions`, engine `qwen-3.0/vllm`), sem binário externo, sem
  assinatura e sem API key.
- **Acesso do operador.** Interativo = TUI NIO (Ink) sobre `opencode serve`
  headless; headless = `opencode run --model NIO_OPERATOR_MODEL "<prompt>"` (pro
  `nio docker …`). Com IDE, roda num terminal integrado dela (`.vscode/tasks.json`).

## Config do motor (`src/lib/clients/client-configs.ts`)

| Constante | Default | Efeito |
|---|---|---|
| `NIO_AI_PROVIDER` | `nio-local` | Nome do provider dedicado no `opencode.json` |
| `NIO_AI_MODEL_ID` | `RedHatAI/Qwen3.8-27B-INT4` | Id do modelo **exatamente como o backend serve** (sem prefixo) |
| `NIO_OPERATOR_MODEL` | `<provider>/<id>` | Ref completa gravada no `model` + usada no `opencode run` |
| `NIO_AI_BASE_URL` | `http://192.168.0.140:8001/v1` | BaseURL OpenAI-compatível do backend (vLLM interno) |
| `NIO_AI_CONTEXT` | `65536` | Janela de contexto declarada no provider (`models.<id>.limit`) |
| `NIO_AI_OUTPUT` | `2048` | Teto de tokens de saída |
| `NIO_AI_MAX_INPUT` | `32000` | Hard cap de input por prompt (recusa antes do fetch; `0` desativa) |

O provedor `opencode` (Zen) **não é tocado** — fica no default `big-pickle`, sem
competência sobre o motor da CLI. O backend vLLM é infra da casa (host/porta
defaults acima; `NIO_AI_BASE_URL` pra apontar outro).

## O que existe hoje (confirmado no código)

| Peça | Estado |
|---|---|
| `ALL_TARGETS = [opencodeTarget]` (`targets.ts`) | ✅ Só OpenCode é alvo de provisionamento (decisão 27 jul 2026) |
| `KNOWN_CLIENTS = ['cowork', 'opencode']` (`skills.ts`) | ✅ Filtro `clients:` do frontmatter reconhece `opencode` e `cowork` |
| `ensureCoreClients` (`flows/clients.ts`) | ✅ Só checa/instala OpenCode |
| `installOpencodeGlobal` (`client-configs.ts`) | ✅ Escreve `~/.config/opencode/opencode.json`: provider `nio-local`, `model: NIO_OPERATOR_MODEL`, MCP `nio`, bem como defaults de `permission`/`compaction`/`watcher` se ausentes |
| `detectConfiguredTargets` (`targets.ts`) | ✅ Auto-detect: provisiona se o `opencode.json` tem o MCP `nio` |
| `opencodeTarget.mapDocs` | ✅ Reaproveita o layout cru do pacote de skills (`skills/<id>/SKILL.md`), sem tradução |
| Cowork/Claude Desktop | ✅ Continua como **chat** via MCP prompts (ao vivo); config gravado no `claude_desktop_config.json` (`installCoworkGlobal`/`installVSCodeRepo`) |
| Motores de delegação (`exec/plan/validate-plan`) | ✅ `qwenComplete()` direto no vLLM local — codex/claude removidos |
| Headroom | ✅ **Dormente** (ADR 0010) — `ensureHeadroomAndWire` nunca bloqueia |
| TUI NIO (Ink) | ✅ Interface própria sobre `opencode serve` — ver `ARQUITETURA-CLIENTE-TUI.md` |

## Diagrama do fluxo do operador

```mermaid
flowchart TD
    A["nio ai (interativo) / nio docker … (headless)"] --> B["ensureHeadroomAndWire\ngarante o opencode.json: provider nio-local + model + MCPs"]
    B --> C{"opencode no PATH?"}
    C -- não --> X["aviso: npm i -g opencode-ai"]
    C -- sim --> D["opencode serve --model NIO_OPERATOR_MODEL\n(headless: opencode run --model … \"<prompt>\")"]
    D --> E["TUI NIO (Ink) fala com o serve\nchat streamado + paleta /"]
    E --> F["MCP nio + MCPs do perfil\nexpostos na sessão"]
```

## Decisões e limitações reais (não maquiar)

- **O `model` é lock soft.** `opencode.json` define o default — o usuário pode
  trocar via `/models` ou flag. Não há escrita em diretório de sistema (managed
  settings) — é o mesmo trade-off de sempre, aceito.
- **Id fora do catálogo Zen exige declaração.** O OpenCode só aceita/orça um modelo
  fora do catálogo Zen se ele estiver **declarado** no provider (`models.<id>.limit`) —
  sem isso um id de vLLM vira "Model not found". Por isso `NIO_AI_CONTEXT` é semeado.
  `NIO_AI_CONTEXT=0` desativa a declaração (usa o catálogo do provider).
- **Janela apertada.** 64K de contexto num backend local com schemas de MCP pesados —
  por isso `compaction` automática (`auto: true`, `prune: true`, reserva de tokens) é
  semeada quando ausente.
- **O Backend é pré-requisito.** `qwenComplete`, o provider `nio-local` e o
  `opencode run --model` precisam do vLLM no ar em `NIO_AI_BASE_URL`. Não há fallback
  pra API externa — se o backend cair, `nio exec`/`nio plan`/`nio ai` falham com erro
  claro (HTTP status).

## Referências

- `src/lib/clients/targets.ts` — `ALL_TARGETS = [opencodeTarget]`, `detectConfiguredTargets`.
- `src/lib/clients/client-configs.ts` — `NIO_AI_*`, `installOpencodeGlobal`, planos da config (permission/compaction/watcher), seção Cowork/Desktop.
- `src/lib/skills/skills.ts` — `KNOWN_CLIENTS = ['cowork', 'opencode']`.
- `src/lib/exec/qwen-client.ts` + `src/lib/exec/exec-delegate.ts` — motor de delegação (Qwen vLLM local, `qwenComplete`, `parseFileBlocks`).
- `src/app/ai-client.ts` — `ensureHeadroomAndWire` + `launchAiClient` (headless `opencode run`).
- `src/tui/opencode.ts` — client da TUI sobre `opencode serve`.
- `docs/arch/ARQUITETURA-CLIENTE-TUI.md` — a interface NIO (Ink).
- `docs/arch/ARQUITETURA-CLIENTES-MULTI-FUTURO.md` — o desenho multi-cliente parkeado.