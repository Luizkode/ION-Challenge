# ION OS — Etapa 2: usuários, funções e permissões

A arquitetura vigente usa o Supabase, a aplicação Vercel, a autenticação e o repositório existentes. Não é obrigatório criar homologação separada. O procedimento de implantação e recuperação está em [DEPLOY_EXISTING_PLATFORM.md](DEPLOY_EXISTING_PLATFORM.md); ele substitui as exigências anteriores de outro projeto.

## Entrega

O ION OS passa a distinguir Administrador, Colaborador e Parceiro. Colaboradores podem combinar SDR, Closer, Gestor de Tráfego, Designer, Editor de Vídeo e Copywriter. A categoria/funções são consultadas no banco a cada sessão/operação, sem confiar em campos do formulário ou cargos no JWT. Uma conta Auth desativada no perfil não mantém acesso aos dados protegidos, mesmo com token ainda válido.

`/team` é a central administrativa de acessos: lista usuários, convida por email, altera funções, ativa/desativa, vincula clientes/empresas e mostra o histórico dos convites. Há um cadastro mínimo de empresas para esses vínculos; não é o módulo operacional de Clientes e Serviços. Contas Auth já existentes podem ser vinculadas por UUID sem alterar senha.

O menu combina as funções. SDR/Closer têm recursos comerciais; acesso ao Challenger depende de função e, para SDR, participação ativa (inclusive vínculos históricos válidos). Closer mantém acesso às validações atribuídas. Produção não recebe agendamentos comerciais e é bloqueada também por URL/RPC. Tráfego pode abrir Analytics, ainda com estado informativo. Financeiro, Equipe e Configurações globais permanecem exclusivos de admins.

O parceiro entra em `/partners`, vê somente as empresas vinculadas e estados vazios para serviços/relatórios futuros. Não há aprovações, pedidos, mensagens ou escrita operacional. `/account` é apenas a configuração da própria senha, necessária ao convite; não amplia acesso aos módulos. CRM, serviços, relatórios, arquivos e financeiro completo continuam para as próximas etapas.

A fórmula do Challenger, IDs Auth/profiles, oportunidades, reuniões, contratos, históricos e pesos não são substituídos. A função legada `role` é preservada como projeção de compatibilidade: admin, SDR prioritário, depois closer, member ou partner. A fonte das funções combinadas é `user_functions`, e `category` identifica a categoria. Trocar a função SDR exige remoção explícita da campanha quando houver participação; ambas as operações são atômicas e auditadas. Vínculos com clientes e funções anteriores ficam na auditoria, sem apagar os registros comerciais.

## Migration incremental

Arquivo: `supabase/migrations/003_access_control.sql`.

1. Use o projeto Supabase atual. Inspecione o schema com o inventário somente de leitura e confirme backup/recuperação antes de solicitar autorização de produção.
2. A 003 depende da 002. A inspeção REST do projeto atual encontrou colunas da 002/003 ausentes; confirme o catálogo SQL. Aplique somente as migrations pendentes. **Não reaplique a 001 nem migrations já existentes.**
3. Após autorização, use o release SQL preparado para a versão de origem confirmada. O gerador reúne 002/003 pendentes e checks numa única transação. Não execute trechos aleatórios; os arquivos não são idempotentes.
4. Confira `profiles.category`, as funções migradas em `user_functions`, `access_companies`, `client_assignments`, `partner_companies` e `access_invitations`. Usuários legados SDR/closer mantêm suas funções e UUIDs. O bootstrap antigo continua compatível por trigger; não refaça bootstrap se já há admin.
5. Faça backup/snapshot conforme o procedimento do projeto antes de qualquer aplicação definitiva. A migration não exclui tabelas comerciais ou usuários e não troca IDs.
6. Disponibilize o código atualizado no projeto Vercel atual depois de preparar o schema e obter autorização de produção. O novo código depende da RPC `current_access`; sem 003 ele falha fechado, em vez de conceder acesso por fallback.

A 003 amplia a restrição de `profiles.role`, adiciona categoria e relações novas, protege todas com RLS e revoga escrita direta de `anon`/`authenticated`. Operações administrativas continuam por RPC com verificação do admin ativo, confirmação, justificativa e lock transacional. Os entry points antigos ficam privados para não contornar as novas verificações. Alterações de acesso e vínculos geram auditoria com autor, antes/depois, horário e justificativa.

`access_companies` contém somente identidade mínima; não há finanças ou notas internas nessa tabela. Funcionários leem apenas atribuições próprias, parceiros somente vínculos próprios; a política da empresa verifica vínculo e perfil ativo. Contratos financeiros comerciais atuais continuam visíveis apenas a admins. Os módulos futuros precisarão ligar suas próprias tabelas ao mesmo isolamento por empresa; criar um cliente não libera automaticamente módulos ainda não implementados.

## Convites: configuração segura

O mecanismo usa `Supabase Auth admin.inviteUserByEmail` dentro de uma Server Action, depois de validar a sessão/admin e os dados. Não há signup público nem senha em texto puro. A chave administrativa não é retornada, logada ou incluída em componentes cliente.

Configure no **servidor** (na Vercel, por ambiente):

- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto correspondente ao ambiente.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave pública anon do mesmo projeto.
- `SUPABASE_SERVICE_ROLE_KEY`: chave administrativa do mesmo projeto, em variável privada. **Nunca** criar `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` nem colocar chave em código/chat.
- `ION_OS_APP_URL`: URL HTTPS da aplicação desse ambiente, sem credenciais. Ex.: a URL de Preview autorizada; para desenvolvimento local é aceito `http://localhost:3000`. Na Vercel, `VERCEL_URL` é alternativa automática se `ION_OS_APP_URL` não existir, mas uma URL estável por ambiente facilita o controle dos callbacks.
Não há Project Ref adicional obrigatório. `ION_OS_PREVIEW_SUPABASE_PROJECT_REF` não é mais lido. A validação protege a chave pública e a coerência URL/JWT, permitindo reutilizar o projeto atual tanto em Preview quanto em Production. Preview com esse banco compartilha dados; não executar a suíte automatizada ou testes de escrita contra ele sem autorização.

No Supabase existente, após inspeção e autorização para eventuais mudanças:

1. Preserve o provedor Email. O diagnóstico atual mostrou signup público habilitado; desativá-lo para usar somente convites é uma alteração de configuração que deve ser aprovada.
2. Preserve Site URL/domínio atual. Confira o callback exato `https://DOMINIO_ATUAL/auth/callback` e adicione apenas se necessário e autorizado.
3. Em Email Templates → Invite user, use o link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`. O servidor envia `RedirectTo` com `/auth/callback`; o destino deve ser o endereço autorizado da mesma aplicação existente. Para recuperação pelo operador, use o tipo `recovery` correspondente.
4. Reutilize o SMTP/envio existente se funcional e respeite os limites do Supabase; configure algo novo somente se necessário e autorizado. O retorno do endpoint confirma aceitação do pedido, não entrega na caixa postal.
5. Entre como admin, cadastre uma empresa de teste e convide colaborador ou parceiro. Selecione funções/vínculos, justifique e confirme. A pessoa abre o link, estabelece sessão em `/account` e define sua senha.

O pedido de convite e o vínculo são auditados. Email e PostgreSQL não formam uma transação distribuída: se o email for enviado mas a configuração de perfil falhar, o usuário não recebe permissões novas sem perfil ativo configurado. A tela informa a falha e o UUID para reparo; use o painel Supabase Auth para identificar a conta e o formulário “Vincular conta Auth já existente / concluir convite”. Nunca excluímos automaticamente uma conta Auth existente para compensar uma falha. O histórico mantém tentativas pendentes/falhas; não há reenvio automático para evitar duplicar emails. O histórico representa o resultado do fluxo original, inclusive quando a recuperação foi feita manualmente.

## Como testar

Use PGlite/fixture local para escritas automatizadas. No banco central, execute os cenários com contas/destinatários e escopo de escrita aprovados, após verificar recuperação; não crie campanhas de teste ou altere resultados reais sem aprovação.

1. Confirme o login do admin existente e a mesma campanha/ranking no Challenger.
2. Crie empresas A e B. Convide produção (traffic ou designer) e atribua somente A. Confira dashboard próprio e a ausência de B. Acesse `/meetings/new`, `/validation`, `/admin`, `/team` e `/finance` por URL: o acesso deve ser bloqueado.
3. Configure SDR + Closer + Tráfego em uma conta. Confira a união dos menus, a disponibilidade como closer e a possibilidade de validar reunião de outro SDR atribuída a ela. A validação da própria reunião continua proibida. Contrato só é confirmado por admin; 1/3/7 não somam 11.
4. Convide parceiro vinculado somente a B. Confira entrada em `/partners`, apenas B, ausência dos demais módulos e negação de escrita. Tente URLs comerciais e API de outra empresa: não deve obter dados.
5. Desative uma conta mantendo a sessão antiga aberta: na próxima operação, os dados/RPCs devem estar bloqueados. A UI atualiza por refresh/polling; não se apaga conteúdo que já foi recebido antes da desativação.
6. Teste retirada de SDR de campanha com histórico junto à troca de função: exige confirmação explícita e conserva registros. Falha em uma etapa desfaz a operação inteira.
7. Tente desativar/rebaixar o último admin ativo: negado. O admin também não remove seu próprio acesso pela aplicação.
8. Execute `npm test`, `npm run build`, `npm run typecheck` e `npm run test:browser`. As regras SQL são testadas em PostgreSQL PGlite, inclusive upgrade de banco preenchido; navegador usa Auth/REST exclusivo de teste. Entrega real de email/Auth/Realtime hospedado exige validar os serviços existentes, com autorização para eventuais escritas.

## Arquivos

- `supabase/migrations/003_access_control.sql`: migration, backfill, funções, auditoria e RLS.
- `lib/access.ts`, `lib/access-input.ts`, `lib/session.ts`, `lib/os-modules.ts`: tipos, validação e permissões por categoria/função.
- `app/team-actions.ts`: convites Auth e alterações administrativas no servidor.
- `app/(private)/team/page.tsx`, `components/access-fields.tsx`: gestão de usuários e vínculos.
- `app/(private)/partners/page.tsx`, `app/(private)/clients/page.tsx`, `app/(private)/account/page.tsx`: leitura autorizada e definição de senha.
- Layout, navegações e rotas comerciais existentes: guardas server-side, funções combinadas e menu contextual; sem troca de CSS/paleta/componentes.
- `app/auth/callback/route.ts`: convite encaminha à conta para definir senha.
- Testes SQL, permissões, convites e navegação; fixture Auth privada de testes e configuração Playwright.

A Etapa 2 não foi publicada nem aplicada ao Supabase de produção. Não há merge automático na main. Módulos operacionais de CRM, serviços, financeiro, Analytics e portal completo continuam pendentes das próximas etapas.

## Validação desta entrega

- `npm test`: 62 testes aprovados após a revisão, incluindo upgrades desde 001/002, rollback integral e recuperação local.
- `npm run test:browser -- --max-failures=1`: 50 testes aprovados (desktop e celular), também com o build de produção local. O Playwright agora compila e inicia a aplicação antes da suíte, sem HMR. Um erro interno de roteador observado no cenário de falha simulada em desenvolvimento não se repetiu no build de produção.
- `npm run build` e `npm run typecheck`: aprovados.
- Testes SQL em PGlite e navegador com Auth/REST simulado isolado; nenhum teste de escrita em produção. Entrega real dos convites e integração hospedada permanecem pendentes de acesso e autorização na infraestrutura existente.

## Auditoria e implantação incremental no projeto atual

A ordem de dependências é 001 → 002 → 003. A 001 só pertence à criação original e não deve ser reaplicada em um banco existente. A 002 acrescenta remoção lógica e torna privada a operação administrativa anterior. A 003 depende dessas colunas e renomeações, mantém IDs/FKs e registros comerciais, migra funções e preserva os UUIDs Auth. Não há migration 004.

A auditoria local verificou RLS, ACLs, vínculos Auth/perfis, isolamento por empresa, bloqueio de inativos, união de funções, último admin, transações e auditoria. O release único acrescenta verificação de origem e rollback integral, inclusive se os checks finais falharem. Os testes com snapshot/restauração local não certificam o backup real hospedado.

O catálogo e o backup do projeto atual ainda exigem inspeção autorizada. Siga [o plano de implantação e recuperação](DEPLOY_EXISTING_PLATFORM.md), incluindo a janela de atualização coordenada do schema e do código, sem outro Supabase ou aplicação Vercel. Não excluir tabelas/colunas como rollback nem restaurar a 001 por cima do banco.

## Estado externo da finalização

O PR consolidado é https://github.com/Luizkode/ION-Challenge/pull/3. A fundação da Etapa 1 já está incluída nessa branch; não é necessário reconstruir a aplicação nem manter outro fluxo independente.

As tentativas anteriores de Preview falharam, e o acesso a logs retornou HTTP 403 sem credencial de gestão. A exigência de Supabase separado foi removida; consulte o status atual no PR. Build bem-sucedido não confirma funcionamento das páginas privadas enquanto `current_access()` estiver ausente do banco atual.

A inspeção pública somente de leitura identificou a estrutura original e ausência de objetos da 002/003 na API, além de signup público habilitado. Não houve escrita remota, alteração de Auth/SMTP, migration de produção ou merge. Credenciais de gestão ainda não estão disponíveis no ambiente. O catálogo e a recuperação devem ser confirmados antes de pedir a liberação da atualização de produção.
