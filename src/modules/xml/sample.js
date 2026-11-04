export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Exemplo: substitua pelo seu XML (cole, importe ou arraste um arquivo) -->
<Empresa codigo="ACME" pais="BR">
    <Nome>Acme Tecnologia</Nome>
    <Endereco tipo="matriz">
        <Logradouro>Av. Paulista, 1000</Logradouro>
        <Cidade>São Paulo</Cidade>
        <UF>SP</UF>
    </Endereco>
    <Departamentos>
        <Departamento id="ENG" ativo="true">
            <Nome>Engenharia</Nome>
            <Colaboradores>
                <Colaborador matricula="101">
                    <Nome>Ana Souza</Nome>
                    <Cargo>Tech Lead</Cargo>
                    <Contato email="ana@acme.dev" ramal="2201"/>
                </Colaborador>
                <Colaborador matricula="102">
                    <Nome>Bruno Lima</Nome>
                    <Cargo>Dev Backend</Cargo>
                    <Contato email="bruno@acme.dev" ramal="2202"/>
                </Colaborador>
            </Colaboradores>
        </Departamento>
        <Departamento id="DAT" ativo="false">
            <Nome>Dados</Nome>
            <Observacao><![CDATA[Reestruturação prevista para <2027>]]></Observacao>
            <Colaboradores/>
        </Departamento>
    </Departamentos>
</Empresa>
`
