# ION OS · Etapa 3 — CRM Comercial

O módulo `/crm` utiliza a sessão, os componentes e o mesmo Supabase da plataforma. Não usa service role no fluxo comercial. Todas as operações passam por RPCs com autenticação, autorização e auditoria no PostgreSQL; leituras observam RLS.

## Operação

- ADM e SDR cadastram leads; o SDR é obtido da sessão no banco. Só ADM atribui outro SDR ou troca o closer de um cadastro existente.
- Lista pesquisável por empresa, contato, WhatsApp ou email; filtros por responsável e etapa; ordenação por criação, empresa ou follow-up; paginação de 40 leads. Arquivar preserva o histórico.
- Funil com dez etapas e movimentação por arrastar ou seletor acessível no celular. Etapas que dependem de reunião, validação ou negociação usam os respectivos formulários, impedindo resultados fictícios.
- Abordagens, respostas, canais e follow-ups ficam na linha do tempo, com autor e data. Edições e atividades com versão desatualizada exigem recarregar a página.
- CSV UTF-8 com vírgula ou ponto e vírgula, aspas e quebras de linha. Até 500 leads/2 MB, prévia de 20 linhas e confirmação explícita. Campos obrigatórios: `company,contact,phone,niche,city,state,source`; opcionais: `email,closer_id,notes`. ADM escolhe o SDR; para SDR, o banco sempre usa o usuário autenticado. A importação é uma única transação e conflitos de telefone/email desfazem todas as linhas.
- Closer registra propostas, serviços, prazo, negociação e resultado nas oportunidades atribuídas. Fechamento comercial não é confirmação de pontos: o ADM confirma o contrato após reunião válida.
- Colaboradores não comerciais e parceiros não acessam o CRM. ADM pode conceder e revogar consulta global e registro de atividades para um colaborador; isso não concede agendamento, fechamento, validação, administração ou acesso ao Challenger.

## Integração e migração

Aplicar **somente `supabase/migrations/004_commercial_crm.sql` após 003**, com recuperação verificada. Não reaplicar 001–003. A migração é transacional e incremental, adiciona quatro tabelas CRM, funções, índices, políticas e a relação `opportunities.crm_lead_id`.

`meetings`, `meeting_validations` e `contracts` continuam sendo os registros oficiais compartilhados. Não há tabela paralela de reuniões nem escrita direta em pontos. Uma oportunidade pode existir sem campanha/time exclusivamente quando vinculada a um lead do CRM; o ranking continua usando apenas oportunidades com campanha. O feed de competição ignora operações sem campanha.

O agendamento vincula a campanha atualmente ativa somente se o SDR for participante ativo e a data estiver no período. Sem elegibilidade, agenda normalmente sem campanha e sem pontos. Se já existir oportunidade com o mesmo telefone na campanha e o mesmo SDR, ela é vinculada em vez de duplicada. Conflitos entre responsáveis exigem revisão administrativa. Reuniões do mesmo lead/horário não são duplicadas.

A validação continua usando `validate_meeting`. A confirmação usa `admin_operation('contract',...)`, preservando comparecimento, datas, restrições administrativas e pontuação máxima por oportunidade. Fechamento e confirmação são vinculados atomicamente. Reuniões históricas continuam acessíveis pelas rotas do Challenger; não são copiadas nem reescritas pela migração.

## Indicadores

`crm_report` é SECURITY INVOKER e obedece às RLS, sem limite de página. O Dashboard incorpora leads, contatos e fechamentos autorizados. Filtros por período usam Brasília: criação para leads, registro para atividades/propostas/fechamentos, agendamento para reuniões.

Resposta = leads respondidos entre os contatados no período / leads contatados. Comparecimento = realizadas / (realizadas + ausências). Conversão = leads criados no período com fechamento registrado no período / leads criados no período. Propostas e fechamentos contam leads distintos. Não representam receita recebida. A agenda exibe até 200 reuniões por período; os indicadores continuam completos. O funil mostra a página atual; detalhes apresentam até 200 atividades, reuniões e negociações recentes.

## Validação e implantação

- `npm test`: regras, CSV, RLS, importação atômica, isolamento por responsável, desativação, controle de versão, pontuação e upgrade sobre registros antigos.
- `npm run test:browser`: aplicação compilada, desktop e celular, CRM e regressão das Etapas 1 e 2. A fixture HTTP verifica interface; não substitui validação nos serviços reais.
- `npm run typecheck` e `npm run build`.
- `supabase/checks/stage_2_security.sql` e `stage_3_security.sql`: ACLs, RLS e integridade.
- Antes da produção: cópia real `public`/`auth`, restauração PostgreSQL17, comparação de registros, download e decriptação do arquivo remoto com chave protegida. Migração ensaiada nessa cópia e comparação dos registros históricos dentro da transação de produção.

Nenhuma variável nova do aplicativo é necessária: reutilizar URL/anon, service role exclusivamente no servidor e endereço do ION OS já configurados. O CRM não depende de envio de email nem altera SMTP, autenticação ou os módulos futuros.
