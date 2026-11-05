# ION CRM — agenda e follow-ups

O CRM continua na mesma aplicação e usa `crm_leads`, `opportunities`, `meetings`,
`crm_deals` e `crm_activities`. Não existe uma segunda reunião do Challenger.

## Operação

- **SDR:** painel diário, leads atribuídos e botão **Agendar reunião**. Selecionar
  um lead reutiliza empresa, contato, telefone e closer; somente horário e closer
  são obrigatórios no agendamento. Também é possível agendar na página do lead.
- **Closer:** reuniões de hoje em ordem de horário, próximas reuniões, pendências
  de resultado e retornos. Agenda oferece Hoje, Próximos dias, Calendário por
  seleção de data e Histórico, além de uma lista paginada de resultados pendentes.
- **ADM:** visão consolidada, reuniões por SDR/closer, filtros de colaborador,
  data/status na agenda e filtros por responsável/data/situação nos retornos.
  Indicadores e funil existentes continuam disponíveis no painel.
- **Produção/Parceiro:** operações comerciais bloqueadas. Concessões expressas
  existentes mantêm sua consulta/atividades, sem conceder resultado ou agendamento.

As ações essenciais ficam visíveis nos cards: detalhes, resultado, ausência,
reagendamento, link da reunião, WhatsApp e histórico. A operação comercial usa
horários de São Paulo; timestamps são armazenados como `timestamptz`.

**Registrar resultado** reúne observações, necessidades, objeções, serviços,
proposta, próxima ação e retorno. Proposta/contrato exigem valor, serviços e prazo.
A ausência é um resultado explícito; reagendar é uma ação própria, que conserva
agendamento anterior e cria sua sucessora vinculada. O resultado possui autoria e
horário automáticos. Negociação fechada/arquivada não é regredida por agendamento.

Follow-ups são tarefas com responsável, prazo, situação e histórico. Contato sem
conclusão mantém a pendência. Concluir pode criar o próximo retorno na mesma
transação; cancelar exige motivo. Atrasados incluem horários já vencidos no próprio
dia, e não desaparecem ao arquivar um lead. Listas são paginadas: o resumo mostra
somente alguns cards e fornece acesso à lista completa.

## Migration 019

- Acrescenta link, versão e predecessor às reuniões existentes.
- `crm_meeting_results` guarda o resultado comercial sem substituir validações.
- `crm_followups` transforma a data escalar antiga em tarefas rastreáveis. Todas
  as datas anteriores são preservadas, inclusive em leads arquivados.
- `crm_commands` fornece idempotência por usuário, operação e payload. Reenvios
  concorrentes da mesma solicitação retornam o mesmo resultado.
- Atividades recebem referências opcionais à reunião e ao follow-up.
- A data antiga do lead passa a refletir o menor retorno pendente. Clientes antigos
  continuam compatíveis; apagar essa data não pode eliminar tarefas silenciosamente.
- RLS protege as novas tabelas; clientes têm somente leitura direta e mutações por
  RPCs transacionais. Versões bloqueiam alterações obsoletas. Sessões revogadas,
  responsáveis de outros leads e perfis sem função comercial são rejeitados.
- Novas FKs mantêm referências históricas, sem cascatas. A política existente de
  remoção de usuários detecta essas referências e preserva a âncora histórica.

Não se alteram fórmulas, premiações, participantes nem ativação de campanhas.
Agendamento continua possível sem campanha elegível e não gera pontos.
Resultados usam `validate_meeting`; contratos comerciais continuam dependendo da
confirmação administrativa existente para pontuação. Campanhas finalizadas não
recebem novas validações nem têm seu status histórico reescrito por resultados
comerciais posteriores. Reagendamento reavalia a elegibilidade pelo algoritmo
existente de agendamento, sem apagar a reunião anterior.

## Validação e recuperação

Antes da migration foi capturado o estado coerente de public/Auth. A cópia foi
criptografada no bucket privado de recuperação existente, baixada, descriptografada
e restaurada em PostgreSQL 17 isolado; hashes, FKs e escrita/rollback foram
verificados. O upgrade preservou todas as colunas anteriores e as datas legadas.
O replay é uma verificação isolada, não um script de reset de produção. Binários
já existentes no Storage não são alterados nem fazem parte do dump de registros.

Os testes separam claramente:

1. Testes unitários/SQL e navegador desktop/mobile com serviço HTTP de fixture.
2. Integração real no Supabase com contas técnicas novas: autenticação, agenda do
   closer, reenvios concorrentes, RLS, resultado/proposta/retorno, persistência,
   contato, conclusão encadeada, reagendamento, cancelamento e rollback.
3. Verificação das rotas autenticadas no deployment e preservação dos registros
   anteriores e dos totais do Challenger. Nenhum email externo precisa ser enviado.

As evidências privadas não incluem credenciais nos relatórios públicos. Artefatos
com sessões e cópia em texto claro são descartados ao terminar. Somente fixtures
identificadas são removidas; registros legítimos e auditoria são preservados.
