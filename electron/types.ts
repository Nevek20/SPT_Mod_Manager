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
  manifestOnly?: boolean;
  guid?: string; // GUID declarado pelo mod (SPT 4.0) — casamento exato com a Forge // true = mod "órfão" rastreado por manifesto (sem pasta nomeada própria); não suporta habilitar/desabilitar
  linkedModName?: string; // nome de exibição de um mod "ligado" (ex: arquivo solto do mesmo install) — remover um remove o outro
  sptVersion?: string;
  packageId?: string; // partes instaladas do mesmo arquivo compartilham esse id
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
  linkedModId?: string;
  linkedModIds?: string[]; // no registro do órfão: todos os mods que vieram no mesmo arquivo
  // Dados vindos da Forge no momento da instalação — fonte confiável, usada quando
  // o mod não expõe esses campos localmente (ex: client mod, que não tem autor).
  forgeName?: string;
  forgeAuthor?: string;
  forgeVersion?: string;
  forgeGuid?: string; // id de outro registro "ligado" a esse (ex: um mod nomeado + o arquivo solto que veio junto no mesmo install) — removê-lo remove o outro também
  packageId?: string;
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