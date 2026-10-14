import { hasFunction, type Access } from "./access";
export type CurrentRole = Access["role"];
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
    description: "Gestão de acessos, funções e vínculos com empresas.",
  },
  {
    id: "partners",
    path: "/partners",
    name: "Parceiros",
    roles: ["admin"],
    description:
      "Ambiente exclusivo de consulta às empresas vinculadas. Serviços, resultados, relatórios e documentos serão ampliados nas próximas etapas.",
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
export function canAccessModule(
  moduleId: string,
  subject: Access | CurrentRole,
) {
  const access: Access =
    typeof subject === "string"
      ? {
          role: subject,
          category:
            subject === "admin"
              ? "admin"
              : subject === "partner"
                ? "partner"
                : "employee",
          functions: subject === "sdr" || subject === "closer" ? [subject] : [],
          challenger:
            subject === "admin" || subject === "sdr" || subject === "closer",
        }
      : subject;
  if (!osModules.some((m) => m.id === moduleId)) return false;
  if (access.category === "admin") return true;
  if (access.category === "partner") return moduleId === "partners";
  if (moduleId === "dashboard") return true;
  if (moduleId === "crm")
    return hasFunction(access, "sdr") || hasFunction(access, "closer");
  if (moduleId === "challenger")
    return (
      access.challenger &&
      (hasFunction(access, "sdr") || hasFunction(access, "closer"))
    );
  if (moduleId === "clients")
    return access.functions.some((f) =>
      ["traffic", "designer", "video_editor", "copywriter"].includes(f),
    );
  if (moduleId === "analytics") return hasFunction(access, "traffic");
  return false;
}
