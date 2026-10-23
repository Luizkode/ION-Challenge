# Correção funcional de Equipe — 23/10/2026

## Estado da entrega

Entrega pela branch `fix/team-real-operations`, PR #11. Nenhuma migration nova foi necessária. Foram criados registros técnicos controlados nos serviços existentes para validação; a limpeza e a preservação dos registros anteriores são verificadas antes do encerramento. O SHA e o estado final da implantação são registrados na descrição do PR e no relatório privado de execução.

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

## Validação com os serviços reais

Após a atualização segura dos segredos, Supabase Management e o projeto existente da Vercel responderam HTTP 200. Nenhum valor de credencial foi registrado no código ou neste relatório.

Foram concluídas 29 verificações nos serviços reais: PostgREST, Supabase Auth, Storage e uma transação SQL revertida no banco atual. Também passaram 15 fluxos no navegador com a compilação do PR conectada ao Supabase real. Não houve interceptação ou substituição das respostas por fixtures nesses cenários.

| Área | Evidência real |
| --- | --- |
| Equipe | Promoção SDR → ADM com remoção atômica da campanha; bloqueio sem a confirmação; retorno a SDR e reinclusão; persistência de funções e empresas; desativação bloqueando sessão aberta; reativação; bloqueio de autoexclusão administrativa e de escalonamento por outros perfis. |
| Convites/Auth | Auth aceitou um convite e criou identidade ainda não confirmada, sem perfil implícito; vínculo pela interface, callback com token real, definição de senha, logout e novo login; RPCs `begin_access_invite`/`complete_access_invite` com status `completed`; rejeição de UUID de outro destinatário e de sobrescrita de perfil existente. Os tokens para ensaiar ativação foram emitidos pelo Auth administrativo exclusivamente para contas técnicas; isso não comprova transporte/recebimento de email. |
| Empresas/Parceiros | Produção consulta empresa atribuída e não consulta outra; parceiro recebe somente a projeção autorizada da empresa vinculada, sem acesso direto às tabelas internas ou a métricas não publicadas. |
| CRM/Clientes | Lead, atividade, agendamento, validação pelo closer, fechamento, confirmação e conversão para cliente/contrato operacional persistidos; repetição da conversão não duplica o cliente. |
| Serviços | Serviço atribuído à Produção, atualizado para concluído e consultado com persistência. |
| Challenger | Inclusão/remoção de participantes refletida no ranking; campanha do iPhone mantida em configuração. Agendamento sem pontos antes da validação e pontos após validação do closer foram conferidos no banco real dentro de transação integralmente revertida, sem ativação permanente da campanha. |
| Analytics | Resultado manual, snapshot de relatório, importação CSV e identificação de reenvio sem duplicação; PDF autenticado gerado pela aplicação. Integrações Meta/Google permanecem fora desta correção. |
| Financeiro | Lançamento técnico de R$ 0,01, idempotência, baixa, estorno integral e cancelamento, sem operação bancária externa; saldo líquido zero conferido antes da limpeza; CSV autenticado retornado pela aplicação. |
| Documentos | Upload real no bucket existente, confirmação de metadados, bloqueio do parceiro antes da publicação e download autorizado após publicação; conteúdo conferido por SHA-256. |
| Dashboard/Configurações | SSR autenticado dos nove módulos no endereço publicado; navegação e bloqueios para Administrador, SDR, Closer, Produção e Parceiro; regras existentes não alteradas. |

A navegação da branch foi testada em computador e celular. No endereço público, as verificações usam HTTPS autenticado com validação TLS ativa. O Chromium desta execução não confia na CA de rede atual, e não houve permissão para gravar no seu armazenamento de certificados; por isso não se afirma que houve teste visual direto do endereço público nesse navegador. A interface da branch foi exercitada com os serviços reais, e a publicação é conferida separadamente pelo SHA e pelas respostas autenticadas do servidor.

## Causa externa confirmada nos convites

O projeto ainda utiliza o envio padrão do Supabase, sem SMTP próprio, com `rate_limit_email_sent = 2`. Um convite foi aceito pelo Auth, mas tentativas posteriores receberam HTTP 429, `email rate limit exceeded`. A interface corrigida mostrou o limite específico, preservou o preenchimento e não anunciou sucesso nem concedeu perfil após essa rejeição.

A ausência de SMTP próprio, isoladamente, não foi usada como prova de que todo convite falha: houve aceitação real pelo provedor. O envio completo pela interface ficou limitado pela cota compartilhada durante esta execução. O recebimento em uma caixa autorizada continua **não comprovado**. Para uso diário confiável, configurar SMTP próprio no mesmo Supabase e verificar recebimento, links e limites com uma caixa controlada. Não aumentar/remover limites ou confirmar contas comerciais artificialmente para contornar esse bloqueio.

## Recuperação e preservação

Antes dos testes e da publicação, foi capturado um snapshot coerente do estado atual: 64 tabelas e 979 registros de `public`/Auth. A cópia foi restaurada em PostgreSQL 17 nativo temporário, com comparação integral dos registros, validação de todas as FKs e ensaio de escrita auditada com rollback. A comparação do catálogo conferiu 537 funções, políticas e constraints com o banco atual, sem divergências.

A cópia criptografada está no bucket privado de recuperação existente; sua chave está em variável privada criptografada do mesmo projeto Vercel. O arquivo foi baixado novamente e decifrado com a chave lida da Vercel. O manifesto documenta formato, escopo e procedimento. O provedor não listou backups gerenciados disponíveis nem PITR ativo: a cópia lógica verificada não é apresentada como PITR ou snapshot completo dos serviços externos.

A restauração é para infraestrutura Supabase compatível e preserva as configurações/signing keys do projeto existente. As migrations foram utilizadas apenas na restauração temporária; nenhuma foi reaplicada em produção. A limpeza remove somente identidades e registros técnicos desta execução, conserva a auditoria e verifica registros comerciais anteriores, campanha e identidades/senhas/bloqueios existentes. Quando um ator técnico é retirado, seu UUID permanece na justificativa de auditoria antes da remoção da referência ao perfil temporário. Contadores de invalidação de cache podem avançar normalmente.

## Regressão local já concluída

Resultados anteriores preservados, sem repetir suítes completas: 118 testes aprovados, 24 cenários de Equipe/permissões e 2 de cadastro de reunião do Challenger em computador/celular; build e tipagem aprovados. Esses cenários de navegador usam fixtures e os testes SQL usam PGlite; seus resultados são distintos das verificações reais acima. A compilação adicional conectada ao projeto Supabase atual também terminou sem erro. A chave de serviço não foi encontrada nos arquivos estáticos destinados ao navegador.
