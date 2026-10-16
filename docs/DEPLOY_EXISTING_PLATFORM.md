# ION OS — evolução da plataforma existente

## Decisão de arquitetura

O ION OS é a evolução do ION Challenger: um único projeto Supabase, o projeto Vercel `ion-challenge`, o repositório `Luizkode/ION-Challenge` e as contas Auth atuais. A mesma URL Production passará a abrir o Dashboard ION OS; `/challenger` mantém campanhas, rankings, reuniões, contratos e pontuação. Não se cria outro aplicativo, banco, organização ou domínio como condição de implantação.

O PR #3 contém a fundação do PR #2, o controle de acesso e o main remoto `5f7ecbb`. A integração ocorre nessa branch, sem merge automático em main. Os módulos futuros aproveitam o mesmo banco e autenticação, com suas próprias políticas RLS; ainda não há funcionalidades operacionais de CRM/Financeiro/serviços/Analytics.

## Diagnóstico remoto obtido sem escrita

Em 14/10/2026 foram usadas exclusivamente a URL e a chave pública já presentes no ambiente. As consultas REST usaram `limit=0`, sem recuperar registros pessoais ou comerciais. Não houve login, convite, criação de usuário ou alteração de configuração.

| Verificação | Resultado observado | Conclusão limitada à API exposta |
| --- | --- | --- |
| Supabase Auth `/settings` | HTTP 200, `disable_signup=false`, `mailer_autoconfirm=false` | Auth responde; cadastro público habilitado, confirmação por email exigida |
| `profiles.id` | HTTP 401, código 42501 | Relação original existe e nega leitura anônima |
| Tabelas comerciais, auditoria, feed, view de pontos e RPC `dashboard` | HTTP 401, código 42501 em consultas de leitura | Objetos originais encontrados e acesso anônimo negado; não comprova as políticas entre usuários autenticados |
| `campaign_participants.removed_at` | HTTP 400, código 42703 | Coluna da 002 ausente |
| `profiles.category` | HTTP 400, código 42703 | Coluna da 003 ausente |
| `user_functions`, `access_companies` | HTTP 404, PGRST205 | Relações da 003 não expostas no cache REST |
| `current_access()` | HTTP 404, PGRST202 | RPC da 003 não exposta no cache REST |

O resultado indica estrutura anterior à 002/003, compatível com a V1. Não comprova que toda a 001 está idêntica ao arquivo, nem substitui catálogo SQL, inspeção de políticas, histórico de migrations, contagens ou recuperação do backup real. Não há acesso de gestão Supabase/Vercel no ambiente para completar essas verificações. A API pública não permite determinar plano, retenção, PITR, integridade dos backups, SMTP ou domínio principal configurado na Vercel.

## Artefatos preparados

- `supabase/checks/existing_schema_inventory.sql`: inspeção somente de leitura de tabelas, colunas, ACLs, RLS, constraints e contagens agregadas, inclusive no schema 001.
- `supabase/checks/stage_2_baseline.sql`: contagens e hashes antes/depois de 002/003. Normaliza os campos adicionais de participação da 002 aos defaults antigos, preservando também remoções já existentes.
- `supabase/checks/stage_2_security.sql`: verificação de RLS, ACLs, compatibilidade de categorias/funções/vínculos e FKs após 003.
- `node scripts/prepare-ion-os-release.mjs --from=001`: gera `/tmp/ion-os-release/ion-os-release.sql` e `manifest.json`, sem conectar ao banco. Se o inventário provar que a 002 já existe integralmente, use `--from=002`. Estado parcial ou diferente exige revisão antes de preparar outra versão.

O SQL gerado aplica apenas as migrations pendentes, mantém os arquivos históricos e **nunca inclui a 001**. Usa uma única transação para 002/003 e checks finais, lock administrativo e timeouts. Se houver erro ou falta de lock, a transação inteira deve ser revertida; não execute instruções avulsas para forçar a continuação. O manifesto identifica os arquivos e o SQL por SHA-256. Esses artefatos não são backups.

## Recuperação: condição para autorizar produção

1. Confirmar no projeto atual um backup utilizável ou ponto PITR anterior à atualização: identificador, horário UTC, cobertura, retenção, acesso do operador e procedimento de restauração. Não presumir que o plano contratado inclui backups/PITR.
2. Se necessário, obter um backup lógico autorizado com schema e dados, incluindo identidades Auth, FKs, funções, gatilhos, grants e políticas. Exportação CSV ou somente `public.profiles` não recupera o sistema. Proteger credenciais, backup e logs fora do Git e documentar os limites de cobertura de Storage/configurações Auth/SMTP.
3. Verificar a possibilidade de recuperação: evidência de restauração já validada pelo provedor ou ensaio em PostgreSQL local temporário compatível, com conferência de integridade e cobertura. Isso é uma verificação temporária, não uma segunda plataforma ou requisito de outro projeto Supabase. Hash do arquivo ou lista do conteúdo, sozinhos, não provam restauração.
4. Registrar operador, tempo estimado de recuperação e risco de perder escritas posteriores ao ponto recuperado. A restauração do banco atual é privilegiada e só será executada mediante autorização específica.

Os testes locais ensaiam snapshot/restauração do banco de teste preenchido e verificam rollback integral de 002/003 após erro proposital no fim. Isso valida a estratégia local, **não certifica um backup hospedado de produção**. Sem evidência verificável do backup real, a migration em produção permanece bloqueada.

## Plano de mudança no mesmo projeto — ainda não executado

1. Inspecionar catálogo e baseline pelo acesso SQL autorizado do Supabase existente. Conferir que o projeto corresponde à URL já configurada; não pedir novamente identificadores que possam ser obtidos da configuração atual.
2. Confirmar o mecanismo de recuperação acima e revisar o SQL/manifesto gerados para o estado real. Preservar um deployment anterior identificável da Vercel.
3. Obter autorização explícita para: migrations pendentes no banco atual; eventuais ajustes Auth/variáveis; merge do PR consolidado; publicação Production no projeto Vercel existente. Nada disso foi autorizado implicitamente pelo pedido de preparar a atualização.
4. Na janela combinada, suspender novas escritas operacionais. Aplicar o SQL aprovado inteiro no banco atual, executar novamente baseline/inventário e comparar hashes/contagens. Falha ou divergência interrompe a publicação; RLS e validações não são desabilitadas.
5. Reutilizar as variáveis públicas existentes da Vercel. Para convites, verificar se `SUPABASE_SERVICE_ROLE_KEY` do **mesmo projeto** já existe como variável privada; configurar somente se ausente/incorreta e autorizado. Não usar prefixo `NEXT_PUBLIC` para credencial administrativa. `ION_OS_APP_URL` é opcional quando `VERCEL_URL` atende ao callback; preferir o endereço Production atual para os convites, sem exigir novo domínio. `ION_OS_PREVIEW_SUPABASE_PROJECT_REF` deixou de ser utilizado e pode ser removido das configurações.
6. Preservar provedores, contas e sessões existentes. Revisar o callback `/auth/callback`, template de convite e envio já configurado; reaproveitar SMTP se funcional. A proposta de desativar signup público para restringir criação a convites exige aprovação, pois hoje ele está habilitado. Não alterar esses parâmetros silenciosamente.
7. Após schema e configurações aprovados, integrar/publicar o PR #3 no mesmo projeto Production. O deploy altera `/` para o Dashboard e mantém `/challenger`. Não criar ou trocar projeto Vercel nem domínio principal. Merge em main pode disparar Production automaticamente; por isso também aguarda autorização.
8. Validar a mesma URL: sessão admin existente, Dashboard/menu, campanha e ranking iguais ao baseline, reuniões/contratos históricos; sessões de colaborador/parceiro e negação entre empresas. Convites e testes de escrita em produção precisam de contas/destinatários e escopo explicitamente aprovados. Não criar campanha fake, zerar ranking ou disparar emails para usuários reais como teste.
9. Se o deploy falhar, manter/retomar o deployment anterior dentro do plano aprovado. Não apagar colunas/tabelas nem restaurar automaticamente a 001. A compatibilidade de dados/Auth/UUIDs é preservada; telas administrativas antigas podem ser bloqueadas pelas novas exigências de confirmação. Evitar um intervalo operacional entre migration e novo código e validar recuperação antes de abrir novas contas/funções.

## Preview no projeto existente

Preview é apenas um deployment da mesma aplicação Vercel. Não exige outro Supabase, variáveis duplicadas ou Project Ref adicional. A validação continua bloqueando chave administrativa em variável pública, URL inválida e JWT público incoerente com a URL. Reutilizar o banco central significa compartilhar dados: **Preview não isola escritas**. A suíte automatizada usa fixture/PGlite local; não apontá-la ao banco central. Não testar operações privilegiadas hospedadas sem aprovação.

Um Preview com build bem-sucedido antes de 002/003 permite avaliar o login, mas não comprova que usuários conseguem acessar as páginas privadas, pois a nova aplicação requer `current_access()`. Não inventar fallback de autorização para esconder migration pendente. Deployment Protection e acesso aos logs continuam dependendo das permissões da Vercel existente.
