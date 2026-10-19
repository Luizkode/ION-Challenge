export const functionLabels = {
  sdr: "SDR",
  closer: "Closer",
  traffic: "Gestor de Tráfego",
  designer: "Designer",
  video_editor: "Editor de Vídeo",
  copywriter: "Copywriter",
} as const;
export type FunctionCode = keyof typeof functionLabels;
export type Category = "admin" | "employee" | "partner";
export type Access = {
  role: "admin" | "sdr" | "closer" | "member" | "partner";
  category: Category;
  functions: FunctionCode[];
  challenger: boolean;
  crm?: boolean;
  clients?: boolean;
  analytics?: boolean;
};
export function hasFunction(access: Access, code: FunctionCode) {
  return access.category === "employee" && access.functions.includes(code);
}
export function commercialAccess(access: Access) {
  return (
    access.category === "admin" ||
    hasFunction(access, "sdr") ||
    hasFunction(access, "closer")
  );
}
