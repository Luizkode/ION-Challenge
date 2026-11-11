# Participação automática dos SDRs

As campanhas do Challenger direcionadas aos SDRs (`audience=sdr`, padrão das
campanhas criadas no painel) incluem todos os colaboradores ativos com função
SDR. A elegibilidade usa a função efetiva, inclusive em contas com múltiplas funções.
O perfil legado isoladamente não determina a participação.

A migration 020 acrescenta sincronização transacional para campanhas, perfis e
funções. Triggers diferidos consideram a situação final da transação: substituir
as funções de uma pessoa não causa remoções intermediárias indevidas. As operações
são serializadas antes de locks de linha e usam a chave existente
`(campaign_id,profile_id)`, sem duplicar vínculos.

- Novo SDR ou concessão de SDR: inclui em todas as campanhas SDR em configuração
  ou ativas, inclusive simultâneas.
- Desativação/perda da função: encerra participação ativa, sem apagar vínculo,
  oportunidades, reuniões, validações, contratos ou pontuações históricas.
- Reativação/retorno da função: restaura a mesma linha e a equipe anteriormente
  vinculada, sem criar pontos nem replicar resultados.
- Campanhas encerradas/finalizadas: não recebem participantes retroativamente e
  suas participações históricas não são sincronizadas com alterações futuras.
- Retirada individual de um SDR elegível não é oferecida nem aceita pelo RPC.
  O ADM gerencia função e ativação na Equipe. Permanecem as confirmações e a
  proteção do último administrador.

## Equipes e rankings

Participar é independente de ter equipe. As equipes já vinculadas são preservadas.
Um vínculo ausente só recupera uma equipe quando há uma única equipe comprovada
nas oportunidades da própria campanha; nunca escolhe outro time ou outra campanha.
Nos demais casos o SDR aparece como **Sem equipe definida**, participa do ranking
individual e pode agendar. Somente o ADM define sua equipe explicitamente.

A atribuição administrativa continua respeitando capacidade e histórico. Restaurar
um vínculo antigo não move o colaborador para outro time caso a vaga tenha sido
reutilizada: a participação e a equipe original são restauradas, e eventual excesso
de capacidade precisa de revisão do ADM. Novas alocações em equipe cheia são
bloqueadas. O sincronizador não redistribui equipes nem reescreve oportunidades.

O ranking individual usa `LEFT JOIN` para não ocultar pessoas sem equipe. Rankings
de equipe continuam usando os vínculos reais. Fórmulas, validação, desempate,
prêmio e meta coletiva permanecem os existentes; inclusão/restauração de participante
não cria pontuação. Resultados prévios do mesmo SDR retornam ao ranking quando ele
volta a ser elegível, sem serem concedidos novamente.

## Campanhas simultâneas e CRM

A restrição de uma única campanha aberta foi substituída por seleção explícita no
Challenger, cadastro de reunião e ADM. O padrão é a campanha ativa mais antiga;
criar uma campanha futura não troca silenciosamente a campanha principal.

Cada reunião continua tendo **uma** oportunidade e **uma** campanha, sem réplica
no CRM/Challenger. O CRM escolhe deterministicamente a primeira campanha ativa
compatível com o período e participação do SDR; sem elegibilidade, continua
agendando comercialmente sem pontos. No cadastro do Challenger o usuário pode
escolher explicitamente outra campanha. Não há multiplicação de pontos entre
campanhas simultâneas. O ADM continua controlando configuração, ativação e término.

## Migração, testes e recuperação

A evolução é incremental e não altera os valores dos registros comerciais ou das
fontes de pontuação. A correção inicial sincroniza somente campanhas SDR em
configuração/ativas. O estado anterior foi copiado de forma coerente para o bucket
privado de recuperação existente, criptografado, baixado, descriptografado e
restaurado em PostgreSQL 17 isolado, com hashes e FKs verificados. O replay serve
para verificação isolada e não para reset de produção; binários do Storage não
são alterados nem incluídos no dump de registros.

Testes SQL cobrem funções combinadas, nova conta, desativação, promoção, retorno,
idempotência, equipes, transações inválidas, múltiplas campanhas, campanhas
históricas e integração com CRM/validação. Os testes de navegador com fixture HTTP
são distintos das verificações reais de Auth, RPCs, RLS e persistência no Supabase.
Somente contas e campanhas técnicas novas são usadas para mutações de teste.
