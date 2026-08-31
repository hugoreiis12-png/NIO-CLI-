# NIO-CLI — Guia para agentes

> **O que o projeto é:** um **orquestrador de ambientes de desenvolvimento**.
> O usuário escolhe um perfil, responde um wizard, e a CLI (com auxílio da IA via
> MCP) materializa o ambiente: toolchains, linguagens, frameworks, dotfiles,
> aliases e IDE. A entidade central é a **`Session`** (ambiente isolado, UUID,
> persistido no Postgres). Histórico das decisões: `docs/PROGRESSO.md`.
>
> Nasceu de um cliente do sistema NOS (tasks/sprints/ponto, backend Supabase) —
> todo esse domínio v1 já foi **removido**. Não escreva código novo contra ele.

## Runtime e stack

- **Node.js 20+** é o alvo. Bun pode rodar o projeto, mas **nada deve depender de
  APIs exclusivas do Bun** — sem `Bun.serve`, `bun:sqlite`, `Bun.sql`, `Bun.redis`,
  `Bun.file` como dependência de runtime, `Bun.$`. Use as APIs equivalentes de
  `node:*`.
- **TypeScript 5.5+**, ESM (`"type": "module"`).
- **Build:** `tsc` puro → `dist/`.

## Banco de dados

- **PostgreSQL dedicado** (database `nio_cli`). **Não** usar Supabase/PostgREST/RLS
  (era o backend v1).
- **Driver: `pg` + `@types/pg`.** Um `Pool` único vindo de
  `src/adapters/pg/client.ts`. Não instalar `postgres.js`, não usar `Bun.sql`.
- **Conexão via env `NIO_DATABASE_URL`** no formato
  `postgres://user:pass@host:5432/nio_cli`. O `pg.Pool` aceita a URL direto.
  Nenhum segredo hardcoded no código ou commitado.
- **Schema:** fonte da verdade em `db/schema.sql`; alterações incrementais em
  `db/migrations/NNNN_*.sql`. A tabela `sessions` é a fonte da verdade do domínio.
- **Senhas:** coluna `user_cli.password` guarda **hash argon2id** (PHC string). O
  hashing e a verificação ficam na camada de aplicação — o banco nunca vê texto
  puro.

## Arquitetura (hexagonal)

```
entrypoints:  src/cli.ts (nio)              src/gateway/index.ts (nio-gateway)
              src/mcp-server.ts (nio-cli)   src/mcp-server-lang.ts (nio-lang)
app/:         SessionManager · EnvironmentBuilder · DependencyWatcher · DockerManager
              · LanguageConfigurator · ai-client (launchAiClient)
core/:        types.ts (entidades + enums do schema)
              + ports por domínio, só interfaces, ZERO IO:
                repositories.ts (User/Session/AuthSession/LoginChallenge/DependencyEvent)
                environment.ts  (ProfileCatalog/RecipeCatalog/ToolchainGateway/IdeGateway + shapes)
                docker.ts       (DockerGateway)   messaging.ts (SmsSender)
                lang.ts         (KnowledgeStore/LanguageCatalog/ScaffoldGateway/…)
adapters/:    pg/ (Postgres, driver `pg`)  ide/ (vscode)  pkg/ (npm,pip,…)
              docker/  sms/ (HTTP genérico)  skills/ (cache do repo NIO-SKILLS)  lang/
gateway/:     index.ts (HTTP nativo) · edge-filter.ts · middleware/ · services/
profiles/:    catálogo dos 6 perfis (hardcoded no fonte)
```

- **Regra do hexágono:** nenhum arquivo de `core/` importa client de banco/IO
  (`pg`, `fs`, `child_process`); os adapters implementam os ports. Contrato dos
  ports de IO (`ToolchainGateway`/`IdeGateway`/`DockerGateway`/`SmsSender`):
  **nunca lançam** — falha vira um resultado `{ status, error? }`.
- **Perfis** (`fullstack`, `analyst`, `scientist`, `dba`, `qa`, `bi`) são fixos no
  código; novos perfis só entram alterando o fonte.
- **Enums do schema** (`profile`, `status`, `ide`, `dependency_type`, `purpose`,
  `channel`) viram **union types** em `core/types.ts` — fonte única, sem string solta.

## MCP

- `@modelcontextprotocol/sdk`. Tools de ambiente (`nio_session_*`, `nio_env_*`,
  `nio_profile_*`).
- **Toda tool MCP é prefixada `nio_`** — nome de tool é contrato público; não
  renomear sem intenção explícita.

## Convenções

- A `Session` de ambiente vive **só no Postgres** (`sessions`); 1 ativa por usuário
  por vez (invariante no `SessionRepository`). Não há cache local em `~/.nio/sessions/`.
- `~/.nio/` guarda só estado por-usuário: `session.json` (JWT do login), `config.env`
  (credenciais da equipe, chmod 600), `gateway.token`, `skills/`, `lang/`.
- **Esteira de onboarding** (`src/cli/flows/onboarding.ts`): `nio` sem args / `nio start`
  detecta o estágio (config → gateway → login → session → ready) e conduz, perguntando
  antes de cada passo. `login`/`register`/`config setup` encadeiam nela no fim.
- **Client de IA** (`nio ai`, `src/app/ai-client.ts`, ADR 0007): sobe o **Headroom**
  (proxy de compressão em container Docker, `headroom/docker-compose.yml`, **obrigatório**),
  aponta `provider.opencode.options.baseURL` pra ele, e entrega o terminal pro OpenCode.
  Com IDE (vscode/cursor), o `nio init` grava `.vscode/tasks.json` (`runOn: folderOpen`
  → `nio ai`) → o client sobe num terminal integrado da IDE, não em janela separada.
  Fase 2 (parkeada): trocar a TUI do OpenCode por uma interface NIO em OpenTUI.
- Estado por-usuário (não por-máquina) para dois colaboradores no mesmo host não
  colidirem.
- Mensagens de UI e erros em pt-BR (o público é o time interno).
