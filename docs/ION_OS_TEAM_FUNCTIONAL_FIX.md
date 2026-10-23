# Correção funcional de Equipe — 23/10/2026

## Estado da entrega

Branch de trabalho: `fix/team-real-operations`. Correções preparadas para revisão; produção ainda não atualizada. Nenhuma migration nova ou alteração em dados de produção foi executada nesta intervenção.

## Problemas demonstrados no código

- A justificativa exige oito caracteres no servidor, mas o formulário anterior não explicitava esse limite na validação por campo. Erros de nome, email, função obrigatória e vínculo obrigatório eram apresentados genericamente e perdiam o contexto do preenchimento.
- Colaborador precisa de uma ou mais funções; Parceiro precisa de empresa ativa. As mensagens condicionais do schema não tinham caminho de campo. Uma confirmação inválida também podia impedir a avaliação das condições pelo Zod; agora todas essas pendências aparecem juntas.
- A mudança de um participante SDR para Administrador, Parceiro ou colaborador sem SDR exige remoção explícita da campanha em aberto. Essa é uma proteção válida da RPC `manage_access`, não uma restrição a eliminar. O formulário agora mostra o vínculo e orienta a confirmação da operação atômica, preservando o histórico.
- O fluxo anterior de convite agrupava conta existente, destinatário não autorizado, limitação de envios e falha de email em uma mensagem genérica. As respostas agora distinguem essas situações, indisponibilidade e resultado incerto. Timeout/erro recuperável do Auth mantém o convite pendente para conferência e não é tratado como comprovação de falha definitiva ou sucesso.

Nenhuma dessas evidências locais comprova a causa específica de uma tentativa histórica em produção: isso depende da reprodução com sessão válida e consulta dos registros remotos.

## Implementação

- `components/access-form.tsx`: formulário controlado reutilizado em convite, edição e vínculo de conta existente; erros junto aos campos, identificação dos obrigatórios, resumo de confirmação, bloqueio de envio duplicado, preservação dos valores após falhas e atualização da interface após sucesso. O reset automático do React é cancelado; a limpeza é explícita apenas quando apropriada, mantendo inclusive checkboxes após rejeição do serviço.
- `lib/access-input.ts`: validação compartilhada entre navegador e servidor, erros em português por campo e classificação das respostas do banco/Auth. A categoria Administrador continua sendo normalizada sem funções operacionais nem empresas, como já ocorria no servidor.
- `app/team-actions.ts`: autenticação administrativa antes da execução, validação no servidor, retorno estruturado, checagem das etapas do convite e mensagens sem expor credenciais.
- `app/(private)/team/page.tsx`: contexto de participação em campanha, somente empresas ativas disponíveis e integração dos formulários.
- `components/ui.tsx`, `components/date-field.tsx` e `app/globals.css`: indicação de campos obrigatórios e estado de erro, mantendo as classes e a identidade existentes.
- Testes de validação, fixture e cenários de navegador: promoção, normalização de permissões, cancelamento sem escrita, valores preservados, destinatário recusado e resultado incerto do Auth.

A autenticação, as políticas RLS, os bloqueios do último administrador e da própria conta, as RPCs transacionais e os cálculos do Challenger não foram relaxados. Convidar um SDR não o inscreve automaticamente no Challenger: campanha e time continuam sendo gerenciados no fluxo administrativo existente.

## Verificação real e bloqueios externos

Os endpoints públicos `/login` na aplicação existente e `/auth/v1/health` no Supabase responderam HTTP 200. Isso comprova disponibilidade pública, não persistência de operações administrativas.

Os acessos administrativos injetados nesta execução foram recusados: Supabase Management API, HTTP 401 (`Invalid access token`); Vercel, HTTP 403 por falta de acesso ao escopo `ion-challenge`. O usuário informou que vai atualizar os dois acessos nas configurações seguras. Nenhum valor de credencial foi incluído neste documento.

Enquanto esses acessos não forem aceitos, permanecem **não validados nesta intervenção**: configuração atual de SMTP/callbacks/segredos da implantação, logs privados, convites reais, promoção/ativação/vínculos em dados remotos, operações dos demais módulos com os cinco perfis, recuperação atual verificável e publicação da correção. SMTP estava pendente na etapa anterior; seu estado atual precisa ser consultado antes de atribuir a ele a falha observada.

Resultados locais: `npm test` executou 118 testes, todos aprovados; os cenários de Equipe e controle de acesso no Playwright executaram 24 casos, todos aprovados, em computador e celular. A compilação de produção necessária a esses cenários também terminou sem erro. `npm run typecheck` passou. A regressão local de cadastro de reuniões do Challenger passou nos dois dispositivos (2 casos), incluindo RPC, identificação do SDR e consulta pelo closer.

Os testes automatizados utilizam PostgreSQL local (PGlite) e serviços controlados de teste no navegador. Não são apresentados como evidência de sucesso no Supabase de produção.

## Continuação assim que os acessos forem restabelecidos

1. Revalidar somente as APIs administrativas bloqueadas, sem imprimir segredos.
2. Consultar configuração e logs reais; reproduzir com contas e registros técnicos identificáveis, sem alterar dados comerciais ou financeiros existentes.
3. Verificar persistência e atualização das permissões após recarregamento: convite, Administrador, SDR, Closer, Produção, Parceiro, ativação e vínculos entre empresas. Confirmar bloqueios de acesso indevido e preservação dos registros do Challenger.
4. Confirmar recuperação verificável antes de publicar; se necessário, gerar cópia segura no projeto existente e validar restauração isoladamente, sem substituir o banco de produção.
5. Publicar no mesmo projeto/endereço somente após a validação real das correções. Confirmar SHA do deployment e repetir os cenários essenciais na aplicação publicada. Manter a auditoria e remover somente os registros técnicos cuja limpeza seja segura.

Nenhuma infraestrutura adicional é requisito para essa continuação.
