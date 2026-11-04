import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTsql } from '../src/modules/sqlforge/lib/formatter.js'
import { lex } from '../src/modules/sqlforge/lib/lexer.js'
import { SAMPLE_TSQL } from '../src/modules/sqlforge/sample.js'

const fmt = (s, o) => formatTsql(s, o).output

/** Trechos copiados do documento do padrão: o resultado precisa contê-los exatamente. */
const SPEC = {
  header: `CREATE OR ALTER PROCEDURE dbo.pc_SincronizaFuncionarios
( @CodigoEmpresa  INT
, @ParametroLongo BIT = 0
)
AS
BEGIN
  SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
  SET NOCOUNT ON;
`,
  where: `     WHERE LEN(o.Cpf) <> 11
        OR o.Cpf LIKE '%[^0-9]%';`,
  join: `      FROM dbo.StgFuncionario s
           INNER JOIN #tORIGEM o ON o.CodigoEmpresa = s.CodigoEmpresa
                                AND o.Matricula     = LTRIM(RTRIM(s.Matricula))
     WHERE s.Processado = 0;`,
  update: `    UPDATE s
       SET s.Processado        = 1
         , s.DataProcessamento = @DataProcessamento`,
  subquery: `     WHERE o.Cpf IN ( SELECT d.Cpf
                        FROM #tORIGEM d
                       GROUP BY d.Cpf
                      HAVING COUNT(*) > 1
                    );`,
  exists: `     WHERE EXISTS ( SELECT 1
                      FROM #tINCONSISTENCIAS i
                     WHERE i.Matricula = o.Matricula
                  );`,
  cte: `    ;WITH UltimoRegistro
    AS ( SELECT s.CodigoEmpresa
              , LTRIM(RTRIM(s.Matricula)) AS Matricula`,
  createTable: `    CREATE TABLE #tALTERACOES ( Acao                VARCHAR(10)  NOT NULL
                              , Matricula           VARCHAR(20)  NOT NULL
                              , NomeAnterior        VARCHAR(150)     NULL
                              , CodigoCargoAnterior INT              NULL
                              , PRIMARY KEY (Acao, Matricula)
                              );`,
  insertValues: `    INSERT INTO dbo.LogIntegracao ( NomeProcesso
                                  , CodigoEmpresa
                                  , Sucesso
                                  )
    VALUES ( @NomeProcesso
           , @CodigoEmpresa
           , 1
           );`,
  merge: `     MERGE dbo.Funcionario WITH (HOLDLOCK) AS Destino
     USING #tORIGEM AS Origem
        ON Destino.CodigoEmpresa = Origem.CodigoEmpresa
       AND Destino.Matricula     = Origem.Matricula
      WHEN MATCHED AND EXISTS ( SELECT Origem.Nome
                                     , Origem.Cpf
                                EXCEPT
                                SELECT Destino.Nome
                                     , Destino.Cpf
                              )
      THEN UPDATE
              SET Destino.Nome = Origem.Nome
                , Destino.Cpf  = Origem.Cpf
      WHEN NOT MATCHED BY TARGET
      THEN INSERT ( CodigoEmpresa
                  , Matricula
                  )
           VALUES ( Origem.CodigoEmpresa
                  , Origem.Matricula
                  )
      WHEN NOT MATCHED BY SOURCE
       AND Destino.Situacao = 'A'
      THEN UPDATE
              SET Destino.Situacao = 'D'
    OUTPUT CASE
             WHEN $action = 'INSERT' THEN 'INSERIDO'
             ELSE 'ATUALIZADO'
           END
         , inserted.Matricula
      INTO #tALTERACOES ( Acao
                        , Matricula
                        );`,
  catch: `  BEGIN CATCH
    IF @@TRANCOUNT > 0
      ROLLBACK TRANSACTION;

    SET @MensagemErro = CONCAT('Erro ', ERROR_NUMBER(), ' na linha ', ERROR_LINE(), ': ', ERROR_MESSAGE());`,
}

test('procedure de exemplo sai idêntica aos trechos do padrão', () => {
  const out = fmt(SAMPLE_TSQL)
  for (const [name, fragment] of Object.entries(SPEC)) assert.ok(out.includes(fragment), `trecho "${name}" não encontrado:\n${fragment}\n\n--- saída ---\n${out}`)
  assert.ok(!/XACT_ABORT/.test(out), 'SET XACT_ABORT ON deve ser removido')
  assert.ok(out.trimEnd().endsWith('END;\nGO'))
  assert.ok(!out.includes('\t'))
})

test('DECLARE alinha nomes, tipos e "=" com vírgula sob o E', () => {
  const out = fmt("declare @NomeProcesso varchar(100) = 'x', @DataProcessamento datetime2(0) = sysdatetime(), @QtdInseridos int = 0, @MensagemErro nvarchar(4000)")
  assert.equal(
    out,
    `DECLARE @NomeProcesso      VARCHAR(100) = 'x'
      , @DataProcessamento DATETIME2(0) = SYSDATETIME()
      , @QtdInseridos      INT          = 0
      , @MensagemErro      NVARCHAR(4000);
`,
  )
})

test('formatar o resultado de novo não muda nada (idempotente)', () => {
  const once = fmt(SAMPLE_TSQL)
  assert.equal(fmt(once), once)
})

test('nenhum identificador, literal ou comentário se perde', () => {
  const src = `-- topo
select a.Id, -- id
  'texto com select from', N'ção' /* bloco */ from Tabela a where a.X = 1 -- fim`
  const r = formatTsql(src)
  assert.equal(r.checklist.find((c) => c.id === 'integrity').status, 'ok')
  assert.ok(r.output.includes('-- id'))
  assert.ok(r.output.includes('-- fim'))
  assert.ok(r.output.includes("'texto com select from'"))
})

test('detecta o fim das instruções mesmo sem ponto e vírgula', () => {
  const out = fmt('declare @x int\nset @x = 1\nselect @x as Valor\nif @x = 1 print \'um\' else print \'outro\'\nexec dbo.p @a = 1')
  assert.equal(
    out,
    `DECLARE @x INT;
SET @x = 1;
SELECT @x AS Valor;
IF @x = 1
  PRINT 'um';
ELSE
  PRINT 'outro';
EXEC dbo.p @a = 1;
`,
  )
})

test('END antes de ELSE não leva ponto e vírgula (seria erro de sintaxe)', () => {
  const out = fmt('if 1 = 1 begin print 1 end else begin print 2 end')
  assert.match(out, /^  PRINT 1;\nEND\nELSE\nBEGIN$/m)
  assert.ok(out.trimEnd().endsWith('END;'))
})

test('IF OBJECT_ID vira DROP TABLE IF EXISTS e temporárias ganham o DROP antes do CREATE', () => {
  const out = fmt("if object_id('tempdb..#Origem') is not null drop table #Origem\ncreate table #Origem (Id int not null)\nselect * into #Saida from #Origem")
  assert.ok(out.startsWith('DROP TABLE IF EXISTS #tORIGEM;\nCREATE TABLE #tORIGEM ( Id INT NOT NULL\n'))
  assert.ok(out.includes('DROP TABLE IF EXISTS #tSAIDA;\nSELECT *\n  INTO #tSAIDA'))
})

test('palavras de função usadas como nome de tabela não viram palavra-chave', () => {
  assert.equal(fmt('truncate table Log'), 'TRUNCATE TABLE dbo.Log;\n')
  assert.equal(fmt('select max(x) from t'), 'SELECT MAX(x)\n  FROM dbo.t;\n')
})

test('CTE, alias de tabela temporária e pseudo-tabelas não recebem dbo.', () => {
  const out = fmt('with Base as (select 1 as X) select b.X from Base b join #t t on t.X = b.X join inserted i on i.X = b.X')
  assert.ok(out.includes('  FROM Base b'))
  assert.ok(out.includes('INNER JOIN inserted i'))
  assert.ok(!out.includes('dbo.Base'))
})

test('opções desligadas preservam nomes', () => {
  const out = fmt('select [Nome] from [Tabela] t join #Origem o on o.Id = t.Id', { qualifyDbo: false, renameTemp: false, stripBrackets: false })
  assert.ok(out.includes('[Nome]'))
  assert.ok(out.includes('FROM [Tabela] t'))
  assert.ok(out.includes('#Origem o'))
})

test('lexer anexa comentários ao token certo', () => {
  const { tokens } = lex('select a, -- c1\n  b /* c2 */\nfrom t')
  const comma = tokens.find((t) => t.v === ',')
  assert.equal(comma.trail[0].text, ' c1')
  const b = tokens.find((t) => t.v === 'b')
  assert.equal(b.trail[0].text, '/* c2 */')
})
