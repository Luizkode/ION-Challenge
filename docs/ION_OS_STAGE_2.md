# ION OS — Etapa 2: usuários, funções e permissões

## Entrega

O ION OS passa a distinguir Administrador, Colaborador e Parceiro. Colaboradores podem combinar SDR, Closer, Gestor de Tráfego, Designer, Editor de Vídeo e Copywriter. A categoria/funções são consultadas no banco a cada sessão/operação, sem confiar em campos do formulário ou cargos no JWT. Uma conta Auth desativada no perfil não mantém acesso aos dados protegidos, mesmo com token ainda válido.

`/team` é a central administrativa de acessos: lista usuários, convida por email, altera funções, ativa/desativa, vincula clientes/empresas e mostra o histórico dos convites. Há um cadastro mínimo de empresas para esses vínculos; não é o módulo operacional de Clientes e Serviços. Contas Auth já existentes podem ser vinculadas por UUID sem alterar senha.

O menu combina as funções. SDR/Closer têm recursos comerciais; acesso ao Challenger depende de função e, para SDR, participação ativa (inclusive vínculos históricos válidos). Closer mantém acesso às validações atribuídas. Produção não recebe agendamentos comerciais e é bloqueada também por URL/RPC. Tráfego pode abrir Analytics, ainda com estado informativo. Financeiro, Equipe e Configurações globais permanecem exclusivos de admins.

O parceiro entra em `/partners`, vê somente as empresas vinculadas e estados vazios para serviços/relatórios futuros. Não há aprovações, pedidos, mensagens ou escrita operacional. `/account` é apenas a configuração da própria senha, necessária ao convite; não amplia acesso aos módulos. CRM, serviços, relatórios, arquivos e financeiro completo continuam para as próximas etapas.

A fórmula do Challenger, IDs Auth/profiles, oportunidades, reuniões, contratos, históricos e pesos não são substituídos. A função legada `role` é preservada como projeção de compatibilidade: admin, SDR prioritário, depois closer, member ou partner. A fonte das funções combinadas é `user_functions`, e `category` identifica a categoria. Trocar a função SDR exige remoção explícita da campanha quando houver participação; ambas as operações são atômicas e auditadas. Vínculos com clientes e funções anteriores ficam na auditoria, sem apagar os registros comerciais.

## Migration incremental

Arquivo: `supabase/migrations/003_access_control.sql`.

1. Use primeiro um projeto Supabase de homologação separado, sem dados/senhas de produção.
2. Confirme que 001 e 002 já foram aplicadas. Em um projeto novo, aplique 001, depois 002 e então 003. Em um projeto existente, **não reaplique 001/002**.
3. No SQL Editor, execute todo o arquivo 003 uma vez como operador autorizado. Ele usa `BEGIN`/`COMMIT`: falhas não devem ser tratadas executando trechos aleatórios. O arquivo não é idempotente.
4. Confira `profiles.category`, as funções migradas em `user_functions`, `access_companies`, `client_assignments`, `partner_companies` e `access_invitations`. Usuários legados SDR/closer mantêm suas funções e UUIDs. O bootstrap antigo continua compatível por trigger; não refaça bootstrap se já há admin.
5. Faça backup/snapshot conforme o procedimento do projeto antes de qualquer aplicação definitiva. A migration não exclui tabelas comerciais ou usuários e não troca IDs.
6. Disponibilize o código atualizado somente depois de preparar a homologação. O novo código depende da RPC `current_access`; sem 003 ele falha fechado, em vez de conceder acesso por fallback.

A 003 amplia a restrição de `profiles.role`, adiciona categoria e relações novas, protege todas com RLS e revoga escrita direta de `anon`/`authenticated`. Operações administrativas continuam por RPC com verificação do admin ativo, confirmação, justificativa e lock transacional. Os entry points antigos ficam privados para não contornar as novas verificações. Alterações de acesso e vínculos geram auditoria com autor, antes/depois, horário e justificativa.

`access_companies` contém somente identidade mínima; não há finanças ou notas internas nessa tabela. Funcionários leem apenas atribuições próprias, parceiros somente vínculos próprios; a política da empresa verifica vínculo e perfil ativo. Contratos financeiros comerciais atuais continuam visíveis apenas a admins. Os módulos futuros precisarão ligar suas próprias tabelas ao mesmo isolamento por empresa; criar um cliente não libera automaticamente módulos ainda não implementados.

## Convites: configuração segura

O mecanismo usa `Supabase Auth admin.inviteUserByEmail` dentro de uma Server Action, depois de validar a sessão/admin e os dados. Não há signup público nem senha em texto puro. A chave administrativa não é retornada, logada ou incluída em componentes cliente.

Configure no **servidor** (na Vercel, por ambiente):

- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto correspondente ao ambiente.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave pública anon do mesmo projeto.
- `SUPABASE_SERVICE_ROLE_KEY`: chave administrativa do mesmo projeto, em variável privada. **Nunca** criar `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` nem colocar chave em código/chat.
- `ION_OS_APP_URL`: URL HTTPS da aplicação desse ambiente, sem credenciais. Ex.: a URL de Preview autorizada; para desenvolvimento local é aceito `http://localhost:3000`. Na Vercel, `VERCEL_URL` é alternativa automática se `ION_OS_APP_URL` não existir, mas uma URL estável por ambiente facilita o controle dos callbacks.
- `ION_OS_PREVIEW_SUPABASE_PROJECT_REF`: obrigatório no ambiente **Preview**, com o identificador público do projeto separado de homologação. O build e as conexões no servidor/proxy falham se a URL não corresponder. JWTs anon legados também precisam corresponder ao ref. Chaves `sb_secret_`/service_role são rejeitadas na variável pública em qualquer ambiente. A trava confirma consistência da configuração, não identifica sozinha se o operador escolheu um projeto de produção: confirme o ref no painel antes de configurar.

Na homologação Supabase:

1. Em Authentication, desative signup público e mantenha o provedor Email.
2. Em URL Configuration, cadastre o callback exato `https://DOMINIO_DO_AMBIENTE/auth/callback`. Não aponte um Preview para Site URL/credenciais de produção.
3. Em Email Templates → Invite user, use o link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`. O servidor envia `RedirectTo` com `/auth/callback`; não use Site URL fixo de produção nos convites de homologação. Para recuperação pelo operador, use o tipo `recovery` correspondente.
4. Configure SMTP autorizado para entrega real e respeite os limites do Supabase. O retorno do endpoint confirma aceitação do pedido, não entrega na caixa postal.
5. Entre como admin, cadastre uma empresa de teste e convide colaborador ou parceiro. Selecione funções/vínculos, justifique e confirme. A pessoa abre o link, estabelece sessão em `/account` e define sua senha.

O pedido de convite e o vínculo são auditados. Email e PostgreSQL não formam uma transação distribuída: se o email for enviado mas a configuração de perfil falhar, o usuário não recebe permissões novas sem perfil ativo configurado. A tela informa a falha e o UUID para reparo; use o painel Supabase Auth para identificar a conta e o formulário “Vincular conta Auth já existente / concluir convite”. Nunca excluímos automaticamente uma conta Auth existente para compensar uma falha. O histórico mantém tentativas pendentes/falhas; não há reenvio automático para evitar duplicar emails. O histórico representa o resultado do fluxo original, inclusive quando a recuperação foi feita manualmente.

## Como testar

1. Confirme o login do admin existente e a mesma campanha/ranking no Challenger.
2. Crie empresas A e B. Convide produção (traffic ou designer) e atribua somente A. Confira dashboard próprio e a ausência de B. Acesse `/meetings/new`, `/validation`, `/admin`, `/team` e `/finance` por URL: o acesso deve ser bloqueado.
3. Configure SDR + Closer + Tráfego em uma conta. Confira a união dos menus, a disponibilidade como closer e a possibilidade de validar reunião de outro SDR atribuída a ela. A validação da própria reunião continua proibida. Contrato só é confirmado por admin; 1/3/7 não somam 11.
4. Convide parceiro vinculado somente a B. Confira entrada em `/partners`, apenas B, ausência dos demais módulos e negação de escrita. Tente URLs comerciais e API de outra empresa: não deve obter dados.
5. Desative uma conta mantendo a sessão antiga aberta: na próxima operação, os dados/RPCs devem estar bloqueados. A UI atualiza por refresh/polling; não se apaga conteúdo que já foi recebido antes da desativação.
6. Teste retirada de SDR de campanha com histórico junto à troca de função: exige confirmação explícita e conserva registros. Falha em uma etapa desfaz a operação inteira.
7. Tente desativar/rebaixar o último admin ativo: negado. O admin também não remove seu próprio acesso pela aplicação.
8. Execute `npm test`, `npm run build`, `npm run typecheck` e `npm run test:browser`. As regras SQL são testadas em PostgreSQL PGlite, inclusive upgrade de banco preenchido; navegador usa Auth/REST exclusivo de teste. Entrega real de email/Auth/Realtime hospedado exige conferir o projeto de homologação após configurá-lo.

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

- `npm test`: 60 testes aprovados após a auditoria, incluindo preservação de histórico preenchido e a trava de Preview.
- `npm run test:browser -- --max-failures=1`: 50 testes aprovados (desktop e celular).
- `npm run build` e `npm run typecheck`: aprovados.
- Testes SQL em PGlite e navegador com Auth/REST simulado isolado; nenhum teste de escrita em produção. Entrega real dos convites e integração hospedada permanecem para homologação.

## Auditoria e aplicação assistida em homologação

A ordem é 001 → 002 → 003. A 001 só se aplica a um projeto novo: cria a campanha inicial e objetos e não deve ser reaplicada em um banco existente. A 002 acrescenta remoção lógica e torna privada a operação administrativa anterior. A 003 depende dessas colunas e renomeações; mantém `profiles.id`/FKs e os registros comerciais, migra funções antigas e torna privado o segundo ponto de entrada legado. Não há migration 004 nesta entrega nem necessidade de editar migrations já aplicadas.

A auditoria verificou RLS das relações, ACLs de funções/views, vínculo Auth/perfis, isolamento por empresa, acessos inativos, união de funções, último admin, transações e auditoria. A 003 também substitui a autorização legada de validação para negar explicitamente papéis nulos/inativos. O histórico bruto de auditoria e os valores de contratos permanecem restritos a admins. Segurança de futuras tabelas de CRM/serviços não é automaticamente herdada: elas precisarão das próprias políticas.

Procedimento para o operador autorizado, **no projeto confirmado de homologação**:

1. Confira o Project Ref e todas as variáveis Preview; faça snapshot antes da migration. Não basta que a URL contenha `supabase.co`.
2. Em banco existente com 001/002, execute `supabase/checks/stage_2_baseline.sql` no SQL Editor e guarde o resultado privadamente. É somente leitura; inclui contagens e hashes dos registros comerciais, participantes e pontuação. Em projeto novo, aplique 001/002 antes desse check. Não importe usuários ou credenciais de produção.
3. Execute a 003 inteira, uma vez. Reexecute o baseline imediatamente, antes de testes/escritas concorrentes: contagens e hashes devem ser iguais. `profiles.category` e `user_functions` são adições esperadas; alterações de perfis geram novos eventos de auditoria, por isso essa tabela não entra no hash.
4. Execute `supabase/checks/stage_2_security.sql`: exige RLS, ausência de escrita direta para anon/authenticated, pontos de entrada privados, categorias/funções/vínculos coerentes e FKs validadas. Confira também que há administrador ativo. Esses checks de catálogo complementam, não substituem, testes com sessões reais.
5. Configure Auth/SMTP/template/callback conforme acima. Use contas e caixas postais de teste sob seu controle. Teste aceite de convite → `/account` → definição de senha → logout/login com senha. Verifique refresh de sessão e expiração do link; não coloque tokens em evidências ou screenshots.
6. Com duas empresas e sessões reais separadas, execute os oito cenários de “Como testar”, incluindo requisição REST com token do parceiro para a empresa não vinculada, RPC comercial com colaborador de produção e tentativa administrativa sem permissão. Acesso negado pode retornar erro de permissão ou lista vazia pela RLS; nunca dados de outro cliente.
7. Desative e reative uma conta pelo admin, mantendo sua sessão antiga aberta. Confirme negação de dados enquanto inativa e permissões corretas após ativação. Teste alteração SDR + Closer + Tráfego e retirada de SDR da campanha com confirmação; guarde apenas resultados sanitizados da auditoria.
8. Compare a campanha/ranking antes e depois da migration. Faça cadastros/validações somente na campanha de teste em homologação, verificando zero pontos no agendamento e substituição 1/3/7 após validação/contrato. Não use a campanha de produção como teste.
9. Só marque a homologação como aprovada depois de registrar os resultados reais de Auth, entrega de email, RLS via REST, sessão e Challenger. Sem acesso ao projeto/contas/SMTP, esses itens permanecem pendentes, mesmo com build e testes locais aprovados.

Se a aplicação precisar ser revertida, não exclua tabelas/colunas nem restaure 001/002 por cima do banco. A recuperação deve ser planejada com snapshot e código compatível; não há rollback destrutivo automático.
