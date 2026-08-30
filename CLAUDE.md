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
entrypoints:  src/cli.ts (nio)            src/mcp-server.ts (nio-cli, tools de ambiente)
app:          SessionManager · EnvironmentBuilder · DependencyWatcher
core/:        types.ts (entidades)  +  ports.ts (interfaces: SessionRepository,
              UserRepository, EnvironmentGateway, ToolchainGateway, ProfileCatalog,
              SessionCache, IdeGateway, ...)
adapters/:    pg/ (Postgres)  fs/ (cache local)  pkg/ (npm,pip,...)  ide/ (vscode)
profiles/:    catálogo de perfis (hardcoded no código fonte)
```

- **Regra do hexágono:** `core/ports.ts` não importa nenhum client de banco/IO;
  os adapters implementam os ports. Entidades em `core/types.ts` não têm vínculo
  com backend.
- **Perfis** (`fullstack`, `analyst`, `scientist`, `dba`, `qa`, `bi`) são fixos no
  código; novos perfis só entram alterando o fonte.
- **Enums do schema** (`profile`, `status`, `ide`, `dependency_type`) viram **union
  types** em `core/types.ts` — fonte única, sem string solta.

## MCP

- `@modelcontextprotocol/sdk`. Tools de ambiente (`nio_session_*`, `nio_env_*`,
  `nio_profile_*`).
- **Toda tool MCP é prefixada `nio_`** — nome de tool é contrato público; não
  renomear sem intenção explícita.

## Convenções

- Cache local de sessões em `~/.nio/sessions/` (TTL de 10 dias); depois disso vive
  só no Postgres e pode ser reativada. 1 sessão ativa por usuário por vez.
- Estado por-usuário (não por-máquina) para dois colaboradores no mesmo host não
  colidirem.
- Mensagens de UI e erros em pt-BR (o público é o time interno).
