# Challenger — correção administrativa de campanha (04/11/2026)

## Causa confirmada em produção

A consulta de `campaign_participants` em `/admin` usava `profiles(name)`, mas
há duas chaves estrangeiras para `profiles`: `profile_id` (participante) e
`removed_by` (administrador que removeu). O PostgREST responde HTTP 300,
`PGRST201`, por relacionamento ambíguo. A verificação genérica propagava o erro
para o limite de erros da página, que sugeria incorretamente uma falha de conexão.
Os logs de runtime da Vercel confirmaram o erro na consulta da página administrativa.

A correção especifica `profiles!campaign_participants_profile_id_fkey(name)`.
Nenhuma política RLS, permissão ou relacionamento foi relaxado ou removido.
A consulta corrigida foi executada com um token Auth administrativo real e
retornou os quatro participantes existentes, sob as políticas atuais.

## Campanha e CRM

A campanha do iPhone 13 está em `draft`, com início e término nulos. O bloqueio
no cadastro exclusivo do Challenger é esperado e tem causa diferente do erro
administrativo. Nenhuma ativação foi executada.

`crm_schedule_meeting` já permite agendamento sem campanha elegível: oportunidade
sem campanha/time, reunião agendada e pontuação zero no Challenger. Esse fluxo
foi confirmado no banco real. A tela bloqueada do Challenger agora explica a
distinção e oferece o acesso ao CRM Comercial.

## Validação

- 120 testes unitários/SQL locais aprovados.
- 38 casos de navegador aprovados, desktop e mobile, nos fluxos de participantes,
  cadastro de reuniões e CRM. O simulador HTTP agora reproduz o erro real de
  relacionamento ambíguo; esses testes não comprovam serviços externos.
- Supabase real: configuração salva sem ativar/alterar a campanha; cadastro do
  Challenger rejeitado em rascunho; agendamento pelo CRM atribuído ao SDR/closer;
  validação pelo closer sem pontos; campanha e ranking inalterados.
- As operações de escrita desse conjunto foram revertidas em uma transação real.
- Sessão Auth administrativa real: permissões atuais, leitura RLS e consulta
  corrigida de participantes verificadas. Conta técnica temporária sem convite.

Não há migration, alteração de regra de pontuação ou necessidade de novas
variáveis de ambiente. O SMTP pendente não participa desse erro e nenhum email
foi enviado. A publicação deve manter o projeto e o endereço existentes.
