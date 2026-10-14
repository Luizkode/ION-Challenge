export type CurrentRole = "admin" | "sdr" | "closer";
export const osModules = [
  {
    id: "dashboard",
    path: "/",
    name: "Dashboard",
    roles: ["admin", "sdr", "closer"],
    description: "Visão geral da operação registrada no ION OS.",
  },
  {
    id: "crm",
    path: "/crm",
    name: "CRM Comercial",
    roles: ["admin", "sdr", "closer"],
    description:
      "Leads, pipeline, propostas e negociações serão implementados na Etapa 3. O cadastro de reuniões existente permanece disponível no Challenger.",
  },
  {
    id: "challenger",
    path: "/challenger",
    name: "ION Challenger",
    roles: ["admin", "sdr", "closer"],
    description: "Campanhas, reuniões, validações e rankings existentes.",
  },
  {
    id: "clients",
    path: "/clients",
    name: "Clientes e Serviços",
    roles: ["admin"],
    description:
      "Cadastro de clientes, contratos de prestação de serviços, responsáveis e entregas serão implementados na Etapa 4.",
  },
  {
    id: "analytics",
    path: "/analytics",
    name: "Analytics",
    roles: ["admin"],
    description:
      "Métricas por cliente, relatórios e integrações serão implementados na Etapa 6. Nenhuma métrica de mídia está sendo simulada.",
  },
  {
    id: "finance",
    path: "/finance",
    name: "Financeiro",
    roles: ["admin"],
    description:
      "Receitas, despesas, cobranças e comissões serão implementadas na Etapa 5. Contratos comerciais do Challenger não representam receita recebida.",
  },
  {
    id: "team",
    path: "/team",
    name: "Equipe",
    roles: ["admin"],
    description:
      "As funções múltiplas e atribuições por cliente serão implementadas nas Etapas 2 e 4. A gestão atual de colaboradores e participação em campanhas permanece disponível.",
  },
  {
    id: "partners",
    path: "/partners",
    name: "Parceiros",
    roles: ["admin"],
    description:
      "O portal exclusivo de consulta será implementado na Etapa 6, depois do isolamento de dados por empresa e das permissões da Etapa 2. Não há acesso de parceiros nesta etapa.",
  },
  {
    id: "settings",
    path: "/settings",
    name: "Configurações",
    roles: ["admin"],
    description:
      "As configurações da plataforma serão ampliadas progressivamente. As regras e configurações atuais do Challenger continuam disponíveis.",
  },
] as const;
export function canAccessModule(moduleId: string, role: CurrentRole) {
  const module = osModules.find((m) => m.id === moduleId);
  return Boolean(module && (module.roles as readonly string[]).includes(role));
}
