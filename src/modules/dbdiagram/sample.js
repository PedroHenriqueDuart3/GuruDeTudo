/** Script de exemplo (SQL Server). Substitua pelo seu DDL. */
export const SAMPLE_SQL = `-- Exemplo: modelo simples de RH (SQL Server)
CREATE TABLE Empresa (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    RazaoSocial NVARCHAR(200) NOT NULL,
    Cnpj CHAR(14) NOT NULL UNIQUE
);

CREATE TABLE Departamento (
    Id INT PRIMARY KEY,
    Nome VARCHAR(100) NOT NULL,
    IdEmpresa INT NOT NULL,
    IdGestor INT NULL,
    CONSTRAINT FK_Departamento_Empresa FOREIGN KEY (IdEmpresa) REFERENCES Empresa(Id)
);

CREATE TABLE Colaborador (
    Id INT PRIMARY KEY,
    Nome VARCHAR(150) NOT NULL,
    Email VARCHAR(200) NOT NULL UNIQUE,
    Salario DECIMAL(12, 2) CHECK (Salario > 0),
    Admissao DATE DEFAULT GETDATE(),
    IdDepartamento INT,
    FOREIGN KEY (IdDepartamento)
        REFERENCES Departamento(Id)
);

CREATE TABLE Cracha (
    IdColaborador INT PRIMARY KEY REFERENCES Colaborador(Id),
    Codigo VARCHAR(20) NOT NULL,
    EmitidoEm DATETIME2 NOT NULL
);

CREATE TABLE Projeto (
    Id INT PRIMARY KEY,
    Nome VARCHAR(120) NOT NULL,
    IdDepartamento INT NOT NULL REFERENCES Departamento(Id) ON DELETE CASCADE
);

CREATE TABLE Alocacao (
    IdColaborador INT NOT NULL,
    IdProjeto INT NOT NULL,
    Papel VARCHAR(60),
    CONSTRAINT PK_Alocacao PRIMARY KEY (IdColaborador, IdProjeto),
    CONSTRAINT FK_Alocacao_Colaborador FOREIGN KEY (IdColaborador) REFERENCES Colaborador(Id),
    CONSTRAINT FK_Alocacao_Projeto FOREIGN KEY (IdProjeto) REFERENCES Projeto(Id)
);

ALTER TABLE Departamento
    ADD CONSTRAINT FK_Departamento_Gestor FOREIGN KEY (IdGestor) REFERENCES Colaborador(Id);
`
