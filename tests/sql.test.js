import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema } from '../src/modules/dbdiagram/lib/schema.js'
import { autoLayout, tableSize } from '../src/modules/dbdiagram/lib/layout.js'
import { parseSql } from '../src/modules/dbdiagram/lib/sql/parser.js'

const basic = `
CREATE TABLE Departamento (
    Id INT PRIMARY KEY,
    Nome VARCHAR(100)
);

CREATE TABLE Colaborador (
    Id INT PRIMARY KEY,
    Nome VARCHAR(150),
    IdDepartamento INT,
    FOREIGN KEY (IdDepartamento)
        REFERENCES Departamento(Id)
);`

test('exemplo do briefing: tabelas, PK, FK e relacionamento', () => {
  const s = buildSchema(basic)
  assert.equal(s.errors.length, 0)
  assert.deepEqual(s.tables.map((t) => t.name), ['Departamento', 'Colaborador'])
  const col = s.tables[1].columns.find((c) => c.name === 'IdDepartamento')
  assert.equal(col.fk, true)
  assert.equal(s.relations.length, 1)
  assert.equal(s.relations[0].cardinality.kind, 'many-to-one')
  assert.equal(s.relations[0].cardinality.parentOptional, true)
})

test('script gerado pelo SSMS (colchetes, GO, CONSTRAINT nomeadas, ALTER TABLE WITH CHECK)', () => {
  const sql = `
SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[Pedido](
\t[Id] [int] IDENTITY(1,1) NOT NULL,
\t[ClienteId] [int] NOT NULL,
\t[Total] [decimal](18, 2) NULL CONSTRAINT [DF_Pedido_Total] DEFAULT ((0)),
\t[Codigo] [nvarchar](max) NOT NULL,
 CONSTRAINT [PK_Pedido] PRIMARY KEY CLUSTERED ([Id] ASC) WITH (PAD_INDEX = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
CREATE TABLE [dbo].[Cliente]([Id] [int] NOT NULL PRIMARY KEY, [Email] varchar(200) NOT NULL UNIQUE)
GO
ALTER TABLE [dbo].[Pedido]  WITH CHECK ADD  CONSTRAINT [FK_Pedido_Cliente] FOREIGN KEY([ClienteId])
REFERENCES [dbo].[Cliente] ([Id]) ON DELETE CASCADE
GO
ALTER TABLE [dbo].[Pedido] CHECK CONSTRAINT [FK_Pedido_Cliente]
GO
CREATE PROCEDURE dbo.Teste AS BEGIN CREATE TABLE #tmp (x int); SELECT 1; END
GO`
  const s = buildSchema(sql)
  assert.deepEqual(s.errors, [])
  assert.equal(s.tables.length, 2, 'a tabela temporária da procedure é ignorada')
  const pedido = s.tables.find((t) => t.name === 'Pedido')
  assert.deepEqual(pedido.pk, ['Id'])
  assert.equal(pedido.columns[0].identity, true)
  assert.equal(pedido.columns[2].type, 'decimal(18, 2)')
  assert.equal(pedido.columns[3].type, 'nvarchar(max)')
  assert.equal(s.relations[0].name, 'FK_Pedido_Cliente')
  assert.equal(s.relations[0].onDelete, 'CASCADE')
  assert.equal(s.relations[0].cardinality.parentOptional, false)
  assert.equal(s.tables.find((t) => t.name === 'Cliente').columns[1].unique, true)
})

test('1:1 quando a FK também é PK; FK composta; ordem do script não importa', () => {
  const sql = `
CREATE TABLE Perfil (UsuarioId INT NOT NULL PRIMARY KEY REFERENCES Usuario(Id), Bio TEXT);
CREATE TABLE Usuario (Id INT NOT NULL, CONSTRAINT PK_U PRIMARY KEY (Id));
CREATE TABLE ItemPedido (PedidoId INT, Linha INT, PRIMARY KEY (PedidoId, Linha));
CREATE TABLE Entrega (PedidoId INT NOT NULL, Linha INT NOT NULL, FOREIGN KEY (PedidoId, Linha) REFERENCES ItemPedido (PedidoId, Linha));`
  const s = buildSchema(sql)
  assert.deepEqual(s.errors, [])
  const perfil = s.relations.find((r) => r.from.table === 'dbo.perfil')
  assert.equal(perfil.cardinality.kind, 'one-to-one')
  const entrega = s.relations.find((r) => r.from.table === 'dbo.entrega')
  assert.deepEqual(entrega.from.columns, ['PedidoId', 'Linha'])
})

test('erros com linha e recuperação para as demais tabelas', () => {
  const sql = `CREATE TABLE A (Id INT PRIMARY KEY,
  Nome VARCHAR(10)
  Idade INT);
CREATE TABLE B (Id INT PRIMARY KEY);`
  const s = buildSchema(sql)
  assert.equal(s.errors.length, 1)
  assert.equal(s.errors[0].line, 3)
  assert.deepEqual(s.tables.map((t) => t.name), ['B'])
})

test('avisa FK para tabela inexistente', () => {
  const s = buildSchema('CREATE TABLE X (Id INT, YId INT REFERENCES Y(Id));')
  assert.equal(s.relations.length, 0)
  assert.match(s.warnings[0].message, /inexistente/)
})

test('PostgreSQL e MySQL', () => {
  const pg = buildSchema(`CREATE TABLE IF NOT EXISTS "public"."conta" (id SERIAL PRIMARY KEY, saldo NUMERIC(12,2) DEFAULT 0.00 NOT NULL, criado TIMESTAMP WITH TIME ZONE DEFAULT now(), tags TEXT[]);`, 'postgres')
  assert.deepEqual(pg.errors, [])
  assert.equal(pg.tables[0].columns[0].identity, true)
  assert.equal(pg.tables[0].columns[2].type, 'TIMESTAMP WITH TIME ZONE')
  const my = buildSchema(
    "CREATE TABLE `pedido` (`id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `cliente_id` INT NOT NULL, PRIMARY KEY (`id`), KEY `idx_cli` (`cliente_id`), CONSTRAINT `fk_c` FOREIGN KEY (`cliente_id`) REFERENCES `cliente` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; CREATE TABLE `cliente` (`id` INT PRIMARY KEY);",
    'mysql',
  )
  assert.deepEqual(my.errors, [])
  assert.equal(my.relations.length, 1)
})

test('não entra em loop com instruções desconhecidas', () => {
  const r = parseSql('CREATE SEQUENCE s START WITH 1\nCREATE TABLE T (Id INT)\nINSERT INTO T VALUES (1)')
  assert.equal(r.statements.length, 1)
})

test('layout do exemplo completo: coordenadas finitas e sem sobreposição', async () => {
  const { SAMPLE_SQL } = await import('../src/modules/dbdiagram/sample.js')
  const s = buildSchema(SAMPLE_SQL)
  assert.deepEqual(s.errors, [])
  const sizes = new Map(s.tables.map((t) => [t.id, tableSize(t)]))
  const { positions } = autoLayout(s.tables, s.relations, { sizes })
  const boxes = s.tables.map((t) => ({ ...positions.get(t.id), ...sizes.get(t.id), name: t.name }))
  for (const b of boxes) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `${b.name} com coordenada finita`)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.ok(!overlap, `${a.name} sobrepõe ${b.name}`)
    }
})

test('layout separa camadas e não sobrepõe tabelas', () => {
  const s = buildSchema(basic)
  const sizes = new Map(s.tables.map((t) => [t.id, tableSize(t)]))
  const { positions } = autoLayout(s.tables, s.relations, { sizes })
  const dep = positions.get('dbo.departamento')
  const col = positions.get('dbo.colaborador')
  assert.ok(dep.x < col.x, 'tabela referenciada fica à esquerda')
})
