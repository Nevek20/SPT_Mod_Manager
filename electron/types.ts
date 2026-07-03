export type ModType = "server" | "client" | "unknown";

export interface ModInfo {
  id: string; // nome da pasta/arquivo, usado como identificador único
  name: string; // nome de exibição
  type: ModType;
  enabled: boolean;
  installedManually: boolean; // true se não está no nosso registro (foi jogado na pasta na mão)
  loadOrder: number; // posição na ordem de carregamento (só relevante pra server mods)
}

export interface InstanceConfig {
  sptPath: string | null;
}

export interface RegistryEntry {
  id: string;
  displayName: string;
  type: ModType;
  installedAt: string;
  source: "archive-install" | "manual";
}

export interface InstallResult {
  success: boolean;
  message: string;
  mod?: ModInfo;
}
