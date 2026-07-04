export type ModType = "server" | "client" | "hybrid" | "unknown";

export interface ModInfo {
  id: string; // nome da pasta/arquivo, usado como identificador único
  name: string; // nome de exibição (alias, se definido; senão o nome original)
  originalName: string; // nome derivado da pasta/arquivo, nunca muda
  type: ModType;
  enabled: boolean;
  installedManually: boolean; // true se não está no nosso registro (foi jogado na pasta na mão)
  loadOrder: number; // posição na ordem de carregamento (só relevante pra server mods)
  version?: string; // extraído do package.json do mod, quando existe
  author?: string; // extraído do package.json do mod, quando existe
  installedAt?: string; // data ISO de quando foi instalado pelo app (registro local)
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
