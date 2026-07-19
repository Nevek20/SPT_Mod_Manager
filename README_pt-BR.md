# SPT Mod Manager

🇺🇸 Read in English: [README.md](README.md)

Um gerenciador de mods estilo **Vortex / Mod Organizer 2**, feito especificamente pro **Single Player Tarkov (SPT)**.

Desktop app (Electron + React + TypeScript) que cuida de instalar, organizar, habilitar/desabilitar e remover mods sem precisar mexer manualmente em pastas — mantendo compatibilidade com mods que você já instalou na mão.

Com identidade visual própria, tipo "manifesto de equipamento tático" — títulos condensados, dado técnico em monoespaçada, um acento quente — em vez do típico dark mode genérico.

> ⚠️ Projeto pessoal, não afiliado à equipe do SPT nem à Battlestate Games. Tarkov e Escape from Tarkov são marcas de seus respectivos donos. ⚠️

---

## Funcionalidades

**Instalação**
- Instalar mods a partir de `.zip`, `.7z` ou `.rar`, via seletor de arquivo **ou arrastando e soltando** direto na janela
- Detecção automática de estrutura — funciona mesmo quando o mod vem "embrulhado" em pastas extras (ex: `SPT/user/mods/NomeDoMod/...`)
- Detecção de tipo: **Server**, **Client** ou **Hybrid** (quando o mod tem as duas partes)
- Verificação pós-instalação: confere arquivo por arquivo que tudo foi copiado corretamente antes de reportar sucesso

**Organização**
- Habilitar/desabilitar mods sem apagar nada (move entre pasta ativa e uma pasta `.disabled`)
- Reordenar load order de server mods (setas ▲▼, com prefixo numérico nas pastas — é assim que o SPT respeita ordem de carregamento)
- Renomear a exibição de um mod (alias) sem tocar em nenhum arquivo ou pasta real
- Detecta mods instalados manualmente (fora do app) e diferencia de "instalado pelo Manager"
- Mods "hybrid" instalados via merge que deixam arquivos soltos (sem pasta própria) ainda aparecem na lista como um item "Órfão", rastreado por manifesto — dá pra remover de forma limpa mesmo sem uma pasta nomeada

**Encontrar o que você precisa**
- Busca em tempo real por nome
- Filtros por tipo, status (ativo/desativado) e origem (manual/Manager)
- Ordenação por nome, tipo, status, origem ou data de instalação
- Seleção múltipla — clique em cada checkbox ou Shift+Clique pra selecionar um intervalo — com ações em lote (habilitar/desabilitar/remover vários de uma vez)

**Confiabilidade**
- Export/import de lista de mods (JSON) pra comparar duas instâncias ou guardar um backup de "quais mods eu tinha instalado"
- Verificação de conflitos: DLLs com o mesmo nome vindas de client mods diferentes, e mods server com o mesmo `name` declarado em pastas diferentes
- Versão do SPT detectada automaticamente (lida do `core.json` da instância) e mostrada no resumo — em instalações SPT 4.0+, o `core.json` não guarda mais a versão do SPT em si, então nesse caso mostra a versão do Tarkov compatível como alternativa
- Verifica os mods instalados contra a API pública da [Forge](https://forge.sp-tarkov.com) por atualizações, com um chip de status por mod: atualização disponível, atualização bloqueada por conflito de dependência, incompatível com a tua versão do SPT, ou — pra mods sem versão legível localmente (ex: mods só de `.dll`, sem `package.json`) — a versão mais recente que a Forge conhece
- Busca/navegação pelo catálogo da Forge de dentro do app (por nome, categoria e, opcionalmente, filtrando pela versão do SPT selecionada) e instalação com 1 clique — baixa a versão escolhida e passa pelo mesmo instalador usado pra um arquivo escolhido manualmente
- Seletor de versão do SPT vindo direto da lista oficial da Forge (com contagem de mods por versão), em vez de digitação livre
- Um mod recém-instalado já é checado na Forge na hora, sem precisar re-consultar todo o resto que já tinha sido checado antes
- Resultado da checagem e o horário da "última verificação" sobrevivem a fechar e abrir o app de novo

**Interface**
- Cards com tipo, status, origem e — quando disponível — versão e autor do mod
- Menu de ações por mod (`⋮`): habilitar/desabilitar, abrir pasta, renomear, reinstalar, remover (itens "Órfão" mostram só renomear/remover, já que não têm uma pasta própria pra habilitar ou abrir)
- Resumo da instância no cabeçalho (total de mods, quebra por tipo, ativos/desativados, versão do SPT)
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
Ao instalar um `.zip`/`.7z`/`.rar`, o app procura recursivamente (não só na raiz do arquivo) por uma pasta que contenha `user/` e/ou `BepInEx/` — isso cobre tanto mods "prontos pra copiar" quanto mods embrulhados numa pasta extra. Se não achar essa estrutura, tenta identificar se é um server mod (por `package.json`) ou client mod (por `.dll`) e instala na pasta certa.

### Integração com a Forge
O app conversa com a API pública da [Forge](https://forge.sp-tarkov.com) (`forge.sp-tarkov.com/api/v0`) — a plataforma oficial de mods do próprio time do SPT. É só leitura, não precisa de chave de API, e tem limite de uso generoso (40 requisições/10s em rajada, 200/60s sustentado); o app respeita isso com um pequeno intervalo entre requisições quando checa vários mods de uma vez.

Como o app só rastreia o *nome* do mod localmente (não um ID da Forge), o casamento com o catálogo é feito por nome — usando o nome verdadeiro derivado da pasta, não um apelido de exibição, então renomear um mod pra sua própria organização nunca quebra a busca. É uma heurística, e pode ocasionalmente não achar um mod com nome muito genérico ou que não está listado na Forge.

Vale saber: a partir do SPT 4.0, mods server pararam de declarar a versão no `package.json` (essa convenção migrou pra uma classe de metadados dentro do próprio código do mod) — então boa parte dos mods instalados simplesmente não tem versão legível localmente pra comparar. Pra esses, o app ainda busca na Forge e mostra a versão mais recente conhecida como informação, sem alegar que uma atualização está "disponível" (já que não tem nada local pra comparar).

---

## 🐛 Limitações conhecidas

- **Mods "hybrid" instalados via merge** (arquivo único trazendo `user/` e `BepInEx/` juntos, sem pastas nomeadas dentro) aparecem como um item "Órfão" rastreado por manifesto, mas só suportam renomear/remover — não dá pra habilitar/desabilitar como unidade, já que não existe uma pasta própria pra mover.
- **"Reinstalar"** no menu de ações abre o seletor de arquivo genérico (não guarda o `.zip`/`.7z`/`.rar` original) — funciona bem pra atualizar um mod pra uma versão nova, mas não é um "reinstalar com 1 clique" de verdade.
- **Detecção de conflitos é no nível de arquivo**, não semântica — sinaliza DLLs duplicadas e nomes de server mod duplicados, mas não sabe se dois mods realmente mexem na mesma coisa dentro do jogo.
- **O filtro por versão do SPT na busca da Forge filtra o mod, não cada versão individual** — a API aplica `filter[spt_version]` no nível do mod, então o seletor de versão de um mod que bateu no filtro ainda pode listar versões feitas pra outras versões do SPT; confira a restrição de SPT mostrada ao lado de cada versão antes de instalar.
- **Casamento com a Forge é por nome**, não por um ID estável — mod com nome muito genérico, ou que não está listado na Forge, não é encontrado.
- Testado só no Windows.

---

## Roadmap

Já feito (virou funcionalidade lá em cima ⬆️):
- [x] Suporte a `.rar`
- [x] Export/import de lista de mods (JSON com nomes + fontes)
- [x] Detecção de conflitos entre mods (nível de arquivo)
- [x] Shift+Clique pra seleção em range
- [x] Versão do SPT detectada automaticamente no resumo do cabeçalho
- [x] Manifesto de instalação pra mods hybrid (aparecem na lista e dá pra remover)
- [x] Verificação de atualizações contra a Forge, com status por mod e seletor de versão vindo da própria Forge
- [x] Busca/navegação/instalação com 1 clique direto da Forge

Ainda na fila:
- [ ] "Reinstalar" de verdade guardando o `.zip`/`.7z`/`.rar` original, em vez de reabrir o seletor de arquivo genérico
- [ ] Detecção de conflitos mais profunda (ex: dois mods editando a mesma tabela de loot), não só nome de arquivo duplicado
- [ ] Proteção contra zip slip na extração de arquivo (defesa extra, já que o arquivo do mod vem de terceiros)
- [ ] Suporte a Linux/macOS

---

## 🤝 Contribuindo

Projeto pessoal, mas issues e PRs são bem-vindos. Se for mexer em algo grande, abre uma issue antes pra alinhar.

## Licença

[MIT](LICENSE)

Extração de `.rar` é feita com [node-unrar-js](https://github.com/YuJianrong/node-unrar.js), um build WASM do UnRAR oficial, que é gratuito mas distribuído sob licença própria (não MIT) — veja o `LICENSE.md` do pacote pra mais detalhes.