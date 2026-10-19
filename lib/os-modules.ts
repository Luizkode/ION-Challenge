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
      "Leads, atividades, reuniões, propostas e negociações integradas ao Challenger.",
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
      "Clientes, contratos, serviços, responsáveis e documentos operacionais.",
  },
  {
    id: "analytics",
    path: "/analytics",
    name: "Analytics",
    roles: ["admin"],
    description:
      "Resultados reais por cliente, campanhas, relatórios e publicação controlada para parceiros.",
  },
  {
    id: "finance",
    path: "/finance",
    name: "Financeiro",
    roles: ["admin"],
    description:
      "Receitas, despesas, mensalidades, comissões, cobranças e relatórios financeiros auditáveis.",
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
      "Consulta exclusiva a resultados, serviços, relatórios e documentos publicados para empresas vinculadas.",
  },
  {
    id: "settings",
    path: "/settings",
    name: "Configurações",
    roles: ["admin"],
    description:
      "Conta, permissões, publicações, integrações e regras das campanhas existentes.",
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
    return (
      access.crm === true ||
      hasFunction(access, "sdr") ||
      hasFunction(access, "closer")
    );
  if (moduleId === "challenger")
    return (
      access.challenger &&
      (hasFunction(access, "sdr") || hasFunction(access, "closer"))
    );
  if (moduleId === "clients")
    return (
      access.clients === true ||
      access.functions.some((f) =>
        ["traffic", "designer", "video_editor", "copywriter"].includes(f),
      )
    );
  if (moduleId === "analytics")
    return access.analytics === true || hasFunction(access, "traffic");
  return false;
}
