# ION Finance — Etapa 5

Módulo `/finance`, exclusivo de administradores ativos. Usa o mesmo Supabase, Auth, Vercel e identidade visual do ION OS. Colaboradores e parceiros não recebem acesso a valores financeiros da agência. Não altera campanhas, pontos, rankings ou contratos comerciais existentes.

## Persistência e cálculos

Migrations incrementais **007_finance.sql** e **008_finance_historical_mrr.sql** e **009_finance_commission_origin.sql**, após 006. A 008 impede apresentar MRR histórico calculado a partir de condições atuais. Adiciona categorias, lançamentos (`fin_entries`), liquidações imutáveis (`fin_settlements`), recorrências (`fin_schedules`) e regras (`fin_rules`). RLS permite somente leitura administrativa; escritas exclusivamente por RPC com `require_admin()`, transações, bloqueio de concorrência, versionamento otimista e auditoria de estados anterior/posterior. Valores `NUMERIC(14,2)` e somas PostgreSQL; transporte de valores em strings decimais; apresentação e agrupamentos em centavos `BigInt`. Datas da agência em America/Sao_Paulo.

- **Competência:** data de reconhecimento do lançamento; resultado operacional = receitas − despesas por competência, excluindo cancelados. Não é lucro contábil certificado nem saldo bancário.
- **Vencimento:** data prevista da obrigação; indicadores previstos são valores integrais agendados e saldos a receber/pagar são a parte não liquidada, dentro do intervalo selecionado.
- **Liquidação:** data efetiva de cada recebimento/pagamento. Caixa realizado soma liquidações menos estornos nessa data, inclusive o histórico de lançamentos posteriormente cancelados. Comissões são despesas e não entram novamente como um segundo débito.
- **MRR:** condições recorrentes de receitas contratuais atualmente ativas na data final, divididas pelo número de meses da periodicidade. Não reconstrói alterações contratuais históricas; períodos encerrados mostram **Histórico indisponível**, inclusive no CSV. Contrato ativo sem condição financeira aprovada não gera MRR fictício.
- Sem saldo inicial e integração bancária, exibe variação de caixa do período, nunca saldo bancário total. Nenhum valor fictício é criado.

Status recebido/pago, parcial e vencido são derivados; parcial pode estar em atraso e é incluído no filtro Vencido. Cancelamento exige saldo liquidado zero. Estorno integral vincula uma liquidação original e exige motivo e data válida; para estorno parcial, estorne a liquidação e registre o valor correto. Não há exclusão financeira na interface/API.

## Uso

1. Contas a receber/pagar: cadastrar cliente e contrato opcionais, categoria, competência, vencimento e valor. Abrir o lançamento para receber/pagar parcialmente, consultar histórico, editar ou renegociar vencimento com motivo. Origem e tipo são imutáveis.
2. Recorrências: aprovar valor por parcela, vigência, dia 1–31 e periodicidade mensal/trimestral/anual. Receita recorrente exige contrato operacional. Gerar explicitamente até 12 meses por operação; dia 31 ajusta ao último dia do mês. Ciclo único por recorrência impede duplicação, inclusive após ajuste do vencimento. Contrato pausado, encerrado, cancelado ou fora da vigência não gera parcelas. Alterações não recalculam parcelas existentes.
3. Comissões: configurar regra individual **ou** por função, fixa **ou** percentual. Aprovar explicitamente por fechamento CRM confirmado com contrato comercial ativo e reunião realizada/qualificada. SDR/closer são os responsáveis de origem; outras funções precisam de vínculo com o cliente operacional. Regras diferentes são cumulativas. Combinação contrato + colaborador + regra é única. Cada comissão preserva o snapshot da regra e é um único lançamento de despesa. Revisões são feitas no lançamento com motivo; alterações da origem não apagam obrigações já aprovadas.
4. Cobranças: filtrar por período/cliente/status; visualizar valor, recebido, saldo e dias em atraso; renegociar pelo detalhe. Não há disparos automáticos, links bancários ou integrações fictícias.
5. Fluxo de caixa: diário ou mensal, realizado e saldo ainda previsto; gráficos são aproximações visuais, tabela/CSV mantêm centavos exatos.
6. Relatórios: receitas/despesas, categorias por competência, indicadores, inadimplência por cliente, comissões por colaborador, condições recorrentes e evolução do caixa. CSV UTF-8, proteção contra fórmulas de planilha, identificadores de origem. APIs autenticadas, sem cache compartilhado. `/finance/export?report=settlements` exporta movimentos e vínculos de estorno. Listagens paginadas em 50; relatório recusa intervalos acima de 10 anos ou mais de 10.000 lançamentos relevantes, em vez de truncar silenciosamente.

Mês/ano e datas personalizadas selecionam o intervalo. Cliente/categoria filtram indicadores; status e tipo filtram listagem/CSV de lançamentos. CSV de condições recorrentes contém condições atuais que intersectam o período; não parcelas liquidadas.

## Implantação e recuperação

`node scripts/prepare-finance-release.mjs` prepara pacote SQL transacional com guard de schema 006 e checks de segurança; não executa remotamente. Antes de aplicar em produção, verificar cópia atual recuperável, compatibilidade e baseline dos registros existentes. Aplicar somente 007, 008 e 009 uma vez, validar `supabase/checks/stage_5_security.sql`, publicar a branch integrada no projeto Vercel existente e confirmar o commit e rotas reais. Não reaplicar 001–006. Se 007 já estiver aplicada, executar as migrations seguintes ainda pendentes. A 009 preserva cliente e referência do CRM no snapshot da comissão, inclusive sem conversão operacional.

Recuperação lógica exige reconstruir schema compatível e restaurar dados; não equivale a PITR gerenciado. Artefatos criptografados ficam no bucket privado já existente e a chave protegida no ambiente servidor da Vercel. Nunca copiar chaves para o repositório. Não restaurar um snapshot sobre produção sem revisar gravações posteriores; preferir reversão do deployment, mantendo o schema aditivo.

## Verificação

`npm run test`: precisão, pagamentos parciais, estornos, versionamento, idempotência, limites, recorrências, comissões, RLS, auditoria e regressão das etapas anteriores. `npm run test:browser`: desktop e celular, formulários, relatórios/CSV, acesso direto e regressão. Fixture de navegador valida UI; não substitui validação real de Auth, PostgreSQL/RLS, operações e deployment. Registrar separadamente o resultado real da publicação.
