# DevTools Workspace

Plataforma de ferramentas para desenvolvedores, com processamento 100% local no navegador:

| Módulo | O que faz |
| --- | --- |
| **JSON Organizer** | Editor com validação (linha/coluna do erro), formatar, minificar, ordenar chaves, importar/exportar, busca por chave/valor, JSONPath com filtros, e quatro visualizações: Tree (virtualizada, sob demanda), Graph (d3, zoom/pan), Statistics e Charts (barras, linhas, pizza, dispersão e histograma). |
| **Cron Manager** | Biblioteca com 24 modelos, CRON por linguagem natural (pede esclarecimento quando há ambiguidade) e construtor visual. Suporta 5 campos (Unix), 6 campos (com segundos) e Quartz (6–7 campos, `?`, `L`, `W`, `#`), com explicação animada campo a campo e próximas execuções no fuso escolhido, incluindo horário de verão. |
| **XML Visualizer** | Parser próprio com validação de boa formação, visualizador neon (abertura e fechamento na mesma cor, guias por nível, hover destaca o par), árvore estrutural, busca, formatar e minificar. |
| **Database Diagram** | Lexer + parser de descida recursiva (AST) para `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX`. Identifica PK, FK, UNIQUE, NOT NULL, IDENTITY, DEFAULT e CHECK, com cardinalidade pé de galinha e layout automático em camadas. Exporta SVG, PNG, DBML, Mermaid e JSON. |
| **SQL Forge** | Dois campos: o T-SQL que você cola (procedures, views, functions, triggers, scripts) e o mesmo código no padrão do Pedro, com rio de palavras-chave, vírgula à esquerda, listas entre parênteses alinhadas, "=" em coluna, `CREATE OR ALTER`, `dbo.`, `#tNOME` e os SETs obrigatórios. Um relatório mostra o checklist do padrão, as alterações feitas e as extensões usadas onde o padrão não define regra. Com vários JOINs, todos os `ON` ficam na mesma coluna e os `=` de todos os JOINs ficam alinhados. |
| **Model Generator** | Recebe `CREATE TABLE` (incluindo temporárias, `DECLARE @t TABLE` e `ALTER TABLE ADD PRIMARY KEY/FOREIGN KEY`), o `SELECT` final de procedures ou um JSON de exemplo. Gera classes em C# (POCO, EF Core, record), Java (POJO, Lombok, JPA, record), Kotlin (data class, JPA), Python (dataclass, Pydantic v2, SQLAlchemy 2.0), TypeScript (interface, type, class, Zod) e Go (struct, GORM). Mantém tipos, tamanhos, precisão, nulidade, PK composta, identity, FK e mapeamento para o nome original da coluna. Também gera o design do JSON: um documento de exemplo no formato do Swagger ou um JSON Schema (draft 2020-12) com tipos, nulos, `maxLength`, `multipleOf`, `required` e formatos. Do JSON, gera também o SQL: tabelas (objetos 1:1 viram colunas com prefixo e listas viram tabelas filhas com FK) e uma procedure de carga com `OPENJSON` e transação, já formatada pelo SQL Forge. Baixa um .zip com um arquivo por classe. |

## Como executar

Pré-requisito: **Node.js 20.19+** (testado com Node 24).

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # build de produção em dist/
npm run preview    # serve o build em http://localhost:5050
npm test           # testes dos motores (CRON, JSON, XML, SQL, SQL Forge, Model Generator) com node --test
```

> Rede corporativa: se o `npm install` falhar com `ECONNRESET`, repita com
> `npm install --fetch-retries=8 --fetch-retry-mintimeout=3000 --maxsockets=3`.

## Stack

- **React 19 + Vite 7**, em JavaScript/JSX (sem TypeScript)
- **React Router 7** (rotas com carregamento sob demanda por módulo)
- **zustand** para estado persistido (equivalente ao Pinia do ReservaSalas)
- **motion** (Framer Motion) para transições e animações ligadas ao scroll
- **CodeMirror 6** como editor (renderiza só o que está visível)
- **d3** (hierarchy, zoom, scale, shape) para grafos, diagramas e gráficos
- **@mdi/js** (Material Design Icons, o mesmo conjunto do ReservaSalas) e fonte **Public Sans**

## Estrutura

```
src/
  @core/            componentes reutilizáveis (Button, Card, StatCard, Tag, Toast, VirtualList…),
                    hooks, utilitários e o RPC dos Web Workers
  layouts/          layout padrão: sidebar recolhível, navbar, paleta Ctrl+K
  navigation/       fonte única dos módulos (sidebar, dashboard, histórico)
  stores/           configurações e histórico local (localStorage)
  styles/           tokens de design (tema escuro e claro) e estilos globais
  shared/           editor de código e gráficos compartilhados
  modules/
    dashboard/      hero, cards, atividades e tour com animações de scroll
    json/           lib/jsonEngine.js (lógica pura) + json.worker.js + componentes
    cron/           lib/cronEngine.js, describe.js, natural.js + componentes
    xml/            lib/xmlParser.js + xml.worker.js + componentes
    dbdiagram/      lib/sql/{lexer,parser,dialects}.js, schema.js, layout.js, exporters.js
    sqlforge/       lib/{lexer,keywords,formatter}.js + sqlforge.worker.js
    modelgen/       lib/{sqlSource,jsonSource,naming,generators,sqlTarget}.js (usa o lexer/parser e o formatador do SQL Forge)
    settings/
tests/              testes dos motores (rodam no Node, sem navegador)
```

A lógica de cada ferramenta fica em `lib/`, em JavaScript puro e sem dependência de React. Por isso roda tanto nos Web Workers quanto nos testes.

## Identidade visual

Baseada no ReservaSalasReunião: azul principal `#6190BD` (hover `#527FA9`, profundo `#3f6a92`), Public Sans, cards com raio de 8 px e borda de 1 px, botão circular para recolher a sidebar e o mesmo padrão de botões e tags. O tema claro reproduz as superfícies do ReservaSalas. O tema escuro (padrão) acrescenta neon azul, ciano e roxo para estados ativos, seleções e conexões.

## Desempenho e privacidade

- JSON e XML são processados em **Web Workers**. No JSON, o documento fica no worker e a interface pede apenas fatias (filhos paginados, resultados de busca), então arquivos com centenas de MB não travam a tela.
- Listas (Tree View, visualizador XML, árvore XML) são **virtualizadas**.
- Acima de 6 milhões de caracteres o editor desliga o realce de sintaxe. Acima de 40 milhões ele é desativado e o arquivo continua disponível para análise, busca, visualização e exportação.
- Nenhum dado é enviado a servidores. O histórico guarda apenas metadados (ação, nome do arquivo e tamanho).

## Acessibilidade

Navegação por teclado (árvores com setas, Ctrl+K, foco visível), `aria-*` nos componentes interativos, contraste validado nos dois temas e respeito a `prefers-reduced-motion`, que pode ser forçado em **Configurações → Movimento**.

## Como o SQL Forge formata

Não usa regex de reescrita. O lexer guarda os comentários junto aos tokens. O parser monta a estrutura: blocos, IF/ELSE, TRY/CATCH, módulos e o fim de cada instrução, mesmo sem `;`. Cada cláusula é então posicionada pela coluna do "rio".

Ao final, o resultado passa por mais um lexer e é comparado ao original: nenhum identificador, literal ou comentário pode sumir. Formatar o resultado de novo não muda nada, e os testes cobrem essa propriedade. As regras ficam em `src/modules/sqlforge/lib/formatter.js`, e os trechos do documento do padrão estão em `tests/sqlforge.test.js`.

## Extensão do parser SQL

Para suportar outro banco, registre um dialeto em `src/modules/dbdiagram/lib/sql/dialects.js`, definindo os delimitadores de identificador, o separador de lote e as palavras de identidade. O lexer e o parser são compartilhados entre os dialetos.
