# Publicando no npm

Este projeto é publicado como pacote scoped `@nio-cli/cli` no npm público. O CI cuida do publish automático em push de tag `v*`.

## Setup inicial (uma vez)

### 1. Organização `nio-cli` no npm — ✅ já criada

Confirmado em 2026-07-27 (`npmjs.com/settings/nio-cli/packages`, 0 pacotes
publicados ainda). O scope real é `@nio-cli` — **não** `@nio` (o npm sempre
normaliza o nome da org pra minúsculo; "Nio-cli" virou `nio-cli`). O
`package.json` já reflete isso (`"name": "@nio-cli/cli"`).

### 2. Gerar token de automação no npm

Token tipo **Automation** (não expira, ignora 2FA — apropriado pra CI):

```
https://www.npmjs.com/settings/<seu-usuário>/tokens
→ Generate New Token → tipo Automation
```

Guarde o valor — só é mostrado uma vez.

### 3. Adicionar o token como secret no GitHub

No repo `hugoreiis12-png/NIO-CLI`:

```
Settings → Secrets and variables → Actions → New repository secret
Name: NPM_TOKEN
Value: <token gerado no passo 2>
```

### 4. Primeiro publish manual (recomendado)

Antes de confiar no CI, faça um publish controlado pra confirmar que tudo tá certo:

```bash
npm login                                  # auth interativo
npm publish --dry-run --access public      # confere o que vai ser enviado
npm publish --access public                # publish real
```

O `--dry-run` mostra a lista de arquivos. Deve ser só:
- `dist/` (todo o build)
- `package.json`
- `README.md`

## Publishes seguintes (via tag)

O workflow `.github/workflows/publish.yml` dispara em push de tag `v*`. Fluxo:

```bash
npm version patch -m "release v%s"   # bump + commit + tag (use minor/major se for o caso)
git push --follow-tags               # envia commit + tag → CI publica
```

`npm version` cria a tag local no formato `vX.Y.Z`. O `--follow-tags` garante que ela vai junto.

## Trigger manual

Se precisar republicar sem novo commit (ex: falha de rede no primeiro try):

```
Actions → Publish to npm → Run workflow
```

## Provenance

O workflow usa `--provenance`, que assina o pacote via sigstore. Aparece como badge "Provenance" na página do pacote no npm. Não custa nada e dá um sinal de origem verificável.

## Versionamento

`v0.1.0` enquanto não tem testes automatizados nem garantia de estabilidade. Subir pra `1.0.0` quando:

- Houver testes cobrindo os fluxos principais
- A schema do `nio.json` estiver congelada
- A lista de tools MCP for considerada estável (renomes/remoções viram breaking change)
