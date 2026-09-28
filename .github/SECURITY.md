# Política de Segurança — NIO-CLI

## Secrets Management

**NUNCA commite segredos** no repositório. Inclui:
- API keys, tokens, passwords
- Database credentials
- Certificates, private keys
- OAuth secrets, JWT signing keys

### Padrão correto

```bash
# ❌ ERRADO
AZURE_CLIENT_SECRET=abc123def456
DATABASE_PASSWORD=mypassword

# ✅ CORRETO
AZURE_CLIENT_SECRET=$VAULT_SECRET   # lê de variável de ambiente
DATABASE_PASSWORD=${DB_PASS}         # default de env
```

### Onde guardar secrets

| Tipo | Onde | Acesso |
|------|------|--------|
| **Desenvolvimento local** | `~/.nio/config.env` (chmod 600) | Só seu usuário |
| **CI/CD (GitHub)** | GitHub Secrets | Configurado em repo settings |
| **Produção (Portainer)** | Stack environment variables | Acesso restrito, audit trail |

### Checklist antes de commit

- [ ] `git diff --cached` → nenhuma linha com `SECRET=`, `PASSWORD=`, `KEY=`
- [ ] `git log -1 -p` → revisa último commit antes de push
- [ ] Valores em `.env*` são template (example files)

### Se acidentalmente commitou um secret

**Ação rápida (se ainda não foi pushed):**
```bash
git reset --soft HEAD~1  # Desfaz commit, mantém staged
git restore --staged path/to/file  # Remove da staging
# Edita o arquivo, remove secret
git add path/to/file
git commit -m "fix: remove secret"
```

**Se já foi pushed:**
1. Gere um novo secret (ex: novo API key no painel)
2. Rode BFG/filter-branch pra remover histórico (custo: 1 force-push)
3. Notifique admins, rotacione a credencial

### Os dois gates

| Gate | Onde | Cobertura | Pode ser burlado? |
|------|------|-----------|-------------------|
| **CI — job `secrets`** | `.github/workflows/ci.yml` | Todo PR, push em `main` e **todo release** (publish/image chamam o CI) | ❌ Não |
| Hook `pre-commit` | `.husky/pre-commit` | Só o diff staged, só na sua máquina | Sim (`--no-verify`) |

**O CI é o que garante.** O hook é feedback rápido e é *opt-in* — o git não
olha `.husky/` sozinho. Para ativar na sua máquina (uma vez por clone):

```bash
git config core.hooksPath .husky
```

### Rodar o scan localmente

```bash
bash scripts/scan-secrets.sh
```

O que ele bloqueia:
- Segredo **nomeado** com valor literal (`AZURE_CLIENT_SECRET`, `JWT_SECRET`,
  `NIO_GATEWAY_TOKEN`, `AWS_*`, `OPENAI_API_KEY`, `OTP_HMAC_SECRET`, `NIO_PEPPER`).
- **Hex de 64+ chars** — o formato de `openssl rand -hex 32`. SHA-1 de commit (40)
  e digest `sha256:` de imagem ficam de fora: são públicos.

Não conta como literal: `${VAR}`, `process.env.X` e placeholder com `<…>`.

### Falso positivo: o escape

Valor que *parece* segredo mas é comprovadamente efêmero (ex.: o `JWT_SECRET` do
runner de CI) leva `nio-allow-secret` **na mesma linha**, com o porquê:

```yaml
JWT_SECRET: ci-only-4f9c2ka7...  # nio-allow-secret: efêmero do runner
```

O escape é auditável de propósito — `grep -rn nio-allow-secret` lista todas as
exceções vigentes. Se você precisa de um e não consegue justificar em uma linha,
provavelmente não é falso positivo.

### Reportar vulnerability

Se descobrir uma secret vaza, **avise imediatamente:**
1. Crie issue privada em GitHub (não publique)
2. Ou email: [maintainer-email-aqui]
3. **Não** comente em PRs/issues públicas

---

## Histórico de verificações

- **2026-09-28 — 2ª passada (a que valeu).** A 1ª passada tinha dois buracos:
  - **Achado:** `NIO_GATEWAY_TOKEN` literal (64 hex) em 7 pontos de
    `docs/arch/KONG-GATEWAY-USO.md` e `docker/external-app.example.yml`.
    **Testado contra a produção: o token já estava rotacionado** (o Edge Filter
    devolveu `403 token ... inválido`), então não houve incidente — mas o valor
    foi trocado por placeholder e o formato deixou de ser ensinado como exemplo.
    Sem reescrita de histórico: segredo morto não justifica force-push.
  - **Achado:** o `.husky/pre-commit` da 1ª passada **nunca rodou** —
    `core.hooksPath` não estava setado e o repo não usa Husky. Um hook em
    `.husky/` é inerte por padrão. Daí o gate ter virado job de CI.
  - Scan validado nos dois sentidos: passa limpo **e** bloqueia um token plantado.

- **2026-09-28 — 1ª passada.** Varredura por `SECRET=`/`PASSWORD=` no histórico:
  nada encontrado. Não cobria token hex solto em exemplo de doc — o buraco acima.
  `.gitignore` reforçado com `.env.*`.