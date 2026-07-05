# SPT Mod Manager

🇺🇸 Read in English: [README.md](README.md)

Um gerenciador de mods estilo **Vortex / Mod Organizer 2**, feito especificamente pro **Single Player Tarkov (SPT)**.

Desktop app (Electron + React + TypeScript) que cuida de instalar, organizar, habilitar/desabilitar e remover mods sem precisar mexer manualmente em pastas — mantendo compatibilidade com mods que você já instalou na mão.

> ⚠️ Projeto pessoal, não afiliado à equipe do SPT nem à Battlestate Games. Tarkov e Escape from Tarkov são marcas de seus respectivos donos. ⚠️

---

## Funcionalidades

**Instalação**
- Instalar mods a partir de `.zip` ou `.7z`, via seletor de arquivo **ou arrastando e soltando** direto na janela
- Detecção automática de estrutura — funciona mesmo quando o mod vem "embrulhado" em pastas extras (ex: `SPT/user/mods/NomeDoMod/...`)
- Detecção de tipo: **Server**, **Client** ou **Hybrid** (quando o mod tem as duas partes)
- Verificação pós-instalação: confere arquivo por arquivo que tudo foi copiado corretamente antes de reportar sucesso

**Organização**
- Habilitar/desabilitar mods sem apagar nada (move entre pasta ativa e uma pasta `.disabled`)
- Reordenar load order de server mods (setas ▲▼, com prefixo numérico nas pastas — é assim que o SPT respeita ordem de carregamento)
- Renomear a exibição de um mod (alias) sem tocar em nenhum arquivo ou pasta real
- Detecta mods instalados manualmente (fora do app) e diferencia de "instalado pelo Manager"

**Encontrar o que você precisa**
- Busca em tempo real por nome
- Filtros por tipo, status (ativo/desativado) e origem (manual/Manager)
- Ordenação por nome, tipo, status, origem ou data de instalação
- Seleção múltipla com ações em lote (habilitar/desabilitar/remover vários de uma vez)

**Interface**
- Cards com tipo, status, origem e — quando disponível — versão e autor do mod
- Menu de ações por mod (`⋮`): habilitar/desabilitar, abrir pasta, renomear, reinstalar, remover
- Resumo da instância no cabeçalho (total de mods, quebra por tipo, ativos/desativados)
- Notificações temporárias de sucesso/erro

---

## 📸 Screenshots

![tela principal](docs/screenshot.png)
![tela principal 2](docs/screenshot2.png)

---

##  Como rodar

### Pré-requisitos
- [Node.js](https://nodejs.org/) 18 ou superior
- Windows (o app assume convenções de pasta do SPT no Windows; não testado em Linux/macOS)
- Uma instância do SPT já instalada em algum lugar do seu PC

### Desenvolvimento

```bash
git clone https://github.com/SEU_USUARIO/spt-mod-manager.git
cd spt-mod-manager
npm install
npm run electron:dev
```

Isso builda o renderer (Vite) + o processo main (`tsc`) e abre a janela do Electron.

Se quiser só mexer na UI, sem abrir o Electron (mais rápido pra iterar em CSS/layout):
```bash
npm run dev
```
Nesse modo `window.modManagerAPI` não existe, então as chamadas que dependem do backend vão falhar — serve só pra visual.

### Gerando o instalador (Windows)

```bash
npm run electron:build
```
Gera um `.exe` via `electron-builder` (configuração já definida no `package.json`).

---

## Estrutura do projeto

```
spt-mod-manager/
├── electron/
│   ├── main.ts         # janela do Electron + handlers de IPC
│   ├── preload.ts       # expõe window.modManagerAPI pro renderer (contextIsolation)
│   ├── modManager.ts    # toda a lógica de arquivo (escanear, instalar, habilitar, etc)
│   └── types.ts         # tipos compartilhados do lado Electron
├── src/
│   ├── App.tsx           # UI React inteira
│   ├── App.css           # estilos
│   ├── main.tsx           # entry point do React
│   └── types.ts           # tipos + interface da API exposta pelo preload
├── package.json
└── vite.config.ts
```

---

## Como funciona por baixo dos panos

### Convenções de pasta usadas
| O quê | Onde |
|---|---|
| Server mods ativos | `<instância>/user/mods/` |
| Server mods desabilitados | `<instância>/user/mods.disabled/` |
| Client mods ativos | `<instância>/BepInEx/plugins/` |
| Client mods desabilitados | `<instância>/BepInEx/plugins.disabled/` |

### Load order
SPT carrega server mods em ordem alfabética. O app controla isso prefixando a pasta do mod com um número de 2 dígitos (`01_nomedomod`, `02_outromod`, ...), que é atualizado sempre que você usa as setas ▲▼.

### Arquivos de controle (na raiz da instância)
- `.spt-mod-manager-registry.json` — quais mods foram instalados pelo app (pra diferenciar de "instalado manualmente")
- `.spt-mod-manager-aliases.json` — nomes de exibição customizados (renomear não mexe em arquivo real)

### Instalação "inteligente"
Ao instalar um `.zip`/`.7z`, o app procura recursivamente (não só na raiz do arquivo) por uma pasta que contenha `user/` e/ou `BepInEx/` — isso cobre tanto mods "prontos pra copiar" quanto mods embrulhados numa pasta extra. Se não achar essa estrutura, tenta identificar se é um server mod (por `package.json`) ou client mod (por `.dll`) e instala na pasta certa.

---

## 🐛 Limitações conhecidas

- **Sem suporte a `.rar`** — o 7-Zip lê `.rar`, mas isso exige um codec extra que não vem incluso por licenciamento. Se isso for um problema real no seu uso, dá pra integrar `node-unrar-js` depois.
- **Mods "hybrid" instalados via merge** (arquivo único trazendo `user/` e `BepInEx/` juntos, sem pastas nomeadas dentro) não geram uma linha própria pra habilitar/desabilitar como unidade — os arquivos se misturam nas pastas existentes. Resolver isso direito exigiria um manifesto de instalação rastreando arquivo por arquivo.
- **"Reinstalar"** no menu de ações abre o seletor de arquivo genérico (não guarda o `.zip`/`.7z` original) — funciona bem pra atualizar um mod pra uma versão nova, mas não é um "reinstalar com 1 clique" de verdade.
- **Sem detecção de conflitos** entre mods (dois mods sobrescrevendo o mesmo arquivo).
- **Sem busca/download integrado** do [hub.sp-tarkov.com](https://hub.sp-tarkov.com/) — de propósito, pra não depender de uma API externa que pode mudar sem aviso (o app só abre o link no navegador).
- Testado só no Windows.

---

## Roadmap

- [ ] Suporte a `.rar`
- [ ] Export/import de lista de mods (JSON com nomes + fontes)
- [ ] Detecção de conflitos entre mods
- [ ] Ctrl+Clique / Shift+Clique pra seleção em range
- [ ] Versão do SPT detectada automaticamente no resumo do cabeçalho
- [ ] Manifesto de instalação pra mods hybrid (permitir gerenciar como unidade)

---

## 🤝 Contribuindo

Projeto pessoal, mas issues e PRs são bem-vindos. Se for mexer em algo grande, abre uma issue antes pra alinhar.

## Licença

[MIT](LICENSE)
