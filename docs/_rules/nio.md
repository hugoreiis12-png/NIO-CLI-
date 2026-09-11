# Harness de código — nio

<!-- Gerado por `nio sync`. Não edite à mão — rode `nio sync`. -->

## general

> Camada **raiz** — valem pra qualquer área/stack. Front-end, back-end e mobile herdam estas e só adicionam o que é específico delas.

### Tamanho e forma

- Arquivo com no máximo **300 linhas** — acima disso, quebre por responsabilidade.
- Função com no máximo **30 linhas** e um único nível de abstração.
- Comentário com no máximo **1 linha**; se precisa de parágrafo, o código não está claro o bastante.
- Prefira **early-return** a aninhar `if`/`else`.

### Boas práticas

- **Componentize/modularize sempre**: bloco repetido ou com responsabilidade própria vira componente/função/módulo.
- **DRY** — antes de escrever uma função/util, **verifique se já existe** algo global equivalente; reuse em vez de duplicar.
- **YAGNI** — implemente só o que o requisito atual pede; sem abstração/config "pro futuro".
- Uma função faz **uma coisa**; sem efeito colateral escondido.
- Composição em vez de herança quando der.

### Nomes e clareza

- Código (variáveis, funções, tipos, arquivos) em **inglês**; texto de UI no idioma do produto.
- Nomes descritivos, sem abreviação obscura (`user`, não `usr`).
- Sem número/string mágico — extraia pra constante nomeada.

### Higiene

- Sem código morto, import não usado ou log de debug commitado.
- Tipagem explícita na borda — sem `any`/tipo escapado.
- Um arquivo, uma responsabilidade principal.

### Erros e testes

- **Trate ou propague** o erro — nunca engula silenciosamente.
- Comportamento novo ou bug corrigido merece **teste**; teste o **contrato**, não a implementação.

## back-end

> Regras gerais de back-end — valem pra **qualquer** stack da área (django, …).
> As regras de stack só adicionam o que é específico delas.

### Organização

- **Verticalização por domínio/feature**: cada feature agrupa seus próprios models, services, schemas e rotas — não separe por camada técnica global.
- Regra de negócio no **service layer** — nunca na view/controller nem espalhada no model.
- Validação de entrada na **borda** (schema/serializer), uma vez — não repetida por toda parte.

### Dados e erros

- Nada de regra de negócio dentro de migration.
- Erros explícitos e tipados; nunca engula exceção (`except: pass`).
- Sem query dentro de loop — resolva em lote (evite N+1).
- Listagem sempre **paginada** por padrão; nunca retorne coleção ilimitada.

### Efeitos e consistência

- Escrita multi-passo é **transacional** (tudo ou nada).
- Efeito colateral externo (email, pagamento, fila) é **idempotente** — retry não duplica.

### Segurança

- Segredo só via variável de ambiente; nunca no código nem versionado.
- Toda entrada externa é não-confiável até validada.

## front-end

> Regras gerais de front-end — valem pra **qualquer** stack da área (lovable, ssr, …).
> As regras de stack só adicionam o que é específico delas.

### Estrutura

- **Tipagens e schemas sempre fora do arquivo do componente** (ex.: `types/`, `schemas/`); o componente só importa.
- Um componente por arquivo; o arquivo é só apresentação — lógica vai pra hooks/services.
- Estado de **servidor** (data-fetching) separado do estado de **UI** — nunca no mesmo store.

### Componentes

- Sem regra de negócio nem fetch dentro de componente de apresentação — extraia pra um hook.
- Props tipadas explicitamente; nada de `any`.
- Lista sempre com `key` estável (id da entidade), nunca o índice.

### Qualidade de UI

- Acessibilidade mínima: todo input com label; todo botão com texto ou `aria-label`.
- Sem valor de estilo mágico — use os tokens/sistema de design.
- Todo estado assíncrono tem **loading, erro e vazio** na UI — nunca só o happy path.
- Formulário: input controlado + validação por **schema**, não checagem ad-hoc espalhada.
