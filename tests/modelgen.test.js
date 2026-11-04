import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateModels } from '../src/modules/modelgen/lib/index.js'
import { sqlToModel } from '../src/modules/modelgen/lib/sqlSource.js'
import { jsonToModel } from '../src/modules/modelgen/lib/jsonSource.js'
import { toCamel, toPascal, toSnake, singular } from '../src/modules/modelgen/lib/naming.js'
import { SAMPLE_JSON, SAMPLE_SQL } from '../src/modules/modelgen/sample.js'
import { createZip, crc32 } from '../src/@core/utils/zip.js'

const cls = (model, name) => model.classes.find((c) => c.name === name)
const field = (c, name) => c.fields.find((f) => f.name === name)

test('nomes: PascalCase, camelCase, snake_case e siglas', () => {
  assert.equal(toPascal('codigo_empresa'), 'CodigoEmpresa')
  assert.equal(toCamel('CodigoEmpresa'), 'codigoEmpresa')
  assert.equal(toSnake('CodigoEmpresa'), 'codigo_empresa')
  assert.equal(toPascal('XMLData'), 'XmlData')
  assert.equal(toPascal('endereço'), 'Endereco')
  assert.equal(singular('pedidos'), 'pedido')
  assert.equal(singular('itens'), 'item')
  assert.equal(singular('cartoes'), 'cartao')
})

test('SQL: tipos, nulidade, chave composta, FK, rowversion e coluna calculada', () => {
  const m = sqlToModel(SAMPLE_SQL)
  const riscos = cls(m, 'RISCOS')
  assert.deepEqual(riscos.pk, ['CODCOLIGADA', 'CODITEMRISCO'])
  assert.equal(field(riscos, 'CODCOLIGADA').type.base, 'int16')
  assert.equal(field(riscos, 'CODITEMRISCO').type.length, 10)
  assert.equal(field(riscos, 'DESCRICAO').type.length, null)
  assert.equal(field(riscos, 'DESCRICAO').nullable, true)
  assert.deepEqual([field(riscos, 'VALOR').type.precision, field(riscos, 'VALOR').type.scale], [18, 2])
  assert.deepEqual(field(riscos, 'CODAGENTE').fk, { table: 'dbo.AGENTE', column: 'CODAGENTE' })
  assert.equal(field(riscos, 'RECVERSAO').type.rowversion, true)
  assert.equal(field(riscos, 'VALORANUAL').type.base, 'decimal', 'coluna calculada tipada pela expressão')
})

test('SQL: SELECT da procedure vira DTO com tipos das tabelas e nulidade do LEFT JOIN', () => {
  const m = sqlToModel(SAMPLE_SQL)
  const r = cls(m, 'ListaRiscosResultado')
  assert.ok(r, 'classe do resultado criada')
  assert.deepEqual(
    r.fields.map((f) => f.name),
    ['CODITEMRISCO', 'DESCRICAO', 'NIVEL', 'AGENTE', 'VALOR', 'TOTALREGISTROS', 'SITUACAO'],
  )
  assert.equal(field(r, 'NIVEL').nullable, true, 'vem de LEFT JOIN')
  assert.equal(field(r, 'AGENTE').nullable, false)
  assert.equal(field(r, 'VALOR').nullable, false, 'ISNULL(..., 0)')
  assert.equal(field(r, 'TOTALREGISTROS').type.base, 'int32')
  assert.equal(field(r, 'SITUACAO').type.base, 'string')
})

test('SQL: o que não dá para descobrir fica marcado, nunca inventado', () => {
  const src = 'create procedure p as select x.Coluna from dbo.TabelaFora x'
  const f = sqlToModel(src).classes[0].fields[0]
  assert.equal(f.type.base, 'unknown')
  assert.match(f.note, /não identificado/)
  const cs = generateModels(src, { language: 'csharp' }).files[0].content
  assert.match(cs, /TODO: tipo não identificado/)
  assert.match(cs, /public object\? Coluna/)
})

test('JSON: classes aninhadas, listas, campos opcionais e datas', () => {
  const m = jsonToModel(SAMPLE_JSON, { rootName: 'Cliente' })
  assert.deepEqual(
    m.classes.map((c) => c.name),
    ['Cliente', 'Endereco', 'Pedido', 'Item'],
  )
  const c = cls(m, 'Cliente')
  assert.equal(field(c, 'criadoEm').type.base, 'datetime')
  assert.equal(field(c, 'nascimento').type.base, 'date')
  assert.equal(field(c, 'salario').type.base, 'decimal')
  assert.equal(field(c, 'pedidos').list, true)
  assert.equal(field(c, 'pedidos').ref, 'Pedido')
  const p = cls(m, 'Pedido')
  assert.equal(field(p, 'cupom').nullable, true, 'ausente em um dos itens')
  assert.equal(field(p, 'total').type.base, 'decimal', '10 e 19.9 → decimal')
  assert.equal(field(p, 'codigo').type.base, 'guid')
})

test('C# EF Core: [Table], [PrimaryKey] composta, [MaxLength], [Timestamp] e [Column] com o nome original', () => {
  const f = generateModels(SAMPLE_SQL, { language: 'csharp', style: 'ef' }).files.find((x) => x.name === 'Riscos.cs').content
  assert.ok(f.includes('[Table("RISCOS", Schema = "dbo")]'))
  assert.ok(f.includes('[PrimaryKey(nameof(Codcoligada), nameof(Coditemrisco))]'))
  assert.ok(f.includes('    [MaxLength(10)]\n    [Column("CODITEMRISCO")]\n    public string Coditemrisco { get; set; } = string.Empty;'))
  assert.ok(f.includes('    [Column("VALOR", TypeName = "decimal(18,2)")]\n    public decimal? Valor { get; set; }'))
  assert.ok(f.includes('[Timestamp]'))
})

test('Java JPA gera a classe da chave composta; "manter originais" preserva CODCOLIGADA', () => {
  const r = generateModels(SAMPLE_SQL, { language: 'java', style: 'jpa' })
  const id = r.files.find((x) => x.name === 'RiscosId.java')
  assert.ok(id)
  assert.ok(id.content.includes('implements Serializable'))
  assert.ok(id.content.includes('Objects.hash(codcoligada, coditemrisco)'))
  const keep = generateModels(SAMPLE_SQL, { language: 'csharp', naming: 'keep' }).files.find((x) => x.name === 'RISCOS.cs').content
  assert.ok(keep.includes('public short CODCOLIGADA { get; set; }'))
})

test('Python dataclass põe obrigatórios antes dos opcionais; Go usa ponteiro para anulável', () => {
  const py = generateModels(SAMPLE_JSON, { language: 'python', style: 'dataclass' }).files[0].content
  const pedido = py.slice(py.indexOf('class Pedido'))
  assert.ok(pedido.indexOf('itens:') < pedido.indexOf('cupom:'))
  assert.ok(pedido.includes('cupom: Optional[str] = None'))
  const go = generateModels(SAMPLE_SQL, { language: 'go' }).files[0].content
  assert.match(go, /Descricao +\*string +`json:"descricao,omitempty" db:"DESCRICAO"`/)
  assert.ok(go.includes('"github.com/shopspring/decimal"'))
})

test('todas as linguagens e estilos geram arquivos para as duas fontes', () => {
  const langs = {
    csharp: ['poco', 'ef', 'record'],
    java: ['pojo', 'lombok', 'jpa', 'record'],
    kotlin: ['data', 'jpa'],
    python: ['dataclass', 'pydantic', 'sqlalchemy'],
    typescript: ['interface', 'type', 'class', 'zod'],
    go: ['struct', 'gorm'],
    json: ['example', 'schema'],
    sql: ['tables', 'procedure', 'script'],
  }
  for (const [language, styles] of Object.entries(langs))
    for (const style of styles)
      for (const src of [SAMPLE_SQL, SAMPLE_JSON]) {
        const r = generateModels(src, { language, style })
        assert.ok(r.files.length > 0, `${language}/${style}`)
        for (const f of r.files) assert.ok(!/undefined|NaN|\[object Object\]/.test(f.content), `${language}/${style}/${f.name}`)
      }
})

test('zip: CRC32 correto e um arquivo por classe', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const z = createZip([
    { name: 'A.cs', content: 'a' },
    { name: 'B.cs', content: 'bb' },
  ])
  const v = new DataView(z.buffer)
  assert.equal(v.getUint32(0, true), 0x04034b50)
  assert.equal(v.getUint16(z.length - 22 + 10, true), 2)
})

test('SQL → JSON de exemplo: um documento por tabela, decimais com a escala e lista na raiz', () => {
  const now = new Date('2026-11-04T12:00:00Z')
  const files = generateModels(SAMPLE_SQL, { language: 'json', style: 'example', now }).files
  assert.deepEqual(
    files.map((f) => f.name),
    ['Agente.json', 'Riscos.json', 'Nivelrisco.json', 'ListaRiscosResultado.json'],
  )
  const riscos = files.find((f) => f.name === 'Riscos.json').content
  assert.ok(riscos.includes('"valor": 0.00'))
  assert.ok(riscos.includes('"datacriacao": "2026-11-04T00:00:00"'))
  assert.deepEqual(Object.keys(JSON.parse(riscos)).slice(0, 3), ['codcoligada', 'coditemrisco', 'codnivelrisco'])
  const list = generateModels(SAMPLE_SQL, { language: 'json', style: 'example', rootList: true, nullAsNull: true, naming: 'keep', now }).files[1].content
  const parsed = JSON.parse(list)
  assert.ok(Array.isArray(parsed))
  assert.equal(parsed[0].DESCRICAO, null)
  assert.equal(parsed[0].CODITEMRISCO, 'string')
})

test('SQL → JSON Schema: tipos, nulos, maxLength, multipleOf, required e formatos', () => {
  const s = JSON.parse(generateModels(SAMPLE_SQL, { language: 'json', style: 'schema' }).files.find((f) => f.name === 'Riscos.schema.json').content)
  assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.deepEqual(s.properties.coditemrisco.type, 'string')
  assert.equal(s.properties.coditemrisco.maxLength, 10)
  assert.deepEqual(s.properties.descricao.type, ['string', 'null'])
  assert.equal(s.properties.valor.multipleOf, 0.01)
  assert.equal(s.properties.datacriacao.format, 'date-time')
  assert.deepEqual([s.properties.codcoligada.minimum, s.properties.codcoligada.maximum], [-32768, 32767])
  assert.ok(s.required.includes('codcoligada') && !s.required.includes('descricao'))
  const fromJson = JSON.parse(generateModels(SAMPLE_JSON, { language: 'json', style: 'schema' }).files[0].content)
  assert.equal(fromJson.properties.pedidos.items.$ref, '#/$defs/Pedido')
  assert.ok(fromJson.$defs.Pedido && fromJson.$defs.Item)
})

test('JSON → tabelas: raiz com PK natural, objeto 1:1 achatado, listas viram tabelas filhas com FK', async () => {
  const { formatTsql } = await import('../src/modules/sqlforge/lib/formatter.js')
  const sql = generateModels(SAMPLE_JSON, { language: 'sql', style: 'tables' }).files[0].content
  assert.ok(sql.includes('CREATE TABLE dbo.Modelo ( Id '))
  assert.match(sql, /, EnderecoRua +VARCHAR\(20\) +NOT NULL/)
  assert.match(sql, /, Salario +DECIMAL\(18, 2\) +NOT NULL/)
  assert.match(sql, /, Email +NVARCHAR\(MAX\) +NULL -- TODO: sempre nulo no exemplo/)
  assert.ok(sql.includes('CREATE TABLE dbo.ModeloTelefone ( CodigoModeloTelefone INT'))
  assert.ok(sql.includes('FOREIGN KEY (IdModelo) REFERENCES dbo.Modelo (Id)'))
  assert.ok(sql.includes('FOREIGN KEY (CodigoPedido) REFERENCES dbo.Pedido (Codigo)'))
  assert.equal(formatTsql(sql).output, sql, 'já sai no padrão do SQL Forge')
})

test('JSON → procedure de carga: OPENJSON por nível e MERGE + #tMAPA quando a chave do pai é IDENTITY', () => {
  const json = '[{"nome":"Pedido A","itens":[{"sku":"X","tags":["a"]}]}]'
  const sql = generateModels(json, { language: 'sql', style: 'procedure' }).files[0].content
  assert.ok(sql.includes('CREATE OR ALTER PROCEDURE dbo.pc_CarregaModelo\n( @Json NVARCHAR(MAX)\n)'))
  assert.ok(sql.includes('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n  SET NOCOUNT ON;'))
  assert.ok(sql.includes('DROP TABLE IF EXISTS #tMAPAMODELO;'))
  assert.ok(sql.includes('     MERGE dbo.Modelo AS Destino'))
  assert.ok(sql.includes('    OUTPUT inserted.CodigoModelo'))
  assert.ok(sql.includes('INNER JOIN #tMAPAITEM M ON M.ChaveJson = CONCAT(R0.[key], \'/\', R1.[key])'))
  assert.ok(sql.includes('CROSS APPLY OPENJSON(R1.value, \'$.tags\') R2'))
  assert.ok(!/XACT_ABORT/.test(sql))
})

test('SQL → procedure de carga: uma por tabela, sem IDENTITY, colunas calculadas e rowversion', () => {
  const sql = generateModels(SAMPLE_SQL, { language: 'sql', style: 'procedure' }).files[0].content
  assert.ok(sql.includes('CREATE OR ALTER PROCEDURE dbo.pc_CarregaRiscos'))
  const riscos = sql.slice(sql.indexOf('pc_CarregaRiscos'), sql.indexOf('pc_CarregaNivelrisco'))
  assert.ok(riscos.includes("CAST(JSON_VALUE(R0.value, '$.codcoligada') AS SMALLINT)"))
  assert.ok(riscos.includes("CONVERT(DATETIME, JSON_VALUE(R0.value, '$.datacriacao'), 127)"))
  assert.ok(!riscos.includes('RECVERSAO') && !riscos.includes('VALORANUAL'))
})
