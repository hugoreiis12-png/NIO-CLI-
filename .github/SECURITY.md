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

### Pre-commit hook (automático)

Este repo usa `pre-commit` (Husky) pra bloquear padrões:

```bash
git hook: blocks files com patterns como:
  - AZURE_CLIENT_SECRET=
  - JWT_SECRET=
  - DATABASE_PASSWORD=
  - AWS_ACCESS_KEY_ID=
  - OPENAI_API_KEY=
```

Se o hook bloqueia seu commit:
```bash
# Verifique: qual arquivo tem o padrão?
git diff --cached --name-only | xargs grep -l SECRET

# Corrija o arquivo
# Rode git add novamente
git commit
```

### Reportar vulnerability

Se descobrir uma secret vaza, **avise imediatamente:**
1. Crie issue privada em GitHub (não publique)
2. Ou email: [maintainer-email-aqui]
3. **Não** comente em PRs/issues públicas

---

## Histórico de verificações

- **2026-09-28:** Auditoria completa, zero secrets encontrados ✅
  - Git history: limpeza confirmada
  - Pre-commit hook: configurado
  - .gitignore: reforçado