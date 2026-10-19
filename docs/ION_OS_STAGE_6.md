# Etapa 6 — Analytics e Partners

Evolução do mesmo aplicativo, Supabase e domínio. Sem variáveis novas obrigatórias para cadastro manual, CSV, relatórios e portal.

## Implantação incremental

1. Confirmar recuperação: cópia criptografada fora do repositório, download/descriptografia, restauração PostgreSQL 17, comparação de todas as tabelas, validação de FKs e escrita auditada com rollback. Um teste local da aplicação não comprova recuperação.
2. Aplicar `010_analytics_partners.sql` após 009. É transacional, aditiva e não altera registros históricos. Executar `supabase/checks/stage_6_security.sql`.
3. Publicar aplicação com `/clients/files/[id]` autenticada. Confirmar download real.
4. Somente depois aplicar `011_authenticated_document_downloads.sql`. O helper `storage.allow_any_operation` é fornecido pelo Storage Supabase; não instalar versões simuladas no servidor.
5. Verificar download autenticado, bloqueio de novas URLs assinadas e revogação de publicação. Links assinados anteriores expiram em 60 segundos. Cópias já baixadas não podem ser recolhidas.

Recuperação pré-010: 59 tabelas, 773 registros, schema 001–009, posições de sequências e arquivos não pertencentes ao próprio backup. Bundle privado criptografado e chave protegida separadamente nas variáveis cifradas Vercel. Esta cópia lógica não equivale ao PITR gerenciado. Em incidente, suspender escritas, baixar/verificar/descriptografar o bundle, restaurar na infraestrutura Supabase compatível e conferir hashes, FKs e sequências antes de reabrir. Reverter somente a aplicação não requer apagar as tabelas aditivas.

## Operação

Administrador: Clientes → cadastrar/selecionar cliente. Analytics → Contas → Campanhas → Resultados (cadastro ou CSV). O modelo CSV está disponível no módulo. Campo vazio significa desconhecido; zero é medição explícita. Referência de origem obrigatória; receita e aquisições exigem comprovação. Repetição CSV idêntica é ignorada; conflito aborta o lote inteiro.

Tráfego precisa estar atribuído ao cliente. Outros colaboradores precisam de atribuição e concessão explícita de leitura/escrita no Analytics. Nenhum deles publica. Relatórios persistem snapshots imutáveis. Administrador publica separadamente campanha, indicadores, observações e relatório, mediante confirmação. Correções e revogações retiram os relatórios afetados do portal.

Parceiros consultam somente empresas vinculadas com portal habilitado e informações explicitamente publicadas. Nenhuma edição, solicitação, aprovação ou mensagem. Contratos não expõem valores internos; comprovantes privados e autores das métricas são omitidos. Documentos usam sessão do usuário e RLS a cada requisição, sem service-role no download.

Valores monetários são exatos; conversões aceitam atribuição fracionária (seis casas). CPA usa aquisições comprovadas. Alcance não é somado entre observações; taxas são recalculadas das medidas completas; ausência nunca vira zero. Métricas incompatíveis entre contas são exibidas por conta. Períodos parcialmente sobrepostos são excluídos sem rateio e sinalizados. Receita do anunciante nunca é inferida do Financeiro da agência.

## APIs oficiais — desativadas

`lib/ads-connectors.ts` estabelece a fronteira de conexão; não há scraping nem chamadas automáticas sem autorização. Cadastro/CSV funcionam independentemente.

Meta exige aplicativo, revisão/acesso adequado, `ads_read`, autorização do proprietário e conta publicitária; tokens só no servidor. Google exige developer token aprovado, OAuth com escopo `https://www.googleapis.com/auth/adwords`, consentimento/refresh token e acesso à conta. Antes de ativar: implementar consentimento, armazenamento cifrado/rotação, paginação, backoff para limites, sincronização idempotente e conciliação de moeda, fuso e atribuição. Não considerar a arquitetura preparada uma integração já operacional.

Referências: https://developers.facebook.com/docs/marketing-api/get-started/authorization/ ; https://developers.google.com/google-ads/api/docs/get-started/dev-token ; https://developers.google.com/google-ads/api/docs/oauth/overview ; https://supabase.com/docs/guides/storage/security/access-control

## Validação

`npm test`, `npm run typecheck`, `npm run test:browser` e build. Fixtures verificam interface e regras SQL, não substituem Auth/PostgREST/Storage reais. Validar adicionalmente com contas técnicas isoladas: tráfego atribuído, colaborador com concessão, parceiros de empresas diferentes, conta inativa; cadastrar/importar, publicar, gerar/baixar PDF, corrigir/revogar e comprovar isolamento. Conferir Dashboard, CRM, Financeiro e Challenger e preservar hashes dos registros originais. Remover apenas os dados técnicos criados pela verificação; manter auditoria.
