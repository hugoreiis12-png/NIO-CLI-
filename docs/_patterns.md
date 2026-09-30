# Padrões de código

Este arquivo é um redirecionamento deliberado, não um acidente.

`@docs/_patterns.md` foi referenciado em `AGENTS.md` três vezes (a última em
2026-09-30) sem o arquivo existir — um import morto que toda sessão de agente
tentava resolver. A doutrina que o nome sugere (DRY, YAGNI, componentização)
**já vive** em [`docs/_rules/nio.md`](_rules/nio.md), seção "Boas práticas".

Se você chegou aqui esperando padrões de código: veja `docs/_rules/nio.md`.
Se você está editando `AGENTS.md` e pensando em referenciar `_patterns.md` de
novo: não precisa — a regra já está referenciada via `_rules/nio.md`.
