/** Procedure de exemplo escrita "do jeito que vem": minúsculas, vírgula no fim, sem rio. */
export const SAMPLE_TSQL = `create procedure pc_SincronizaFuncionarios @CodigoEmpresa int, @ParametroLongo bit = 0
as
begin
set nocount on
set xact_abort on

declare @NomeProcesso varchar(100) = 'pc_SincronizaFuncionarios', @DataProcessamento datetime2(0) = sysdatetime(),
@QtdInseridos int = 0, @MensagemErro nvarchar(4000)

begin try
/* 1. Carga da staging: último registro de cada matrícula */
if object_id('tempdb..#Origem') is not null drop table #Origem
create table #Origem (CodigoEmpresa int not null, Matricula varchar(20) not null, Nome varchar(150) not null, Cpf varchar(11) null)
create table #temp_inconsistencias (Matricula varchar(20) not null, Motivo varchar(200) not null)
create table #Alteracoes (Acao varchar(10) not null, Matricula varchar(20) not null, NomeAnterior varchar(150) null, CodigoCargoAnterior int null, primary key (Acao, Matricula))

with UltimoRegistro as (
select s.CodigoEmpresa, ltrim(rtrim(s.Matricula)) as Matricula, s.Nome, s.Cpf,
row_number() over (partition by ltrim(rtrim(s.Matricula)) order by s.DataAtualizacao desc) as Ordem
from StgFuncionario s where s.CodigoEmpresa = @CodigoEmpresa and s.Processado = 0)
insert into #Origem (CodigoEmpresa, Matricula, Nome, Cpf)
select u.CodigoEmpresa, u.Matricula, u.Nome, u.Cpf from UltimoRegistro u where u.Ordem = 1

/* 2. Validações */
insert #temp_inconsistencias (Matricula, Motivo)
select o.Matricula, 'CPF inválido' from #Origem o where len(o.Cpf) <> 11 or o.Cpf like '%[^0-9]%'

insert into #temp_inconsistencias (Matricula, Motivo)
select o.Matricula, 'CPF duplicado' from #Origem o
where o.Cpf in (select d.Cpf from #Origem d group by d.Cpf having count(*) > 1)

delete o from #Origem o where exists (select 1 from #temp_inconsistencias i where i.Matricula = o.Matricula)

/* 3. Gravação */
begin tran

merge Funcionario with (holdlock) as Destino
using #Origem as Origem
on Destino.CodigoEmpresa = Origem.CodigoEmpresa and Destino.Matricula = Origem.Matricula
when matched and exists (select Origem.Nome, Origem.Cpf except select Destino.Nome, Destino.Cpf)
then update set Destino.Nome = Origem.Nome, Destino.Cpf = Origem.Cpf
when not matched by target
then insert (CodigoEmpresa, Matricula) values (Origem.CodigoEmpresa, Origem.Matricula)
when not matched by source and Destino.Situacao = 'A'
then update set Destino.Situacao = 'D'
output case when $action = 'INSERT' then 'INSERIDO' else 'ATUALIZADO' end, inserted.Matricula
into #Alteracoes (Acao, Matricula);

select @QtdInseridos = count(*) from #Alteracoes a where a.Acao = 'INSERIDO'

update s set s.Processado = 1, s.DataProcessamento = @DataProcessamento
from StgFuncionario s
join #Origem o on o.CodigoEmpresa = s.CodigoEmpresa and o.Matricula = ltrim(rtrim(s.Matricula))
where s.Processado = 0

insert into LogIntegracao (NomeProcesso, CodigoEmpresa, Sucesso) values (@NomeProcesso, @CodigoEmpresa, 1)

commit

select i.Matricula, i.Motivo from #temp_inconsistencias i order by i.Matricula
end try
begin catch
if @@trancount > 0 rollback

set @MensagemErro = concat('Erro ', error_number(), ' na linha ', error_line(), ': ', error_message())

insert into LogIntegracao (NomeProcesso, CodigoEmpresa, Sucesso, Mensagem) values (@NomeProcesso, @CodigoEmpresa, 0, @MensagemErro)

throw
end catch
end
`
