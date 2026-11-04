/** Exemplo SQL: tabelas com chave composta, FK, rowversion, coluna calculada e uma procedure de consulta. */
export const SAMPLE_SQL = `CREATE TABLE dbo.AGENTE ( CODAGENTE    INT          NOT NULL PRIMARY KEY
                        , NOME         VARCHAR(100) NOT NULL
                        , ATIVO        BIT          NOT NULL
                        );
GO

CREATE TABLE dbo.RISCOS ( CODCOLIGADA   SMALLINT      NOT NULL
                        , CODITEMRISCO  VARCHAR(10)   NOT NULL
                        , CODNIVELRISCO INT               NULL
                        , CODAGENTE     INT           NOT NULL REFERENCES dbo.AGENTE (CODAGENTE)
                        , DESCRICAO     NVARCHAR(MAX)     NULL
                        , VALOR         DECIMAL(18, 2)    NULL
                        , DATACRIACAO   DATETIME      NOT NULL DEFAULT (GETDATE())
                        , RECVERSAO     ROWVERSION
                        , VALORANUAL    AS (VALOR * 12)
                        , PRIMARY KEY (CODCOLIGADA, CODITEMRISCO)
                        );
GO

CREATE TABLE dbo.NIVELRISCO ( CODCOLIGADA   SMALLINT    NOT NULL
                            , CODITEMRISCO  VARCHAR(10) NOT NULL
                            , CODNIVELRISCO INT         NOT NULL
                            , DESCRICAO     VARCHAR(60) NOT NULL
                            , PRIMARY KEY (CODCOLIGADA, CODITEMRISCO, CODNIVELRISCO)
                            );
GO

CREATE OR ALTER PROCEDURE dbo.pc_ListaRiscos
( @CODCOLIGADA SMALLINT
, @Busca       VARCHAR(50) = NULL
)
AS
BEGIN
  SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
  SET NOCOUNT ON;

  SELECT RISCOS.CODITEMRISCO
       , RISCOS.DESCRICAO
       , NIVELRISCO.DESCRICAO AS NIVEL
       , AGENTE.NOME          AS AGENTE
       , ISNULL(RISCOS.VALOR, 0) AS VALOR
       , COUNT(*) OVER ()     AS TOTALREGISTROS
       , CASE
           WHEN AGENTE.ATIVO = 1 THEN 'Ativo'
           ELSE 'Inativo'
         END AS SITUACAO
    FROM dbo.RISCOS
         LEFT JOIN dbo.NIVELRISCO ON NIVELRISCO.CODCOLIGADA   = RISCOS.CODCOLIGADA
                                 AND NIVELRISCO.CODITEMRISCO  = RISCOS.CODITEMRISCO
                                 AND NIVELRISCO.CODNIVELRISCO = RISCOS.CODNIVELRISCO
         INNER JOIN dbo.AGENTE    ON AGENTE.CODAGENTE         = RISCOS.CODAGENTE
   WHERE RISCOS.CODCOLIGADA = @CODCOLIGADA;
END;
GO
`

/** Exemplo JSON: resposta de API com objetos aninhados, listas, datas e um campo sempre nulo. */
export const SAMPLE_JSON = `{
  "id": 101,
  "nome": "Ana Souza",
  "email": null,
  "ativo": true,
  "salario": 5230.75,
  "criadoEm": "2026-11-03T14:20:00Z",
  "nascimento": "1990-05-01",
  "endereco": { "rua": "Av. Brasil", "numero": 100, "cep": "01000-000" },
  "telefones": ["11 99999-0000"],
  "pedidos": [
    { "codigo": "a1b2c3d4-0000-4000-8000-000000000001", "total": 10, "itens": [{ "sku": "X-1", "quantidade": 1 }] },
    { "codigo": "a1b2c3d4-0000-4000-8000-000000000002", "total": 19.9, "cupom": "OFF10", "itens": [] }
  ]
}
`
