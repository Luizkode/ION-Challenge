# ION OS — estabilização operacional, 29/10/2026

**Liberação oficial bloqueada pelo aceite de email.** O usuário confirmou ausência de identidade de envio/provedor configurados e não autorizou envio para endereços reais nesta execução. As correções de software prontas e seguras seguem pelo repositório/Vercel existentes; isso não equivale a aprovar a entrada oficial de colaboradores/parceiros.

## Defeitos encontrados e correções

1. **Recuperação sem entrada na interface:** existiam callbacks de recuperação e definição de senha, mas nenhuma ação para solicitar recuperação. O login agora oferece “Esqueci minha senha”, dentro da mesma estrutura visual. A solicitação usa a chave pública e o Auth padrão, sem cliente administrativo; valida email no servidor e utiliza somente a origem configurada no servidor. Respostas públicas uniformes não confirmam a existência da conta nem afirmam entrega. Falhas registram apenas status operacional, sem email, senha, token ou corpo do provedor.
2. **Política de senha divergente:** o Supabase exigia seis caracteres enquanto o formulário da aplicação exigia 12. O mínimo no Auth foi alinhado a 12, após cópia verificável e registro privado da configuração anterior. Um pedido real com senha de seis caracteres foi rejeitado e a senha permaneceu inalterada. Cadastro público desativado, confirmação de email e limite de envio foram preservados; senhas existentes não foram redefinidas.
3. **Privacidade de callback:** o header global prevalecia sobre a proteção específica do callback. As rotas `/auth/*` agora recebem `Referrer-Policy: no-referrer`; o callback mantém cache privado desabilitado. O teste verifica o header HTTP efetivo, não somente o código que o define.
4. **Dependências vulneráveis:** o audit inicial apontou um pacote crítico (Next.js 16.4.0, com avisos de RCE/DoS) e um de alta severidade (Zod 3.25.76, validação de coleções). Foram atualizados para Next.js **16.4.3** e Zod **4.6.7**, com lockfile fixado. A adaptação mínima ao Zod 4 mantém mensagens em português e a aceitação anterior de GUIDs compatíveis com PostgreSQL, inclusive identificadores legados; não utiliza o parser antigo vulnerável por um caminho de compatibilidade. Regras de negócio, RLS, pontuação e identidade visual não foram reformuladas.

Referências dos avisos retornados pelo audit: [Next/SVG](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Next/Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), [Next/use cache](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## SMTP e aceite pendente

Decisão: **Resend Free**, diretamente no Auth do projeto atual. Plano consultado: 3.000 emails/mês e 100/dia; conferir os limites do provedor ao cadastrar a conta. O domínio de envio precisa pertencer à agência. Reutilizar um domínio existente, se houver; caso contrário, seu registro é uma aquisição externa separada do SMTP gratuito. Não usar o domínio `vercel.app` como remetente da agência.

Não há conta/credencial de provedor ou domínio corporativo no inventário acessível. Permanecem necessários: domínio e controle DNS, conta Resend, verificação dos registros fornecidos pelo provedor, remetente e credencial protegida. Depois, autorização de caixas de teste e confirmação de recebimento/uso dos links. Não é necessário criar outro Supabase, Vercel ou repositório.

[Runbook de integração e critérios de aceite](ION_OS_SMTP_RUNBOOK.md). Templates de convite/recuperação estão preparados em `supabase/auth-templates/`, mas **não foram aplicados ao Auth** nem enviados. O limite atual de dois emails/hora não foi aumentado para forçar testes. No navegador, casos contra fixture local cobrem os contratos de convite de SDR, closer, Produção e Parceiro e a recuperação; isso **não comprova entrega**.

Permanecem sem aceite por email real: recebimento, abertura do link recebido, definição de senha a partir desse email, primeiro login/destino/permissões de cada perfil convidado e recuperação em outro navegador. Não foram substituídos por tokens gerados administrativamente para declarar sucesso de envio.

## Verificações atuais com serviços reais, sem envio

Foram concluídas **25 verificações em Supabase/Auth/Storage reais**, usando contas técnicas para permissões e dados controlados. A criação administrativa dessas contas é preparação de testes de módulos, não prova do fluxo de convites. Não foram chamados os endpoints reais de disparo de convite ou recuperação.

| Módulo              | Operações verificadas                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard           | Consulta autenticada dos indicadores e navegação dos perfis; dados e permissões fornecidos pelo Supabase atual.                                                                                                                      |
| CRM Comercial       | Lead e atividade, agendamento, consulta pelo closer, validação, negociação ganha, contrato e conversão operacional persistidos.                                                                                                      |
| ION Challenger      | Inclusão, remoção, reinclusão e efeito no ranking; promoção com remoção atômica e bloqueio sem confirmação. Agendamento sem pontos e pontuação após validação conferidos em transação real revertida; campanha original em rascunho. |
| Clientes e Serviços | Cadastro, atribuição, isolamento entre empresas, conversão CRM sem duplicação, contrato/serviço e conclusão pela Produção.                                                                                                           |
| Analytics           | Resultado manual, snapshot de relatório, importação e reenvio idempotente. Meta Ads e Google Ads permanecem explicitamente desativados.                                                                                              |
| Financeiro          | Criação idempotente, baixa, estorno integral e cancelamento de lançamento técnico de R$ 0,01; sem operação bancária externa; saldo líquido zero antes da limpeza.                                                                    |
| Equipe              | Categorias, múltiplas funções, empresas, promoção/remoção de permissões, desativação/reativação e bloqueios de autoexclusão/escalonamento.                                                                                          |
| Parceiros           | Projeção da empresa vinculada, bloqueio de outra empresa e de dados internos/não publicados; documento só autorizado após publicação.                                                                                                |
| Configurações       | Leitura administrativa, encaminhamentos existentes e ausência de conexão operacional com provedores de Ads.                                                                                                                          |
| Auth/Documentos     | Login técnico por senha, rejeição de senha fraca pelo Auth e upload/confirmação de arquivo no Storage real.                                                                                                                          |

Os checks de segurança das Etapas 2–7 passaram no banco atual: RLS, privilégios de escrita, helpers privados, proteção CRM, download autenticado e constraints validadas. Não foram reaplicadas migrations nem flexibilizadas políticas. O exercício de campanha ativa ocorreu somente em transação com rollback, sem ativação permanente ou mudança de prêmio/regras.

## Regressão e implantação

- **120 testes de lógica aprovados** na versão atualizada.
- **112 cenários funcionais de navegador aprovados**, em computador/celular, incluindo formulários de todos os módulos, convites por quatro perfis contra fixture, recuperação, erros, isolamento e acessibilidade. A matriz de capturas puramente visual não foi repetida. Esses testes usam serviços locais controlados, separados das verificações reais acima.
- Build e tipagem aprovados; `npm audit` completo e de produção sem vulnerabilidades reportadas na execução após a atualização.
- **10 cenários adicionais de navegador conectado ao Supabase real passaram**, incluindo promoção persistida, bloqueio da sessão aberta, reativação, quatro perfis no celular e arquivos/exportações reais. A recuperação foi testada com email inválido, rejeitado antes de disparo. As verificações da versão publicada são registradas no relatório privado e na descrição do PR, com o SHA do deployment. Nenhum caso de disparo de email real é autorizado nessa etapa.

## Recuperação e preservação

Cópia atual anterior aos testes: **64 tabelas e 1.191 registros** de public/Auth, restaurada em PostgreSQL 17 nativo, com comparação integral dos registros, FKs e escrita auditada revertida. As 537 funções/políticas/constraints conferidas coincidem com o banco atual. Artefato cifrado no bucket privado de recuperação existente, chave protegida na Vercel e download/decifragem conferidos; não é apresentado como PITR gerenciado.

A configuração anterior da política Auth foi arquivada privadamente. O único ajuste aplicado ao Auth nesta etapa é o mínimo de senha; SMTP/templates/limites não foram alterados. A limpeza remove somente contas, arquivo e registros técnicos da execução, conserva a auditoria e confere os registros originais e senhas/bloqueios Auth antes de encerrar. Os identificadores dos atores técnicos permanecem na justificativa da auditoria ao retirar seus perfis temporários. Nenhuma cópia decifrada ou credencial é incluída no Git.

O status final de limpeza, publicação e preservação consta na descrição do PR e no relatório privado de execução. A publicação de correções de segurança não encerra a pendência SMTP nem libera a operação oficial por si só.
