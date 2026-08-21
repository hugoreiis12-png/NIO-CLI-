---
id: "0003"
title: Gateway de Auth dedicado, independente da Fase 4 (pausado)
status: paused
created: 2026-07-27
---

# Gateway de Auth dedicado, independente da Fase 4 (pausado)

## Contexto
`docs/ROADMAP.md` não previa um mecanismo de auth próprio — a leitura
inicial era que autenticação continuaria pelo Supabase até o sistema
interno NIO (Fase 4) assumir o domínio por completo. O rebrand (ADR
implícito na spec `docs/specs/rebrand/0005`) forçou a questão mais cedo: a
CLI não podia mais depender do domínio antigo (`nos.noclaf.com.br`) pra
instruir o usuário a gerar um PAT.

## Decisão
Em vez de esperar a Fase 4, construir um **Gateway de Auth dedicado**,
neste mesmo repo, em duas camadas:
1. **Edge Filter** (`workers/edge-filter/`) — Cloudflare Worker, registra
   traceability (ip, user-agent, trace id) e repassa pro Gateway.
2. **Gateway core** (`src/gateway/`) — módulo Bun, implementa **OAuth 2.0
   Authorization Code Flow com PKCE** (RFC 7636): `/authorize` (usuário
   confirma no navegador) e `/token` (CLI troca code+verifier por sessão).

Decisões de escopo dentro dessa direção, nesta ordem cronológica de
refinamento (2026-07-27):
- Sem integração com Supabase — a Gateway não verifica senha nem delega
  pra ninguém nesta etapa.
- Sem permissão/perfil (RBAC) implementada — removida do código em vez de
  deixada como placeholder morto.
- Identidade é **self-asserted** (usuário digita o email, sem prova de
  posse) — deliberadamente incompleto como *autenticação*, mas o
  *protocolo* (PKCE, code de uso único, `redirect_uri` restrito a loopback)
  é implementado corretamente desde já.

**Status: pausado em 2026-07-27**, antes de qualquer deploy, por uma
pergunta que expôs a lacuna: o Gateway só existia local (`localhost:8787`)
e um processo em `localhost` não é alcançável a partir de outra máquina —
inviabiliza uso multi-colaborador sem antes decidir hospedagem. Retomar
exige escolher entre hospedar o módulo Bun como está num host persistente
(VPS/Fly/Railway) ou portar o Gateway também pro Cloudflare (o que por sua
vez exige trocar sessão em memória por KV/Durable Objects, já que
requisições diferentes podem cair em isolates diferentes na borda).

## Consequências
**Positivas:**
- O protocolo (PKCE, sessão por-usuário, traceability) já está implementado
  e testado ponta a ponta (`docs/specs/auth/0002-cli-native-login.md`) —
  retomar não é recomeçar do zero, é resolver hospedagem + plugar
  verificação de identidade real.
- Pausar aqui não deixou nada acoplado: confirmado que nenhum outro módulo
  importa `src/gateway/`, `TOKEN_EXCHANGE_URL` segue no Supabase como
  sempre esteve, e `src/gateway/**` já estava fora do build publicado
  (`tsconfig.json`). Reverter ou continuar são ambos baratos a partir daqui.

**Negativas / trade-offs:**
- Enquanto pausado, a CLI continua dependendo do fluxo de PAT via Supabase
  (spec `0001-identity-cache.md`) — o problema original (link quebrado pro
  domínio antigo) já foi resolvido separadamente (`brand.webUrl` vazio,
  spec `0005`), então não há regressão visível ao usuário, só a ambição
  maior de auth nativa que fica represada.
- O `/authorize` aceitar qualquer email sem prova de posse é uma lacuna de
  segurança real, não cosmética — se alguém decidir "destravar" isto sem
  ler a spec, pode achar que é auth funcional quando não é. Documentado com
  destaque na spec e neste ADR justamente pra evitar essa leitura errada.

## Alternativas consideradas
- **Esperar a Fase 4 (sistema interno) resolver auth:** era o plano
  original; descartado por trocar velocidade agora por uma dependência de
  um sistema maior, mais lento de construir, sem necessidade — nada na
  Fase 4 exige que auth espere por ela.
- **Manter grant de senha via Supabase** (primeira iteração desta mesma
  decisão, revertida no mesmo dia): descartado a pedido do dono do produto
  — "desvincular qualquer tipo de integração com Supabase no momento,
  porque não se faz necessário".
- **Deploy imediato em qualquer host disponível**, sem parar pra decidir
  hospedagem com calma: descartado — publicar um Worker apontando pra um
  Gateway ainda-não-hospedado (ou hospedado ad-hoc) seria dívida técnica
  imediata; melhor pausar de forma limpa e decidir uma vez.

## Referências
- `docs/specs/auth/0002-cli-native-login.md` — spec completa, status `paused`.
- `src/gateway/`, `workers/edge-filter/` — código, intacto e não plugado.
- `docs/PLANO-EXECUCAO.md` — seção "Estado agora", nota de pausa.
