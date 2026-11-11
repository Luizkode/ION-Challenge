> Atualização 020: campanhas SDR usam participação automática por função e ativação, com histórico encerrado/finalizado preservado. Veja [a política atual](ION_CHALLENGER_AUTOMATIC_PARTICIPATION.md).

# Administração simplificada do ION OS

## Uso diário

Em **Equipe**, cada conta operacional mostra nome, email real do Auth, categoria,
funções, empresas vinculadas, situação e último acesso disponível. Identificadores
históricos não aparecem como colaboradores. O diretório de Auth é exclusivo do ADM
e retorna uma lista explícita de campos: nunca hashes, senhas ou tokens.

- **Editar usuário** permite alterar nome, categoria, funções e empresas. Nome não
  exige confirmação adicional; alterações de acesso recebem uma confirmação única.
  A auditoria é automática e não exige justificativa rotineira.
- **Ativar/Desativar acesso** sincroniza a situação com o Auth. Desativação bloqueia
  novos logins e revoga sessões, preservando os registros.
- **Redefinir acesso** oferece email de recuperação, reenvio de convite pendente e
  revogação de sessões. Senhas atuais não são exibidas ou recuperadas.
- **Remover usuário → Remover definitivamente** são as duas interações necessárias.
  O diálogo informa a conta e o efeito irreversível. Não há campo de UUID,
  justificativa, escolha técnica de retenção nem segunda confirmação adicional.

Cadastro público continua desabilitado. A senha continua sendo definida/alterada
pelo próprio usuário usando o Auth. Não se implementou senha temporária exibida
no painel, pois os links de uso único e com expiração atendem ao fluxo.

## Política automática de remoção

A confirmação cria uma operação persistente e auditável. Na mesma transação de
preparação, o perfil perde acesso, o Auth é bloqueado para novos logins, sessões e
refresh tokens são revogados e a propriedade pessoal de arquivos é encerrada.
Nenhum arquivo ou contrato é apagado para resolver dependências.

A exclusão do Auth aplica a política abaixo e conclui o ledger na mesma transação:

| Relação | Tratamento |
| --- | --- |
| Auth, sessões, identidades e MFA | Remoção pelo mecanismo administrativo do Supabase |
| Funções, concessões, empresas pessoais e atribuições de serviço | Vínculos pessoais removidos, com auditoria |
| Participação em campanha ainda não finalizada | Encerrada automaticamente; histórico e pontuações anteriores não são apagados |
| Campanhas finalizadas e resultados | Vínculos históricos e valores preservados; nome anonimizado |
| CRM, reuniões, contratos, lançamentos e autoria | Registros preservados com UUID histórico estável |
| Regras financeiras individuais futuras | Desativadas; lançamentos e liquidações anteriores preservados |
| Storage | Conteúdo, caminhos e metadados comerciais preservados; proprietário pessoal passa a ser institucional, sob as mesmas políticas de acesso |
| Auditoria e histórico de convites | Evidências e referências originais preservadas conforme retenção |

Quando não há referência histórica necessária, o registro de `profiles` é
fisicamente eliminado. Quando existe referência necessária, deixa de existir um
perfil operacional: a linha de compatibilidade em `profiles` fica inativa, sem
Auth, com nome anônimo e `is_historical=true`, registrada em `historical_actors`.
Essa âncora mantém as FKs e documentos imutáveis no mesmo UUID, sem reescrever
valores financeiros nem reatribuir contratos a outro colaborador. Não pode ser
reativada, receber permissões ou aparecer na Equipe.

Essa anonimização cadastral não elimina dados pessoais de documentos e snapshots
anteriores sujeitos à retenção. Não se afirma eliminação integral de dados legais.
Os registros financeiros e comerciais legítimos não são excluídos em cascata.

A conta do próprio ADM e o último ADM ativo continuam protegidos no banco. As
permissões são verificadas novamente antes da execução, inclusive pelo worker.
Uma solicitação cujo administrador perde autoridade é encerrada sem excluir a
conta. Não se restauram permissões automaticamente após falha.

## Falhas e execução automática

As operações são idempotentes. Uma falha de rede mantém o acesso bloqueado e o
estado em processamento; a interface consulta novamente sem exigir novos passos.
A página administrativa também agenda o processamento protegido de pendências.
Há uma execução diária de recuperação no mesmo projeto Vercel, às 05h de São
Paulo (`0 8 * * *` UTC), sem criar outro serviço ou projeto. O endpoint aceita
somente o segredo de cron do servidor e não retorna informações de usuários.
Falhas de configuração retornam indisponibilidade, sem anunciar sucesso vazio.

Revogar sessões exige mais do que apagar cookies: JWTs antigos podem continuar
criptograficamente válidos até expirar. `live_auth_session()` consulta a sessão
ativa do Auth; políticas restritivas em todas as tabelas públicas e guardas dos
RPCs impedem que um JWT revogado continue acessando dados. Novos RPCs devem usar
os mesmos guardas centrais, preservando a autorização por empresa e módulo.

## Processos revistos

| Módulo | Simplificação / proteção mantida |
| --- | --- |
| CRM | Origem pré-preenchida, closer único sugerido e responsável inferido; telefone, titularidade e concorrência continuam validados |
| Challenger | Uma confirmação nas ações administrativas; ativação, período, validação do closer e regras de pontuação preservados |
| Clientes e Serviços | Atualização interna opcional em mudanças de status; descrição automática e data atual sugerida na conclusão; permissões e controle de versão mantidos |
| Financeiro | Eliminada a duplicação checkbox + diálogo; confirmação única, valores, saldo, idempotência e justificativa de estorno/renegociação mantidos |
| Analytics | Publicação auditada automaticamente, sem justificativa repetitiva; confirmação de exposição e indicadores autorizados mantidos |
| Equipe | Diretório completo, edição objetiva, bloqueio/revogação e remoção em dois cliques |
| Parceiros | Mesmo portal e isolamento; publicações continuam dependendo de autorização administrativa |
| Configurações | Mesma estrutura e identidade; ações sensíveis mantêm confirmação e integrações externas não configuradas não são anunciadas como funcionais |

## Recuperação de acesso e emails

O envio administrativo de redefinição usa um cliente anon dedicado, sem cookies
ou verificador PKCE do ADM. Isso permite abrir o email em outro navegador sem
perder a recuperação. O callback continua aceitando os mecanismos oficiais do
Supabase e remove credenciais da URL antes de prosseguir.

SMTP próprio foi observado no projeto existente. Os testes externos usam somente
aliases autorizados pelo proprietário, preservando sua conta principal. A API
aceitar um email não comprova entrega: recebimento e primeiro acesso são
registrados separadamente. Nenhum link, token ou senha integra o relatório.

## Banco, implantação e testes

Migrations incrementais: `015_admin_simplification.sql`,
`016_retirement_minimal_retention.sql`, `017_removal_queue_authority.sql` e
`018_retirement_storage_owner.sql`.
Foram verificadas sobre restauração do estado atual antes da aplicação, com cópia
coerente e criptografada de public/Auth, download e descriptografia do objeto
remoto, conferência de hashes e validação de FKs em PostgreSQL 17 isolado.
O pacote de replay é para validação isolada, não para resetar produção. Binários
do Storage não são alterados pela migration nem fazem parte do dump de registros.

As validações distinguem testes de interface com serviço simulado dos testes
reais de Auth, RLS, arquivos e persistência. Contas técnicas novas cobrem remoção
com CRM, campanha ativa, campanha finalizada, contratos, financeiro e Storage;
revogação de JWT; múltiplas funções; recuperação de uso único e novo login. A
campanha existente não é ativada, encerrada ou reconfigurada pelos testes.

Não é necessário outro Supabase, outra aplicação Vercel ou outro endereço. As
credenciais administrativas e `CRON_SECRET` permanecem protegidas no servidor.
Nenhuma conta original é selecionada para exclusão durante a validação.

No aceite desta entrega, o destinatário autorizado confirmou o recebimento do
convite e da redefinição. O Auth confirmou a ativação, definição da senha e
primeiro acesso da conta de convite; a redefinição da outra conta foi concluída
pelo destinatário. Os testes não alteraram a conta principal. Links e credenciais
não são incluídos neste documento.

A propriedade atual do Storage (`owner_id`) prevalece sobre o campo legado
`owner`: uma referência antiga do usuário removido é limpa sem retirar a
propriedade atual de outro colaborador. A regra foi validada com a API real,
conteúdo binário preservado e contas técnicas novas.
