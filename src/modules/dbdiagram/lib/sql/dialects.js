/**
 * Dialetos SQL. O lexer e o parser são compartilhados; cada dialeto ajusta
 * como identificadores são delimitados e algumas palavras específicas.
 * Para adicionar um banco novo, basta registrar um objeto aqui.
 */
export const DIALECTS = {
  sqlserver: {
    id: 'sqlserver',
    label: 'SQL Server (T-SQL)',
    identQuotes: { '[': ']', '"': '"' },
    batchSeparator: 'GO', // GO sozinho na linha separa lotes
    defaultSchema: 'dbo',
    identityKeywords: ['IDENTITY'],
    blockStatements: ['PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'VIEW'],
    nestedComments: true,
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL (beta)',
    identQuotes: { '"': '"' },
    batchSeparator: null,
    defaultSchema: 'public',
    identityKeywords: [],
    serialTypes: ['SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'SERIAL4', 'SERIAL8'],
    blockStatements: ['FUNCTION', 'PROCEDURE', 'TRIGGER', 'VIEW'],
    dollarQuotes: true,
    nestedComments: true,
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL / MariaDB (beta)',
    identQuotes: { '`': '`', '"': '"' },
    batchSeparator: null,
    defaultSchema: null,
    identityKeywords: ['AUTO_INCREMENT'],
    blockStatements: ['PROCEDURE', 'FUNCTION', 'TRIGGER', 'VIEW'],
    hashComments: true,
    nestedComments: false,
  },
}

export function getDialect(id) {
  return DIALECTS[id] ?? DIALECTS.sqlserver
}
