# ION Challenge

Aplicação interna da Agência ION: Next.js App Router, React, TypeScript, Tailwind, Lucide e Supabase (Auth + PostgreSQL + RLS + Realtime). Não utiliza localStorage como backend nem dados demonstrativos. Sem Supabase configurado, apresenta a tela de integração pendente e impede operações.

## Desenvolvimento

Node.js 24 LTS e npm 11. Use o checkout existente: tarefas cloud já são isoladas; não crie worktrees.

```bash
cd /workspace/ION-Challenge
npm ci
cp .env.example .env.local
# Preencha apenas os valores do seu projeto em .env.local, sem versioná-los.
npm run dev
```

`npm test` executa a migration real em PostgreSQL via PGlite e testa funções SQL com as roles `authenticated`/`anon` e identidades de teste. `npm run build` compila e verifica tipos. `npm run typecheck` verifica os tipos separadamente. Os testes não substituem validação de Supabase Auth, Realtime e entrega de emails em um projeto real.

## Testar o cadastro no navegador

`npm run test:browser` abre Chromium em tamanhos de desktop e celular e testa o botão Nova reunião, formulário, envio à RPC, mensagens de bloqueio/erro, listagem para SDR e closer e restrição de acesso ao cadastro. Instale o navegador com `npx playwright install chromium` se não houver Chromium local; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` permite indicar outro executável. As portas 3100 e 3101 devem estar livres, e outro `next dev` deste checkout não deve estar rodando.

Essa suíte usa um servidor Supabase **exclusivo de testes**, sem acessar o projeto real. `npm test` verifica separadamente a migration e as regras reais de PostgreSQL/RLS em PGlite. O cadastro usa `/meetings/new`; mesmo quando bloqueado, abre os campos e explica a ausência de campanha ativa, time ou closer. Nenhuma migration adicional é necessária para essa correção. Faça o deploy da versão corrigida na Vercel após o merge.

## O que está implementado

- Login por senha, sessão validada no servidor, renovação de sessão e alteração de senha. Sem cadastro público.
- Perfis SDR, closer e administrador; desativação bloqueia leituras e operações mesmo com sessão existente.
- Campanha inicial em **configuração**, sem data inventada: iPhone 13, meta 700, duração 56 dias, pesos 1/3/7.
- Cadastro de reunião pelo SDR autenticado, atribuição de closer ativo, snapshot do time, oportunidades e revisão de duplicidades por telefone normalizado.
- Validação somente pelo closer atribuído ou admin, proibição de resultados futuros, qualificação posterior de reunião realizada.
- Contratos administrativos vinculados a reuniões válidas, com valor, data e referência; confirmação única por oportunidade e anulação justificada.
- Rankings individuais com rank compartilhado nos empates completos; times com até cinco SDRs por campanha; progresso e indicadores derivados de resultados oficiais.
- Meta atingida calculada automaticamente; anulação pode bloquear novamente o prêmio. Competição permanece aberta até o fim. Finalização administrativa somente depois do período e com justificativa; vencedor precisa ser líder elegível. Sem meta, encerra sem vencedor.
- Administração de perfis, times, participantes, campanha, correções, exceções de duplicidade, contratos e consulta das últimas 100 ações de auditoria.
- Histórico de validações e eventos de pontuação; layout responsivo preto/grafite/roxo, estados vazios, erros e envio protegido contra duplo clique.
- Realtime em campanhas e feed sem dados pessoais para resultados; polling a cada 15 segundos e atualização ao recuperar foco como alternativa.

### Decisões operacionais

Cada oportunidade vale **0, 1, 3 ou 7**, nunca 11. Múltiplas reuniões da mesma oportunidade contam uma única vez. Uma reunião qualificada também conta como realizada. Contrato só pontua enquanto a reunião vinculada continua válida. Ao anulá-lo, o total volta ao resultado da reunião. O telefone duplicado não é descartado: o SDR pode reutilizar sua oportunidade; um admin pode autorizar outra oportunidade legítima com justificativa. Se o telefone estiver em oportunidade de outro SDR, é necessária revisão administrativa, sem expor o contato daquele SDR.

Pontos não são armazenados em tabela editável: são calculados por views privadas e RPC. O time do participante fica congelado depois de sua primeira oportunidade, preservando resultados por equipe. Usuários desativados mantêm seu histórico e pontos; desativar não apaga resultados oficiais. Uma campanha ativa encerra o recebimento de novas reuniões no fim do período; validações e correções continuam até a conferência final. Campanhas finalizadas ficam congeladas e permitem criar a próxima campanha.

## Variáveis

| Variável                        | Uso                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL HTTPS do projeto Supabase                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública anon; autorização depende de Auth e RLS                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Somente bootstrap local autorizado; nunca no frontend ou com prefixo NEXT_PUBLIC |
| `BOOTSTRAP_ADMIN_EMAIL`         | Somente bootstrap local                                                          |
| `BOOTSTRAP_ADMIN_PASSWORD`      | Somente bootstrap local; mínimo 12 caracteres                                    |

As duas primeiras são necessárias para operar. As três últimas são temporárias e não são necessárias no runtime da Vercel. Nunca envie valores de credenciais por chat nem faça commit de `.env.local`.

## Supabase: configuração exata

1. Crie um projeto no plano gratuito do Supabase. Escolha região próxima da equipe e guarde a senha do banco em local seguro.
2. Abra **SQL Editor**, cole todo o arquivo `supabase/migrations/001_ion.sql` e execute uma vez em um projeto novo. A migration cria tabelas, políticas, funções, gatilhos e a campanha inicial. Não é idempotente: não reaplique inteira em um banco já migrado. Não deve ser aplicada sobre dados existentes sem revisão/migration separada.
3. Em **Project Settings → API / API Keys**, obtenha a URL e a chave pública anon legada compatível com o cliente. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente local e na Vercel.
4. Em **Authentication → Providers → Email**, mantenha login por email e desabilite novos cadastros públicos. Não há registro público na aplicação.
5. Em **Authentication → URL Configuration**, defina Site URL para o domínio HTTPS final. Cadastre os redirect URLs exatos: `https://SEU_DOMINIO/auth/callback` e o callback local de desenvolvimento quando necessário. Evite wildcards de produção. Configure SMTP próprio se necessário para entrega confiável de convites; o serviço padrão possui limites.
6. Confirme em **Database → Publications** que `supabase_realtime` contém `campaigns` e `competition_updates`. A migration adiciona essas tabelas se a publicação existe. Não publique oportunidades, reuniões, contratos ou auditoria: contêm informações restritas. O feed público inclui somente ID da campanha e instante de atualização.
7. Execute o bootstrap abaixo uma única vez em máquina autorizada. Alternativa manual segura: crie o usuário em **Authentication → Users → Add user**, copie o UUID e insira o primeiro perfil pelo SQL Editor administrativo: `insert into public.profiles(id,name,role) values ('UUID_DO_USUARIO','Seu nome','admin');`. Não crie endpoint público de bootstrap.
8. Faça login como admin. Em Administração, crie os times e os perfis dos colaboradores. Para cada colaborador, primeiro use **Authentication → Users → Invite user**, depois copie seu UUID e cadastre o perfil (SDR/closer/admin) no painel. Em **Authentication → Email Templates → Invite user**, use no link do convite `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite` (para recuperação pelo operador, a template usa `type=recovery`). Isso troca o token no servidor por uma sessão segura. O convite deve usar o callback configurado; em Meu perfil o usuário define sua senha. A aplicação não usa service role para convidar contas pelo frontend.
9. Vincule os SDRs aos times (até cinco por time). Cadastre closers ativos. Configure a data oficial da campanha e revise meta/pesos/duração, depois selecione ativar. A campanha não inicia antes da data configurada.
10. Valide no projeto real com três contas: SDR cria uma reunião, closer atribuído valida, admin confirma contrato. Confira total 0 → 1 → 3 → 7 e meta contada só uma vez. Confirme Realtime com duas sessões abertas e acesso negado ao closer não atribuído.

### Bootstrap local

Em um terminal autorizado, configure as variáveis temporárias por um gerenciador de segredos ou entrada segura. Não coloque senhas no histórico do shell. Com as variáveis carregadas:

```bash
node scripts/bootstrap-admin.mjs
```

O script se recusa a executar se houver admin existente. Cria um usuário confirmado e seu perfil administrativo; em falha de perfil tenta remover somente o usuário criado por ele. Altere a senha no primeiro acesso e remova as variáveis temporárias. A chave service role ignora RLS: nunca use no código cliente, publique no Git ou mantenha em logs.

## Vercel: publicação

1. Envie o código para o repositório `Luizkode/ION-Challenge` pelo fluxo normal de commit/PR. Nenhum push ou deployment foi feito automaticamente.
2. Na Vercel, **Add New → Project**, importe o repositório e escolha o preset **Next.js**. Raiz do projeto: raiz do repositório. Use Node.js 24, instalação `npm ci` e build `npm run build`.
3. Cadastre somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` em Production e, se necessário, Preview. Não cadastre service role nem variáveis de bootstrap.
4. Faça deploy. Configure o domínio final, atualize Site URL e callback do Supabase e confirme acesso por HTTPS.
5. Valide login, cadastro, validação, contrato, invalidação, rankings e atualização entre sessões no domínio final. Restrinja URLs de preview e redirects de acordo com sua política.

Vercel Hobby tem restrições de uso comercial. Como esta é uma ferramenta interna de uma agência, confirme os termos e elegibilidade antes de escolhê-lo: não é possível prometer hospedagem comercial gratuita na Vercel. O projeto não depende de recursos pagos; outro host compatível com Next.js pode ser utilizado. A aplicação está preparada para implantação, mas não foi publicada.

## Segurança antes do uso real

- Revise políticas/funções da migration no projeto real. Escritas diretas de `anon`/`authenticated` são revogadas; RPCs verificam perfil, ownership, vínculo, período e integridade.
- Confira que nenhum colaborador consegue alterar role/active, contratos, status ou logs por REST direto. A view de pontuação não tem grants para clientes.
- Faça testes de Auth e Realtime reais: os testes locais emulam o UUID da sessão, não o sistema de emissão de JWTs.
- Proteja contas admin (senha forte e MFA no provedor quando habilitado), segredos, acesso ao painel Supabase e backups. MFA não é imposto pela aplicação nesta versão.
- As RPCs serializam writes por campanha e operações administrativas; histórico é auditado no banco. Operadores com service role/acesso SQL continuam tendo privilégios administrativos: a auditoria não é inviolável para o dono do banco.
- Contatos comerciais só são visíveis ao SDR responsável, closer atribuído e admin. Defina retenção, acesso operacional e política de privacidade/LGPD antes de coletar dados reais.
- Habilite rate limits do Supabase Auth e acompanhe logs. O fluxo não contém endpoint de signup ou bootstrap público.
- Convites, recuperação de senha por operador e criação de usuários Auth dependem do painel Supabase. Não há automação de convite dentro do app nem fluxo público de recuperação nesta versão.
- Consulta de auditoria mostra as últimas 100 ações; retenção permanece no banco. Relatórios históricos/paginação avançada e exportação não fazem parte desta V1.
- Componentes são próprios com Tailwind; não há shadcn/ui nesta versão. Não foram feitos testes visuais automatizados de navegador ou ensaio de carga de produção.

## Arquivos principais

- `supabase/migrations/001_ion.sql`: schema, RLS, score derivado, RPCs, auditoria, integridade e feed Realtime.
- `app/actions.ts`: operações servidor, autenticação e validação de formulário.
- `app/(private)/`: dashboard, reuniões, closer, administração e perfil/histórico.
- `lib/supabase.ts`, `lib/session.ts`, `proxy.ts`: conexão, sessão e atualização de cookies.
- `components/`: campos, submissão, UI e Realtime com fallback.
- `tests/database.test.ts`: testes executáveis das regras contra PostgreSQL.
- `scripts/bootstrap-admin.mjs`: bootstrap administrativo restrito ao operador.

A instância cloud pode executar build e testes sem credenciais; o uso real requer projeto Supabase, migration, variáveis e contas. Não interprete build aprovado como validação de um projeto Supabase remoto.
