/**
 * Conteúdo da documentação completa (`nio docs`) — fonte única, renderizada no
 * terminal (`terminal.ts`) e como página (`html.ts`). Prosa curta; as tabelas de
 * comando/tool são geradas ao vivo em `dynamic.ts`.
 */

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface DocSection {
  id: string;
  title: string;
  blurb?: string;
  blocks: Block[];
}

export const TAGLINE =
  'Orquestrador de ambientes de desenvolvimento — perfil + wizard, e a CLI (com IA via MCP) materializa toolchains, linguagens, frameworks, dotfiles e IDE.';

export const SECTIONS: DocSection[] = [
  {
    id: 'o-que-e',
    title: 'O que é',
    blocks: [
      {
        kind: 'p',
        text: 'A NIO-CLI monta ambientes de desenvolvimento reproduzíveis. Você escolhe um perfil (fullstack, analyst, scientist, dba, qa, bi), responde um wizard, e a CLI garante os toolchains, resolve os MCPs, escreve dotfiles/aliases e abre a IDE.',
      },
      {
        kind: 'p',
        text: 'A entidade central é a Sessão: um ambiente isolado com UUID, persistido no Postgres. Uma sessão ativa por usuário por vez; sessões antigas ficam no banco e podem ser reativadas.',
      },
      {
        kind: 'p',
        text: 'O Postgres é a fonte da verdade. A CLI e o gateway só falam com o banco que VOCÊ configurar — não há default silencioso nem banco embutido no pacote.',
      },
    ],
  },
  {
    id: 'como-funciona',
    title: 'Como funciona',
    blocks: [
      {
        kind: 'code',
        text: [
          'você → nio (CLI) ──► nio-gateway ──► Postgres     login: senha + JWT (2º fator opcional)',
          '          │',
          '          ├──► SessionManager / EnvironmentBuilder    materializa toolchains, MCPs, dotfiles',
          '          │',
          '          └──► opencode.json ──► OpenCode (operador de IA)',
          '                                  └── MCP nio (tools nio_*) ──► SessionManager ──► Postgres',
        ].join('\n'),
      },
      {
        kind: 'list',
        items: [
          'Autenticação — `nio register` / `nio login`. O nio-gateway (serviço HTTP loopback) verifica a senha (argon2id), dispara o 2º fator se ativo, e devolve um JWT salvo em ~/.nio/session.json.',
          'Sessão — `nio init`. O wizard pergunta perfil + recipe; o EnvironmentBuilder garante os toolchains, resolve os MCPs e grava o config materializado na linha `sessions` do Postgres.',
          'Handoff — a CLI registra o MCP `nio` no opencode.json e entrega o terminal pro OpenCode (modelo opencode/big-pickle). O agente passa a ter as tools nio_*.',
        ],
      },
      {
        kind: 'p',
        text: 'O nio-gateway só é necessário pros comandos de auth. Todo o resto (init, sessions, tools MCP) fala com o Postgres direto usando o JWT local.',
      },
    ],
  },
  {
    id: 'instalacao',
    title: 'Instalação e pré-requisitos',
    blocks: [
      { kind: 'code', text: 'npm i -g @nio-cli/cli' },
      {
        kind: 'p',
        text: 'Precisa de Node.js 20.12+. Ficam no PATH: nio (CLI), nio-gateway (auth), nio-cli e nio-lang (servidores MCP).',
      },
      {
        kind: 'table',
        head: ['Requisito', 'Pra quê'],
        rows: [
          ['PostgreSQL alcançável', 'fonte da verdade — schema de db/schema.sql aplicado uma vez'],
          ['JWT_SECRET (segredo do time)', 'assinar/validar as sessões — mesmo valor em toda máquina'],
          ['OpenCode', 'operador de IA — o `nio init` oferece instalar'],
          ['provedor de SMS (opcional)', '2º fator — SMS_ENDPOINT_URL + SMS_AUTH_HEADER + SMS_BODY_TEMPLATE'],
        ],
      },
    ],
  },
  {
    id: 'config',
    title: 'Configuração',
    blurb: 'Você não precisa exportar nada no shell.',
    blocks: [
      {
        kind: 'p',
        text: '`nio config setup` — wizard que pede o `NIO_DATABASE_URL` (o time te passa) e o `JWT_SECRET`, testa a conexão e grava em ~/.nio/config.env (chmod 600). `nio init`/`register`/`login` disparam esse wizard sozinhos se a config faltar; se estiver errada, param dizendo o quê.',
      },
      {
        kind: 'code',
        text: [
          'nio config setup     wizard (cola os valores, testa, salva)',
          'nio config check     completa? banco responde?  (--json pra CI)',
          'nio config path      ~/.nio/config.env',
        ].join('\n'),
      },
      {
        kind: 'p',
        text: 'Precedência ao carregar: env do shell > $NIO_ENV_FILE > ./.env > ~/.nio/config.env.',
      },
      {
        kind: 'table',
        head: ['Variável', 'Lida por'],
        rows: [
          ['NIO_DATABASE_URL / NIO_DATABASE_SSL', 'tudo que toca o banco'],
          ['JWT_SECRET / JWT_EXPIRES_IN (sem prefixo)', 'nio-gateway + nio-cli'],
          ['SMS_* (sem prefixo)', 'nio-gateway'],
          ['NIO_GATEWAY_HOST (default 127.0.0.1)', 'nio-gateway — 0.0.0.0 p/ Kong em container'],
          ['NIO_GATEWAY_URL (default http://127.0.0.1:3000)', 'a CLI acha o nio-gateway. Kong na frente? aponta pra :8000'],
        ],
      },
    ],
  },
  {
    id: 'primeiros-passos',
    title: 'Primeiros passos',
    blocks: [
      {
        kind: 'code',
        text: [
          'nio config setup       # cola NIO_DATABASE_URL + JWT_SECRET, testa, salva',
          'nio-gateway &          # gateway de auth no ar',
          'nio register           # cria seu usuário na base compartilhada',
          'nio login              # salva o JWT em ~/.nio/session.json',
          'nio security enable-2fa # (opcional) 2º fator',
          'nio init               # monta o ambiente da sessão',
        ].join('\n'),
      },
      { kind: 'p', text: 'A qualquer momento, `nio debug` mostra o que está ok e o que falta.' },
    ],
  },
  {
    id: 'arquitetura',
    title: 'Como é construída',
    blurb: 'Hexagonal — o núcleo não conhece IO; os adapters implementam os contratos.',
    blocks: [
      {
        kind: 'code',
        text: [
          'entrypoints:  src/cli.ts (nio)         src/gateway/index.ts (nio-gateway)',
          '              src/mcp-server.ts (nio-cli)  src/mcp-server-lang.ts (nio-lang)',
          'app:          SessionManager · EnvironmentBuilder · DependencyWatcher · DockerManager',
          'core/:        entidades  +  ports (interfaces, sem IO nenhum)',
          'adapters/:    pg/ (Postgres)  ide/  pkg/ (npm,pip,…)  docker/  sms/  skills/',
          'profiles/:    catálogo dos 6 perfis (fixos no fonte)',
        ].join('\n'),
      },
      {
        kind: 'list',
        items: [
          'Runtime: Node 20.12+. Bun roda em dev, mas nada depende de API exclusiva do Bun.',
          'Build: tsc puro → dist/. Sem bundler.',
          'Banco: driver pg + um Pool único. Sem Supabase, sem PostgREST, sem Bun.sql.',
          'Gateway: http.createServer nativo, loopback, atrás do Kong OSS (opcional, rate-limiting). JWT HS256, jti = id da auth_session. Trilha de auth em stderr — nunca a senha nem o OTP em texto puro.',
          'Contrato "nunca lança" nos ports de IO: falha vira { status, error? }.',
        ],
      },
    ],
  },
  {
    id: '2fa',
    title: '2º fator (SMS)',
    blocks: [
      {
        kind: 'p',
        text: 'Opt-in por conta. Com auth_2 ativo, o `nio login` pede um código de 6 dígitos por SMS; se o SMS não chega, vale um dos 10 códigos de backup (mostrados uma vez no enable-2fa).',
      },
      {
        kind: 'code',
        text: [
          'nio security enable-2fa               cadastra o celular, confirma via SMS, mostra os backups',
          'nio security status                   ativo? número (mascarado)? quantos backups restam?',
          'nio security disable-2fa',
          'nio security regenerate-backup-codes',
        ].join('\n'),
      },
      {
        kind: 'p',
        text: 'O gateway gera/valida o OTP em processo (sem Twilio, sem broker), guarda só o HMAC do código (TTL 5 min, 3 tentativas, uso único) e manda o SMS por um adapter HTTP genérico. Sem SMS_ENDPOINT_URL, o login com auth_2 responde 503 — o de 1 fator segue normal.',
      },
    ],
  },
  {
    id: 'debug',
    title: 'Debug da própria CLI',
    blocks: [
      {
        kind: 'p',
        text: '`nio debug` roda uma bateria de checagens read-only e mostra ✓ / ⚠ / ✗ com uma dica acionável em cada: nio.json no diretório, login local, conexão Postgres, sessão ativa, OpenCode no PATH, cache de skills.',
      },
      {
        kind: 'p',
        text: '`NIO_DEBUG=1` liga log verboso em stderr (`[nio:debug]`): quais `.env` carregaram, config resolvida (URL mascarada, `SELECT 1`), cada request pro gateway (URL + status), e **stack trace completo** nos erros em vez de só a mensagem.',
      },
      { kind: 'code', text: 'NIO_DEBUG=1 nio login' },
      {
        kind: 'list',
        items: [
          '"NIO_DATABASE_URL não definida" → ponha em ~/.nio/config.env (o bin publicado não lê o .env de dev via bun).',
          '"Não consegui falar com o nio-gateway" → suba `nio-gateway &`.',
          '"Não autenticado" → `nio register` (1ª vez) e `nio login`.',
          '"2FA não configurado no servidor" (503) → faltam as SMS_* no ambiente do nio-gateway.',
          'Tools não aparecem no cliente → reinicie o cliente depois do `nio init`; cheque com /mcp.',
        ],
      },
      {
        kind: 'p',
        text: 'Logs do gateway saem em stderr como JSON estruturado (event: gateway_request / auth_attempt) — nunca com senha ou OTP.',
      },
    ],
  },
];
