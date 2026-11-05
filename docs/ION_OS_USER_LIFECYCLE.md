> Fluxo atual: consulte [Administração simplificada](ION_OS_ADMIN_SIMPLIFICATION.md). A remoção agora exige apenas “Remover usuário” e “Remover definitivamente”; o procedimento abaixo registra a implementação anterior e sua compatibilidade.

# Ciclo de vida dos usuários — migrations 013 e 014

## Incidente e diagnóstico real

Em 04/11/2026, uma conta técnica nova reproduziu `Database error deleting user`
na API administrativa do Supabase Auth. Uma segunda reprodução, em transação
revertida, identificou SQLSTATE `23503`, constraint `profiles_id_fkey`:
`profiles.id` referenciava diretamente `auth.users.id`, com `NO ACTION`.

Também existia `access_invitations_auth_user_id_fkey`, igualmente restritiva.
As referências ao perfil incluem funções, empresas, participantes e autores de
remoções, vencedor de campanha, oportunidades, closer de reuniões, validações,
contratos, CRM, atribuições de serviços, Analytics, Financeiro e auditoria.
Remover o perfil primeiro não é uma solução geral.

O inventário real verificou constraints, triggers e políticas. Não havia trigger
personalizado de exclusão em `auth.users`. Os triggers de perfil eram auditoria,
bootstrap de acesso e invalidação de cache. A RLS não era a origem do SQLSTATE:
a API administrativa continua sujeita à integridade referencial. O Storage não
tinha objetos com proprietário no momento da investigação, mas propriedade de
arquivos é verificada separadamente porque não depende de uma FK de perfil.

## Operações distintas

| Operação | Login | Perfil e resultados | Reversibilidade |
| --- | --- | --- | --- |
| Desativar | Permissões da aplicação bloqueadas imediatamente, inclusive em JWT existente | Mantidos | Reativação administrativa pelo fluxo existente |
| Anonimizar cadastro e remover login | Identidade Auth removida | UUID histórico e vínculos mantidos; nome cadastral substituído; perfil inativo | Login removido não pode ser reativado nesse perfil |
| Excluir conta de teste sem histórico | Identidade Auth removida | Perfil e vínculos exclusivamente de acesso removidos; autoria/auditoria e convites retidos | Irreversível; exige confirmação de que é conta de teste |

A anonimização **cadastral** não representa eliminação completa de dados pessoais:
nomes/emails podem permanecer em snapshots de auditoria, convites e documentos
históricos sujeitos à política de retenção. Nenhum documento comercial é apagado.
A participação e os resultados do Challenger não são removidos automaticamente.

## Estrutura e segurança

- `profiles.id` continua sendo o UUID estável dos registros comerciais; todas as
  referências comerciais permanecem restritivas e inalteradas.
- `profiles.auth_user_id` identifica o login atual. O backfill mantém exatamente
  os UUIDs existentes; um vínculo encerrado não pode ser reativado ou reassociado.
- `audit_logs.actor_reference` e `access_invitations.auth_user_reference` retêm o
  UUID original quando a FK opcional usa `SET NULL`. Snapshots anteriores permanecem.
- Nenhum `CASCADE` de negócio foi acrescentado. Os cascades internos do Auth
  continuam sob responsabilidade do Supabase.
- Somente funções, vínculos de empresas e concessões de consulta do próprio usuário
  podem ser removidos na exclusão sem histórico. Participação, autoria comercial,
  financeira, atribuições e novas FKs futuras impedem a exclusão definitiva.
- Contas proprietárias de arquivos exigem revisão da propriedade; não se apagam
  objetos para viabilizar a remoção. Prefira desativar nesse caso.
- `user_lifecycle_operations` guarda administrador, alvo, justificativa,
  confirmação identificada por UUID, status e conclusão/cancelamento. UUIDs de
  auditoria não desaparecem com o usuário. RLS de leitura apenas administrativa;
  nenhuma escrita direta é concedida a `authenticated` ou `anon`.
- Confirmações irreversíveis expiram em 15 minutos. O mesmo request ID pode ser
  repetido para conferir uma conclusão sem executar uma nova remoção.
- A aplicação valida a sessão no servidor; a chave administrativa permanece
  exclusivamente no servidor. O banco revalida permissões, autoexclusão, último
  ADM, propriedade de Storage e dependências antes da execução.
- Um trigger no Auth exige uma solicitação administrativa válida. A limpeza e a
  conclusão do ledger fazem parte da transação do Auth: uma falha posterior
  reverte ambas. Falha de rede não é anunciada como sucesso e não restaura acesso.
- Exclusão direta/soft-delete no painel do Auth é bloqueada deliberadamente.
  Use o ION OS; não desabilite triggers ou RLS para contornar o procedimento.
- Enquanto houver solicitação de remoção pendente, o perfil não pode ser reativado,
  mesmo pelo fluxo legado de permissões. Pendências têm prioridade no histórico.
- Uma solicitação pendente pode ser encerrada em Equipe → Histórico de ciclo de
  vida. Isso mantém o perfil inativo. Confira o estado antes de uma nova solicitação.

## Como tratar as contas de teste já existentes

1. Entre como ADM e abra **Equipe**, expandindo exclusivamente a conta de teste
   identificada pelo nome e pelo UUID do Supabase. Não selecione contas em lote.
2. Abra **Ciclo de vida da conta → Consultar dependências**.
3. Se não houver histórico nem propriedade de arquivos, selecione **Excluir conta
   de teste sem histórico**. Informe o motivo, digite o UUID completo e marque as
   confirmações de teste e impacto. Confirme o diálogo final.
4. Se houver participação/autoria/atribuições, não force a exclusão. Selecione
   **Desativar acesso**, ou **Anonimizar cadastro e remover login** quando a
   remoção irreversível da identidade for apropriada. Os históricos permanecem.
5. Confira o feedback, o histórico da operação e o resultado após recarregar.
   Se o resultado for incerto, repita a mesma solicitação ou encerre a pendência
   antes de iniciar outra. Não tente contornar a proteção pelo painel do Auth.

Contas Auth sem perfil não aparecem nesta listagem; devem passar por avaliação
individual de manutenção autorizada, usando as mesmas funções administrativas,
sem exclusão direta ou em massa. As contas existentes não foram removidas nesta
entrega; somente novas contas técnicas foram utilizadas na validação.

## Implantação e recuperação

As migrations `013_user_lifecycle.sql` e `014_user_lifecycle_pending_guard.sql` são incrementais e foram validadas sobre uma
restauração do estado atual antes da aplicação. Não recriam o banco nem trocam o
projeto. Mantêm compatibilidade com UUIDs, autenticação e RPCs existentes.

Antes da aplicação, foi capturada uma cópia coerente de 64 tabelas public/Auth,
criptografada e armazenada no bucket privado de recuperação existente. A chave
fica protegida no ambiente servidor da Vercel; o manifesto privado registra
objeto, SHA-256 e nome da variável, sem valores de credenciais no repositório.
O objeto remoto foi baixado e descriptografado, e a restauração isolada em
PostgreSQL 17 conferiu todos os hashes, FKs e escrita com rollback. Isso comprova
a cópia e a restauração testada; não afirma disponibilidade de PITR gerenciado.

O pacote de replay nativo é destinado à verificação isolada, não é um script para
resetar produção. Recuperação real exige infraestrutura Supabase compatível,
controle de escrita e autorização. O snapshot não inclui os binários do Storage,
que não foram alterados. Após anonimizações, não se pode simplesmente restaurar
a FK antiga: perfis históricos passam intencionalmente a existir sem login.

## Validação

- Testes PostgreSQL locais: permissões, último ADM, autoexclusão, confirmação,
  idempotência, expiração, novas dependências após confirmação, Storage,
  rollback de falha posterior e preservação de autoria/convites.
- Testes de navegador desktop/mobile: confirmações, erro por campo, consulta de
  dependências, bloqueio de participante e exclusão refletida após recarregamento.
  São testes de interface com serviço simulado e não comprovam o Auth externo.
- Serviços reais: reprodução da falha antiga; Auth API e JWTs técnicos para
  desativação, reativação, RLS, bloqueio de autoexclusão, exclusão sem solicitação,
  bloqueio por CRM, anonimização com CRM intacto, exclusão definitiva sem histórico,
  retenção de UUIDs em auditoria/convites e repetição idempotente.
- Nenhum convite/email externo é necessário ou foi enviado.
