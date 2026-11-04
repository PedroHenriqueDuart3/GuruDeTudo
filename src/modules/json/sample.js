/** Exemplo de entrada (o usuário pode substituir por qualquer JSON). */
export const SAMPLE_JSON = `{
  "empresa": "Acme Tecnologia",
  "atualizadoEm": "2026-10-28T14:32:00Z",
  "departamentos": [
    { "id": 1, "nome": "Engenharia", "orcamento": 1250000, "ativo": true },
    { "id": 2, "nome": "Produto", "orcamento": 480000, "ativo": true },
    { "id": 3, "nome": "Dados", "orcamento": 720000, "ativo": false }
  ],
  "colaboradores": [
    { "id": 101, "nome": "Ana Souza", "cargo": "Tech Lead", "departamento": "Engenharia", "salario": 18500, "admissao": "2021-03-15", "skills": ["Vue", "Node", "SQL"], "endereco": { "cidade": "São Paulo", "uf": "SP" } },
    { "id": 102, "nome": "Bruno Lima", "cargo": "Dev Backend", "departamento": "Engenharia", "salario": 12300, "admissao": "2022-07-01", "skills": ["C#", ".NET"], "endereco": { "cidade": "Campinas", "uf": "SP" } },
    { "id": 103, "nome": "Carla Mendes", "cargo": "Product Manager", "departamento": "Produto", "salario": 15800, "admissao": "2020-11-20", "skills": ["Discovery"], "endereco": { "cidade": "Curitiba", "uf": "PR" } },
    { "id": 104, "nome": "Diego Rocha", "cargo": "Analista de Dados", "departamento": "Dados", "salario": 11200, "admissao": "2023-02-06", "skills": ["Python", "SQL", "Power BI"], "endereco": { "cidade": "Belo Horizonte", "uf": "MG" } },
    { "id": 105, "nome": "Elisa Prado", "cargo": "Dev Frontend", "departamento": "Engenharia", "salario": 10900, "admissao": "2024-05-13", "skills": ["React", "TypeScript"], "endereco": { "cidade": "São Paulo", "uf": "SP" } },
    { "id": 106, "nome": "Fábio Nunes", "cargo": "SRE", "departamento": "Engenharia", "salario": 16400, "admissao": "2019-09-02", "skills": ["Kubernetes", "Terraform"], "endereco": { "cidade": "Recife", "uf": "PE" } }
  ],
  "configuracoes": {
    "moeda": "BRL",
    "fusoHorario": "America/Sao_Paulo",
    "integracoes": { "sso": true, "webhooks": null, "limiteRequisicoes": 1200 }
  }
}
`
