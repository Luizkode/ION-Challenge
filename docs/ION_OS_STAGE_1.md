# ION OS — diagnóstico, Etapa 1 e evolução

## Diagnóstico do projeto existente

1. **Arquitetura:** Next.js 16 App Router, React, TypeScript, Supabase Auth/SSR, PostgreSQL, RPCs e RLS; Tailwind e Lucide. Server Actions autenticadas fazem operações. O perfil ativo é consultado no banco, sem confiar no cargo enviado pelo cliente.
2. **Reuso visual:** `app/globals.css` contém os tokens preto/grafite/roxo, tipografia, botões, cards, tabelas, formulários, estados vazios e breakpoints. `components/ui.tsx`, `Submit`, `DateField`, `Live` e os componentes de confirmação continuam em uso. Não foram substituídas logos oficiais nem adicionadas bibliotecas de UI.
3. **Preservação:** campanhas, oportunidades, reuniões, validações, contratos comerciais, pontos não cumulativos 0/1/3/7, meta por oportunidade, desempates, auditoria, participação, autenticação e bootstrap. A campanha é obtida do banco; o nome e as datas existentes (inclusive Live 13, se configurada no projeto) não são renomeados nem sobrescritos.
4. **Navegação:** `/` agora é o dashboard da agência; o dashboard anterior foi reaproveitado em `/challenger`. As rotas `/meetings`, `/meetings/new`, `/validation`, `/history` e `/admin` continuam válidas. Um submenu do Challenger oferece acesso à operação existente. O menu central mostra nove módulos para administradores e somente Dashboard/CRM/Challenger para SDR e closer, os perfis disponíveis hoje.
5. **Banco:** a Etapa 1 usa as tabelas existentes. Não cria schema financeiro nem considera contratos comerciais como recebimentos. As consultas do dashboard respeitam RLS; contratos e contagens administrativas não são consultados para colaboradores. Funções múltiplas e parceiros dependem da Etapa 2.
6. **Riscos:** links que tratavam `/` como campanha passam a apontar para `/challenger`; clientes em sessões abertas precisam carregar a nova versão. Um dashboard amplo não deve contornar RLS. Reuniões repetidas não devem duplicar a taxa por oportunidade ou os pontos. Consultas de períodos precisam usar o horário de Brasília. Dados reais do projeto remoto não foram inspecionados nem alterados: o diagnóstico de banco usa as migrations do checkout.
7. **Plano:** executar as seis etapas abaixo, com migrations adicionais, testes e revisão por etapa, sem substituir tabelas do Challenger.

## Entrega da Etapa 1

- Identidade principal ION OS no layout, login, metadata e loading, preservando a marca tipográfica ION, CSS e ícones existentes.
- Navegação central definida em `lib/os-modules.ts`, com links ativos e autorização também na página servidor dos módulos futuros.
- Dashboard personalizado por perfil, períodos validados e gráfico comercial baseado nos registros consultados. Reuniões são agrupadas por data agendada; contratos confirmados pelo fechamento. Conversão usa oportunidades distintas com reunião realizada e contrato confirmado no mesmo período. Não se trata de receita ou conversão histórica de toda a vida do lead.
- Número zero só aparece quando a consulta real retorna ausência de registros. Conversão sem denominador mostra “—”; dados restritos mostram “Restrito”. Clientes, receita, despesas, caixa, inadimplência e cobrança são explicitamente informados como não disponíveis nesta etapa.
- Challenger mantém seu componente de dashboard, chamadas RPC, meta, rankings e regras. Não há nova tabela, seed de campanha ou migração de registros.
- CRM, Clientes e Serviços, Analytics, Financeiro, Equipe, Parceiros e Configurações têm páginas informativas. Só existem links para operações já implementadas. Não há formulário de lead fictício, financeiro simulado, integração publicitária falsa ou acesso de parceiro sem isolamento.

## Supabase e implantação

**Não há migration nova para a Etapa 1.** Mantenha as variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` e os callbacks atuais; não configure service role no frontend. A migration `002_participant_management.sql` é da melhoria anterior de participantes, não desta transformação; deve ser aplicada uma única vez depois da 001 caso ainda esteja pendente. Nunca reaplique a 001 em um projeto preenchido.

Nenhuma migration foi executada no Supabase hospedado e não houve deploy, push ou merge automático. Após revisão e quando o operador decidir publicar, o novo build deve ser disponibilizado pela implantação normal da Vercel. O login continua em `/login` e o callback em `/auth/callback`.

## Verificação

- `npm test`: regras SQL reais via PGlite, pontuação, ownership, RLS, histórico, remoção/reinclusão, troca de perfil, rollback, módulos permitidos, datas e indicadores deduplicados.
- `npm run test:browser`: Chromium em desktop e celular; login ION OS, navegação pelos nove módulos, dashboard administrativo/pessoal, filtro por período, bloqueio de URLs administrativas, Challenger e seus rankings, cadastro/validação existente e ações de participantes. O servidor Supabase utilizado nessa suíte é exclusivamente uma fixture de teste.
- `npm run build`: compilação e TypeScript.
- `node scripts/smoke.mjs`: com servidor local em execução, verifica login e redirecionamento de dez rotas privadas para visitantes sem sessão.

No projeto real, confira manualmente o login nas três funções atuais, indicadores com registros conhecidos, abertura de `/challenger`, campanha e rankings corretos, cadastro agendado com zero pontos, validação e confirmação administrativa sem duplicação. Confirme atualização entre sessões. Testes locais não comprovam Auth/Realtime do projeto hospedado.

## Próximas etapas e estratégia de dados

| Etapa                        | Entrega                                                             | Estratégia incremental                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — Permissões               | Administrador, colaborador multifunção e parceiro                   | Acrescentar funções/atribuições e vínculo de parceiros às empresas; adaptar `actor_role`/políticas mantendo a compatibilidade das RPCs existentes. Testar negação por função e isolamento de empresa antes de conceder novas contas.        |
| 3 — CRM                      | Leads, funil configurável, contatos, propostas e fechamentos        | Leads independentes da campanha, com relações para oportunidades/reuniões existentes e identificadores únicos de evento. Reunião elegível usa a autorização e pontuação existentes; não recriar a oportunidade para duplicar pontos.        |
| 4 — Clientes/serviços/equipe | Empresas atendidas, contratos de prestação, serviços e responsáveis | Tabelas adicionais vinculadas a contratos aprovados, estados e histórico de serviços. Gestão de entregas dentro de Clientes e Serviços, sem ION Tasks.                                                                                      |
| 5 — Financeiro               | Receitas previstas/recebidas, despesas, cobranças, comissões        | Lançamentos financeiros com datas de competência, vencimento e pagamento, apenas para admins; recebimento explícito, nunca derivado automaticamente de contrato comercial. Sem disparos ou pagamentos automáticos.                          |
| 6 — Analytics/Partners       | Métricas manuais, relatórios, documentos e portal de consulta       | Origem/data das métricas, publicação explícita e acesso por empresa, storage privado e documentos autorizados. Parceiro somente lê: sem pedidos, mensagens, aprovações ou edição operacional. Integrações Ads exigem configuração separada. |

Cada etapa precisa de migração incremental, teste de atualização de um banco preenchido, revisão de RLS e plano de recuperação. Um rollback de código não deve apagar tabelas ou dados novos. Manter dados históricos e evitar mudanças de pesos sem confirmação e auditoria.

## Arquivos da Etapa 1

- `app/(private)/page.tsx`: dashboard ION OS.
- `app/(private)/challenger/page.tsx`: dashboard original reaproveitado.
- `app/(private)/[module]/page.tsx`: páginas informativas com autorização servidor.
- `app/(private)/layout.tsx`, `app/layout.tsx`, `app/login/page.tsx`, `app/loading.tsx`, `app/globals.css`: shell e identidade.
- `lib/os-modules.ts`, `lib/os-dashboard.ts`: módulos, permissões, períodos e indicadores.
- `components/os-navigation.tsx`, `components/challenger-navigation.tsx`, `components/commercial-chart.tsx`: navegação e gráfico.
- `tests/os-foundation.test.ts`, `tests/browser/os-foundation.spec.ts`: testes novos.
- Testes de login existentes e `scripts/smoke.mjs`: atualizados para o nome e rotas.

As alterações locais de participantes existentes antes desta etapa foram preservadas. Elas não devem ser confundidas com novas migrations do ION OS.
