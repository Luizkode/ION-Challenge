# Etapa 4 — Clientes e Serviços

## Arquitetura e operação

O cadastro de empresas continua em `access_companies`, com os vínculos de `client_assignments` e `partner_companies`. As migrations **005_clients_services.sql** e **006_operational_conversion_matching.sql**, após 004, acrescenta o perfil operacional, notas administrativas separadas, catálogo, contratos/aditivos, serviços, atribuições, atualizações e documentos. Nenhum cliente comercial é duplicado automaticamente.

`/clients` apresenta indicadores SQL reais, busca por empresa/contato/telefone, filtros por cliente, relacionamento, responsável, catálogo e status, com paginação de 30 clientes. `/clients/new` cadastra ou completa uma empresa existente; `/clients/[id]` reúne contratos, serviços, documentos e histórico. O Dashboard principal incorpora clientes, serviços em execução e atrasos autorizados.

O ADM cadastra e edita clientes, notas, contratos e catálogo; atribui múltiplos colaboradores; acompanha entregas e publica informações. Colaboradores acessam o cliente atribuído ou com serviço/contrato sob sua responsabilidade. Atribuição de cliente **não** concede acesso aos demais serviços: cada serviço exige vínculo próprio. Valores e detalhes contratuais ficam restritos ao ADM e ao responsável interno. Notas administrativas ficam exclusivamente com ADM.

Serviços possuem contrato e catálogo, descrição interna, texto autorizado para parceiro, datas, prazo, status, responsáveis e histórico. Conclusão exige data de entrega. Versões impedem sobrescrita concorrente. Catálogo inativo preserva os serviços e o histórico existentes. Não há módulo independente de tarefas nem contas a receber.

## Integração com o CRM

No fechamento confirmado, ADM pode abrir **Criar ou vincular cliente operacional** ou usar o formulário de importação em Clientes e Serviços. `ops_from_crm` verifica contrato comercial ativo, reunião validada e resultado ganho. Reutiliza dados do lead, identifica empresa por vínculo explícito, telefone/email ou nome, e cria um contrato operacional em preparação ligado ao contrato comercial original.

A operação usa transação e bloqueio, com índices únicos por origem. Correspondências conflitantes entre telefone e email exigem seleção explícita do cliente, impedindo vínculos automáticos ambíguos. Repeti-la retorna o mesmo cliente/contrato. O responsável interno pode ser escolhido, permitindo importar fechamentos cujo SDR de origem foi desativado. O histórico e o SDR comercial não são alterados.

Cancelamento/correção no CRM não apaga nem encerra automaticamente serviços e clientes. Alertas comparam estado e revisão auditada da origem. ADM deve confirmar e justificar manter, pausar ou cancelar o contrato operacional. Novas alterações na origem podem exigir nova revisão. Rankings e pontuação continuam usando exclusivamente os registros/funções do Challenger.

## Storage e documentos

Bucket **privado `ion-os-documents` no Supabase existente**, até 10 MB por arquivo. Formatos: PDF, PNG/JPEG/WebP, texto, DOCX e XLSX. Não usa chave administrativa no navegador.

O upload reserva metadados por RPC autorizada, envia o binário diretamente ao Storage com a sessão do usuário e confirma autoria, tamanho e MIME registrados pelo Storage. As políticas exigem reserva própria, escopo autorizado e prazo de uma hora, sem sobrescrita. Arquivos pendentes não são disponibilizados. Falhas de rede podem deixar reservas pendentes; os binários correspondentes permanecem inacessíveis até confirmação válida.

Downloads validam novamente o acesso e geram links assinados de **60 segundos**. Revogar acesso impede novos links; um link já emitido permanece válido até expirar. Arquivar preserva metadados e binário. A interface identifica nome, tipo, data e autor do envio; documentos podem pertencer ao cliente, contrato ou serviço.

## Parceiros

Portal exclusivamente de consulta. Nada operacional é publicado por padrão. ADM autoriza o cliente e, separadamente, serviços, contratos, resumos e arquivos. Colaborador pode propor resumo, mas não publicá-lo.

`ops_partner_snapshot` usa projeção explícita: não retorna valores contratuais, briefing interno, anotações administrativas ou autores. As tabelas operacionais não são diretamente legíveis por parceiros. Downloads exigem autorização do cliente, documento e respectivo serviço/contrato, além do vínculo do parceiro. Não existem mensagens, solicitações, aprovações ou edição no portal.

## Verificação e recuperação

`npm test` cobre validação, RPCs, RLS, isolamento, contratos/aditivos, CSV/CRM legado, conversão idempotente, revisão de cancelamento, permissões e regras de Storage. O modelo SQL de Storage nos testes locais **não substitui** a validação real de upload/download no serviço externo.

`npm run test:browser` compila a aplicação e testa desktop/celular, incluindo clientes, serviços, documentos e regressão das etapas anteriores. `stage_4_security.sql` verifica RLS, ACLs, bucket privado, políticas e integridade.

Antes da migração: exportação real de public/auth, restauração em PostgreSQL17, comparação exata de hashes/contagens e download/decriptação da cópia remota. JSON é preservado como bytes gerados no PostgreSQL, evitando alterar escalas decimais de auditoria. A migração é ensaiada nessa restauração; Storage usa o modelo de colunas conferido no projeto real. Produção recebe a migração numa transação com comparação dos registros públicos anteriores.

A cópia lógica cifrada não é PITR integral da infraestrutura. Não havia arquivos operacionais anteriores à Etapa 4; buckets/arquivos de recuperação existentes são preservados. Manifesto, instruções e resultado ficam no bucket privado de recuperação, com chave protegida na Vercel. Nenhuma nova variável de aplicação é necessária.

Limites de consulta: 200 contratos, serviços, documentos e atualizações recentes por página individual; 100 fechamentos no seletor de importação. Indicadores SQL não têm esses limites. O vínculo direto a partir do CRM continua disponível por ID para fechamentos antigos.
