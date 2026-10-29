# ION OS — configuração transacional e aceite de convites

Estado observado em 29/10/2026: Supabase e Vercel acessíveis; SMTP próprio ausente; limite do serviço padrão de **2 emails/hora**; Site URL e callback apontam para `https://ion-challenge-eight.vercel.app`. O projeto e a equipe da Vercel não listam domínio corporativo próprio. Não há credencial de provedor SMTP nem acesso a uma caixa de email de teste configurados no ambiente. Isso impede concluir o aceite de entrega; não deve ser tratado como convite operacional validado.

## Decisão técnica: Resend Free

Resend Free, diretamente no **Supabase Auth atual**, sem outro aplicativo ou banco. A página oficial consultada informa plano Free de US$ 0, 3.000 emails/mês e 100/dia, suficiente para a adoção inicial se esse teto atender ao volume total de convites, recuperações e notificações. Reavaliar limites/preços e contratar plano superior somente com autorização se o volume exigir. Não usar SMTP pessoal, conta Gmail/Outlook ou domínio pertencente à Vercel como identidade de envio.

Referências oficiais consultadas:

- [Preços Resend](https://resend.com/pricing).
- [SMTP Resend](https://resend.com/docs/send-with-smtp).
- [Domínios e autenticação Resend](https://resend.com/docs/dashboard/domains/introduction).
- [SMTP no Supabase Auth](https://supabase.com/docs/guides/auth/auth-smtp).
- [Templates de email Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).

**Autorização atual:** o usuário confirmou que ainda não dispõe de provedor/domínio de envio configurados e não autorizou envios para endereços reais nesta execução. Nenhum teste de convite ou recuperação deve disparar email externo até nova autorização de destinatários. Testes com fixtures são identificados separadamente.

## Dependências externas precisas

1. Domínio corporativo controlado pela Agência ION e autorização/acesso ao seu DNS. Nome e responsável ainda não informados. Não é necessário mudar o endereço do aplicativo. Pode-se reutilizar um domínio de site que a agência já controle; se não houver nenhum, seu registro é uma aquisição externa, com custo próprio do registrador, separado do SMTP Free.
2. Conta corporativa no Resend, ou identificação de outro provedor transacional existente. Não há credencial ou identidade de acesso disponível para criar/verificar a conta autonomamente.
3. Domínio de envio verificado no provedor, remetente corporativo e credencial SMTP protegida. Nunca enviar senhas ou chaves no chat, nem usar variáveis `NEXT_PUBLIC_*`.
4. Caixas controladas e autorizadas para os quatro perfis e recuperação. Aliases são aceitáveis somente se sua entrega real for confirmada. É necessário acesso de teste à caixa ou confirmação do responsável, sem compartilhar links/tokens pelo chat. Não é obrigatório contratar uma hospedagem de email adicional apenas para testar: podem ser endereços existentes ou aliases, desde que o responsável autorize e confirme seu recebimento.

Se o DNS do domínio estiver sob uma conta já acessível, reutilizar esse acesso. Os tokens atuais só fornecem gestão Supabase/Vercel; não há domínio corporativo na conta Vercel consultada nem identidade externa de provedor/DNS configurada.

## Domínio, DNS e remetente

Preferir um subdomínio dedicado, por exemplo `auth.<domínio-corporativo>`, e remetente como `acesso@auth.<domínio-corporativo>`, nome **ION OS · Agência ION**. Os nomes são exemplos, não registros aprovados ou domínio disponível.

| Item            | Verificação e ação                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domínio         | Cadastrar no provedor a identidade realmente controlada pela agência; confirmar região e status verificado.                                                              |
| DKIM            | Publicar exatamente o seletor e a chave pública fornecidos pelo provedor. Não inventar valores nem copiar registros de outro projeto.                                    |
| SPF/return-path | Publicar os registros fornecidos para o hostname de envio/bounce escolhido. Conferir registros existentes e evitar dois TXT SPF no mesmo nome.                           |
| MX              | Usar somente os registros que o provedor exigir para o subdomínio de retorno. Preservar o MX e o recebimento corporativo atuais.                                         |
| DMARC           | Conferir a política do domínio/subdomínio e alinhamento do From com DKIM/SPF. Preservar uma política corporativa existente; não enfraquecê-la para fazer o teste passar. |
| Tracking        | Desativar reescrita/rastreamento de links e abertura no domínio de autenticação. Validar links reais no cliente de email autorizado.                                     |
| Remetente       | Identidade corporativa verificada; credencial de envio restrita ao domínio quando o provedor permitir.                                                                   |

Conferir os registros nos servidores autoritativos e o status de verificação do provedor antes de configurar o envio. Não publicar SPF/DKIM/MX com placeholders.

## Configuração preparada para o Supabase existente

| Campo Auth                              | Valor proposto após verificação                                                |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `smtp_host`                             | `smtp.resend.com`                                                              |
| `smtp_port`                             | `465`, TLS implícito; alternativamente `587` com STARTTLS conforme o provedor. |
| `smtp_user`                             | `resend`                                                                       |
| `smtp_pass`                             | Credencial de envio, informada apenas em canal seguro.                         |
| `smtp_admin_email`                      | Remetente corporativo verificado.                                              |
| `smtp_sender_name`                      | `ION OS · Agência ION`                                                         |
| `site_url`                              | Manter `https://ion-challenge-eight.vercel.app`.                               |
| `uri_allow_list`                        | Manter o callback existente; não adicionar curingas ou destinos de terceiros.  |
| `disable_signup` / `mailer_autoconfirm` | Preservar `true` / `false`; usuários continuam por convite.                    |

A aplicação Next.js não precisa receber a senha SMTP: ela usa Auth; o transporte fica no Supabase. Para execução pelo ambiente, a credencial temporária deve ser disponibilizada como segredo privado autorizado para `api.supabase.com`, e removida quando não for mais necessária. Não imprimi-la ao preparar o PATCH.

Não elevar a cota do serviço padrão como solução. **Depois** de SMTP próprio verificado, conferir o limite de Auth aplicável — a documentação Supabase indica 30 mensagens/hora inicialmente para SMTP próprio — e manter limites adequados ao plano do provedor, por destinatário e por requisição. Não desabilitar limitação para executar testes.

Os campos `mailer_templates_invite_content` e `mailer_templates_recovery_content` correspondem aos arquivos `supabase/auth-templates/invite.html` e `recovery.html`, preparados para revisão/configuração do Auth; adicionar arquivos ao Git não aplica templates no Supabase. Usam `SiteURL`, `TokenHash` e tipo fixo, compatíveis com `/auth/callback`, permitindo confirmar o token em outro navegador sem depender do verificador PKCE da solicitação inicial. Os templates só serão considerados operacionais após renderização e validação em emails recebidos. Manter cópia da configuração anterior e possibilidade de reversão antes de aplicar.

## Aceite obrigatório — sem substituir entrega por geração de tokens

Para SDR, closer, Produção e Parceiro:

1. Registrar endereço autorizado, perfil, instante e ID interno da solicitação sem expor credenciais ou URL/token.
2. Enviar pela tela Equipe da versão publicada e conferir o registro/auditoria no Supabase.
3. Consultar evento do provedor e **confirmar a mensagem recebida na caixa controlada**, incluindo spam. Evento `delivered` comprova aceitação pelo servidor destinatário, não leitura pelo usuário.
4. Abrir o link recebido; conferir domínio/callback e que nenhum token permanece na navegação seguinte. Não substituir por `generate_link` administrativo como prova de entrega.
5. Definir senha conforme a política do servidor; sair e entrar novamente com a senha definida.
6. Confirmar o destino da categoria, funções/permissões e isolamento entre empresas. Novos SDRs não são inscritos automaticamente no Challenger.
7. Solicitar recuperação pela tela de login, receber o segundo email, abrir em outro navegador/dispositivo, definir nova senha e verificar que a anterior não funciona.
8. Conferir expirados/reutilizados, limites e bloqueio de usuário inativo; remover somente dados técnicos, conservando auditoria e registros anteriores.

A liberação operacional permanece bloqueada até concluir esse aceite. Testes de código com fixtures e tokens criados administrativamente não substituem recebimento e uso do email real.
