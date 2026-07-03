# SPT Mod Manager (MVP)

Gerenciador de mods estilo Vortex/MO2 pro Single Player Tarkov (SPT), focado em:
- Instalar/desinstalar mods a partir de `.zip`
- Detectar mods instalados manualmente (não só os instalados pelo app — esse é um gap real do concorrente SP-EFT Manager)
- Habilitar/desabilitar sem apagar
- Load order básico pra server mods (reordenação com prefixo numérico nas pastas)

## Rodando em desenvolvimento

```bash
npm install
npm run electron:dev
```

Isso builda o renderer (Vite) + o processo main (tsc) e abre o Electron.

Se quiser só o frontend no navegador (sem Electron, útil pra mexer rápido na UI):
```bash
npm run dev
```
(nesse modo `window.modManagerAPI` não vai existir, então as chamadas vão falhar — é só pra CSS/layout)

## Gerando o instalador (Windows)

```bash
npm run electron:build
```
Gera o `.exe` via `electron-builder` (config já está no `package.json`).

## Como funciona por baixo dos panos

- **`electron/modManager.ts`** — toda a lógica de arquivo: validar pasta SPT, escanear mods,
  instalar zip, habilitar/desabilitar (move entre pasta ativa e `.disabled`), desinstalar,
  reordenar load order.
- **`electron/main.ts`** — janela do Electron + handlers de IPC que chamam o modManager.
- **`electron/preload.ts`** — expõe `window.modManagerAPI` pro React de forma segura
  (contextIsolation ligado, sem nodeIntegration direto no renderer).
- **`src/App.tsx`** — UI React que consome essa API.

### Convenções de pastas usadas

- Server mods ativos: `<instância>/user/mods/`
- Server mods desabilitados: `<instância>/user/mods.disabled/`
- Client mods ativos: `<instância>/BepInEx/plugins/`
- Client mods desabilitados: `<instância>/BepInEx/plugins.disabled/`
- Load order: prefixo numérico de 2 dígitos na pasta do server mod (ex: `01_nomedomod`),
  já que o SPT carrega server mods em ordem alfabética.
- Registro interno (`.spt-mod-manager-registry.json` na raiz da instância) guarda o que foi
  instalado pelo app, pra diferenciar de mods jogados na pasta manualmente.

## O que ficou de fora do MVP (de propósito)

- Busca/download integrado de mods do Forge/hub — é exatamente a dependência de API externa
  que quebrou o concorrente recentemente. Fica pra uma v2, com fallback bem pensado.
- Detecção de conflitos entre mods (dois mods sobrescrevendo o mesmo arquivo).
- Suporte a `.rar` (só `.zip` por enquanto — a lib `adm-zip` não lê rar).
- Drag-and-drop visual pra load order (por enquanto são botões ▲▼, mais simples de manter).

## Próximos passos sugeridos

1. Testar contra sua instância SPT real — os caminhos (`user/mods`, `BepInEx/plugins`) e a
   validação em `validateSptPath()` podem precisar de ajuste fino dependendo da versão do SPT.
2. Suporte a `.rar` (via `node-7z` + `7zip-bin`, que já lida com licenciamento do 7-Zip).
3. Export/import de lista de mods (JSON com nomes + fontes) — gap real do concorrente.
4. Detecção de conflitos (dois mods escrevendo no mesmo arquivo dentro de `user/mods`).
