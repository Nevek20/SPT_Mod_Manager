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
  manifestOnly?: boolean; // true = mod "órfão" rastreado por manifesto (sem pasta nomeada própria); não suporta habilitar/desabilitar
}

export interface InstanceConfig {
  sptPath: string | null;
  serverRoot: string | null; // normalmente igual a sptPath; diferente só em instalações "divididas" (client numa pasta, server numa subpasta)
  sptVersionOverride: string | null;
  forgeStatusCache: { name: string; status: "update" | "blocked" | "incompatible" | "info"; version?: string }[] | null;
  forgeCheckedAt: string | null;
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

export interface ModListComparison {
  missing: string[]; // presentes na lista importada, mas não encontrados na instância atual
  extra: string[]; // presentes na instância atual, mas não estavam na lista importada
}