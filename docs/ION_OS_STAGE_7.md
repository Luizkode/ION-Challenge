# Etapa 7 — consolidação ION OS V1.0

## Escopo e inventário

Mesmos repositório, Supabase, Vercel e domínio. Nenhum módulo adicional, alteração de pontuação ou exclusão de histórico. O inventário estático de páginas e controles encontra-se em `ION_OS_V1_UI_INVENTORY.json`, reproduzível com `node scripts/audit-ui-inventory.mjs --output=docs/ION_OS_V1_UI_INVENTORY.json`. É um mapa de fontes; não equivale a testes executados.

| Área | Ações auditadas | Evidência automatizada e limites |
| --- | --- | --- |
| Conta e sessão | login, convite/callback, senha, logout, bloqueio de inativos | auth-callback, access-control e v1-quality; autenticação real e permissões conferidas separadamente. Entrega de email externo pendente de SMTP. |
| Dashboard | filtros, cards, gráficos e acesso aos módulos | os-foundation, v1-quality; removidos textos antigos que anunciavam módulos já implementados como futuros. |
| CRM | cadastro/edição, atividades, pesquisa, CSV, funil, agenda, negociação, arquivamento e concessões | crm.test, browser/crm; migration 012 impede que concessão de consulta/atividades altere cadastro ou arquivamento. Fluxos especializados continuam protegidos. |
| Challenger | campanha, participantes, reuniões, validação, contratos, rankings, histórico | database, participant-management, meeting-registration; regras e registros preservados. Campanha real em rascunho: cadastro legado deve informar bloqueio, sem ativação para testes. |
| Clientes e Serviços | cadastro, contratos, serviços, atribuições, publicações, upload/download | operations e analytics; Auth/PostgREST/Storage reais, dados técnicos isolados e removidos após validação. |
| Financeiro | receitas/despesas, recorrência, cobrança, comissões, liquidação/estorno, exportações | finance, finance-security e browser/finance; aceitação no banco real dentro de transação com rollback, sem lançamentos financeiros fictícios permanentes. |
| Analytics | manual/CSV, origem, filtros, gráficos, comparações, snapshots, PDFs, publicação/revogação | analytics e browser/analytics; APIs Meta/Google permanecem desativadas. |
| Equipe | convites, funções múltiplas, vínculo, ativação/desativação | access-control, team actions; paginação de pessoas e histórico de convites; SMTP externo pendente. |
| Parceiros | empresa autorizada, resultados, relatórios, serviços e documentos publicados | analytics, access-control, browser/analytics e Auth real; portal exclusivamente consultivo, sem mensagens ou edições. |
| Configurações | conta, equipe, publicações, integrações e regras existentes | página real de navegação administrativa e leitura do banco, sem controles fictícios ou preferências não persistidas. |

## Correções e refinamentos

- Formulário compartilhado com processamento acessível, bloqueio de duplo envio e mensagem de falha de rede. Campos recuperáveis ficam apenas na memória da árvore autenticada, por até cinco minutos, isolados por pessoa e formulário. Não usa localStorage, sessionStorage ou cookies; não recupera senhas, arquivos, IDs/versões ocultas ou confirmação de operações. Recarregar totalmente o navegador descarta os rascunhos.
- Erros de CRM, cliente e financeiro retornam ao formulário adequado; alterações administrativas de reuniões voltam a Reuniões. A confirmação continua explícita e é desmarcada ao recuperar um formulário.
- Downloads/importações/funil tratam falhas de conexão sem simular sucesso. Upload concluído limpa a seleção do arquivo. Movimentações especializadas do funil remetem aos formulários corretos.
- Menu mobile expansível, fechamento por Escape/navegação, foco visível, link para pular ao conteúdo e logout disponível no celular. Logout encerra a sessão local e remove os cookies locais mesmo se o serviço estiver indisponível.
- Mesma identidade escura/roxa, fonte e componentes: cards proporcionais, formulários alinhados, textarea padronizada, contraste de botões/textos, tabelas navegáveis por teclado e rolagem contida, áreas de toque e movimento reduzido.
- Cache React restrito à renderização da requisição evita repetir a carga de sessão/permissões entre layout, página e resumos. Nenhum cache compartilhado de dados protegidos. Polling de 15 segundos fica restrito ao Challenger; atualizações não interrompem formulários em edição nem páginas ocultas.
- Paginação de reuniões, validações, histórico, equipe, convites e auditoria; filtros inválidos de reunião exibem mensagem. As listas de Analytics/Financeiro/Clientes/CRM mantêm suas paginações existentes. Relatórios/agregações continuam usando os dados autorizados, não somente a página exibida.

## Banco e recuperação

Migration `012_crm_edit_scope.sql`, transacional e sem reescrever registros. Helper privado e trigger garantem que só administrador ou SDR/closer responsável altere o cadastro e arquive/restaure leads. Concessões de consulta e registro de atividades continuam funcionando. A proteção vale também para os RPCs existentes; nenhuma política RLS é flexibilizada.

Antes da aplicação: cópia criptografada de public/Auth/schema 001–011, 64 tabelas/867 registros, restaurada em PostgreSQL 17; hashes, FKs, sequências e escrita auditada com rollback conferidos. Bundle privado e chave cifrada separada. Não confundir com PITR gerenciado. Migração ensaiada na cópia, aplicada no projeto existente e registros anteriores conferidos. Checks em `supabase/checks/stage_7_security.sql`. Não reaplicar 012.

## Validação e continuidade

Executar `npm test`, `npm run typecheck` e `npm run test:browser`. A matriz visual cobre 1920, 1366, 768, 430 e 320 px em treze rotas; a matriz completa roda uma vez, além dos testes desktop/mobile. Axe verifica tags WCAG 2/2.1/2.2 AA em login e áreas administrativas. Isso não é certificação de acessibilidade nem substitui avaliação humana com tecnologias assistivas.

Estados de erro e reconexão, cancelamento de confirmação, persistência e permissões têm testes específicos. As fixtures de interface não substituem a validação dos serviços reais. Resultados finais e identificadores de deployment são registrados separadamente no relatório privado de implantação. Dados técnicos são removidos, preservando a auditoria e comparando os registros originais.

## Pendência externa aceita

O Supabase atual utiliza o envio padrão, sem SMTP próprio; não há credenciais SMTP no ambiente. O usuário orientou concluir os demais ajustes e registrar a pendência. Para liberar convites a usuários externos com confiabilidade, configurar um provedor em Authentication → Email → SMTP Settings e verificar recebimento com uma caixa autorizada. Nunca solicitar ou inserir senhas/chaves no chat ou em variáveis públicas. Fluxos Auth existentes e validação de permissões não comprovam entrega em uma caixa de email.

Meta Ads/Google Ads continuam aguardando credenciais e aprovação específicas, conforme Etapa 6. Cadastro manual, CSV, relatórios e portal operam independentemente dessas integrações.
