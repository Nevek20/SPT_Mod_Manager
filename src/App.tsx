import { useEffect, useState, useCallback, useMemo, type DragEvent } from "react";
import { ModInfo, ModType } from "./types";

interface StatusMessage {
  text: string;
  ok: boolean;
}

type TypeFilter = "all" | ModType;
type StatusFilter = "all" | "enabled" | "disabled";
type OriginFilter = "all" | "manual" | "manager";
type SortField = "name" | "type" | "status" | "origin" | "installedAt";
type SortDirection = "asc" | "desc";

function selectionKey(mod: ModInfo): string {
  return `${mod.type}:${mod.id}`;
}

export default function App() {
  const [sptPath, setSptPath] = useState<string | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const refreshMods = useCallback(async () => {
    const list = await window.modManagerAPI.scanMods();
    setMods(list);
  }, []);

  // Fecha o menu de ações aberto ao clicar fora dele.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".action-menu-wrapper")) setOpenMenuKey(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredMods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = mods.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (statusFilter === "enabled" && !m.enabled) return false;
      if (statusFilter === "disabled" && m.enabled) return false;
      if (originFilter === "manual" && !m.installedManually) return false;
      if (originFilter === "manager" && m.installedManually) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
          break;
        case "status":
          cmp = Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name);
          break;
        case "origin":
          cmp = Number(a.installedManually) - Number(b.installedManually) || a.name.localeCompare(b.name);
          break;
        case "installedAt":
          cmp = (a.installedAt ?? "").localeCompare(b.installedAt ?? "") || a.name.localeCompare(b.name);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [mods, searchQuery, typeFilter, statusFilter, originFilter, sortField, sortDirection]);

  useEffect(() => {
    (async () => {
      const path = await window.modManagerAPI.getSptPath();
      setSptPath(path);
      if (path) refreshMods();
    })();
  }, [refreshMods]);

  async function handleSelectFolder() {
    const result = await window.modManagerAPI.selectSptFolder();
    if (result.success && result.path) {
      setSptPath(result.path);
      setStatusMessage({ text: result.message ?? "Instância configurada.", ok: true });
      refreshMods();
    } else {
      setStatusMessage({ text: result.message ?? "Não foi possível selecionar a pasta.", ok: false });
    }
  }

  function handleOpenModHub() {
    window.modManagerAPI.openModHub();
  }

  async function handleInstall() {
    setLoading(true);
    const result = await window.modManagerAPI.installMod();
    setStatusMessage({ text: result.message, ok: result.success });
    setLoading(false);
    if (result.success) refreshMods();
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setDragCounter((c) => c + 1);
      setIsDraggingFile(true);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragCounter((c) => {
      const next = c - 1;
      if (next <= 0) setIsDraggingFile(false);
      return Math.max(next, 0);
    });
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDraggingFile(false);
    setDragCounter(0);

    const files = Array.from(e.dataTransfer.files);
    const archives = files.filter((f) => /\.(zip|7z)$/i.test(f.name));

    if (archives.length === 0) {
      setStatusMessage({ text: "Solte um arquivo .zip ou .7z pra instalar.", ok: false });
      return;
    }

    setLoading(true);
    let successCount = 0;
    for (const file of archives) {
      // @ts-expect-error o Electron injeta `.path` no objeto File nativo, fora da tipagem padrão do DOM
      const filePath: string | undefined = file.path;
      if (!filePath) continue;
      const result = await window.modManagerAPI.installModFromPath(filePath);
      if (result.success) successCount++;
      setStatusMessage({ text: result.message, ok: result.success });
    }
    setLoading(false);
    if (successCount > 0) refreshMods();
    if (archives.length > 1) {
      setStatusMessage({ text: `${successCount}/${archives.length} mod(s) instalado(s) com sucesso.`, ok: successCount === archives.length });
    }
  }

  async function handleToggle(mod: ModInfo) {
    const result = await window.modManagerAPI.toggleMod(mod);
    setStatusMessage({ text: result.message, ok: result.success });
    if (result.success) refreshMods();
  }

  async function handleUninstall(mod: ModInfo) {
    const confirmed = window.confirm(`Remover "${mod.name}" permanentemente?`);
    if (!confirmed) return;
    const result = await window.modManagerAPI.uninstallMod(mod);
    setStatusMessage({ text: result.message, ok: result.success });
    if (result.success) refreshMods();
  }

  async function handleOpenFolder(mod: ModInfo) {
    const result = await window.modManagerAPI.openModFolder(mod);
    if (!result.success) setStatusMessage({ text: result.message, ok: false });
  }

  async function handleReinstall() {
    setStatusMessage({ text: "Selecione o arquivo atualizado do mod (.zip / .7z)...", ok: true });
    await handleInstall();
  }

  async function handleMove(mod: ModInfo, direction: -1 | 1) {
    const serverMods = mods.filter((m) => m.type === "server" && m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);
    const index = serverMods.findIndex((m) => m.id === mod.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= serverMods.length) return;

    const reordered = [...serverMods];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    const result = await window.modManagerAPI.reorderMods(reordered.map((m) => m.id));
    setStatusMessage({ text: result.message, ok: result.success });
    if (result.success) refreshMods();
  }

  function startRename(mod: ModInfo) {
    setEditingKey(selectionKey(mod));
    setEditingValue(mod.name);
    setOpenMenuKey(null);
  }

  function cancelRename() {
    setEditingKey(null);
    setEditingValue("");
  }

  async function confirmRename(mod: ModInfo) {
    const newAlias = editingValue.trim() === mod.originalName ? "" : editingValue;
    const result = await window.modManagerAPI.renameMod(mod.id, newAlias);
    setStatusMessage({ text: result.message, ok: result.success });
    setEditingKey(null);
    if (result.success) refreshMods();
  }

  function toggleSelect(mod: ModInfo) {
    const key = selectionKey(mod);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedKeys(new Set(filteredMods.map(selectionKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  const selectedMods = useMemo(
    () => mods.filter((m) => selectedKeys.has(selectionKey(m))),
    [mods, selectedKeys]
  );

  async function runBulk(action: "enable" | "disable" | "remove") {
    if (selectedMods.length === 0) return;
    if (action === "remove") {
      const confirmed = window.confirm(`Remover ${selectedMods.length} mod(s) permanentemente?`);
      if (!confirmed) return;
    }
    let successCount = 0;
    for (const mod of selectedMods) {
      if (action === "enable" && mod.enabled) continue;
      if (action === "disable" && !mod.enabled) continue;
      const result =
        action === "remove"
          ? await window.modManagerAPI.uninstallMod(mod)
          : await window.modManagerAPI.toggleMod(mod);
      if (result.success) successCount++;
    }
    setStatusMessage({ text: `${successCount}/${selectedMods.length} mod(s) processado(s).`, ok: true });
    clearSelection();
    refreshMods();
  }

  if (!sptPath) {
    return (
      <div className="empty-state">
        <h1>SPT Mod Manager</h1>
        <p>Selecione a pasta da sua instância SPT pra começar.</p>
        <button onClick={handleSelectFolder}>Selecionar pasta da instância</button>
        <button onClick={handleOpenModHub}>Baixar mods (hub.sp-tarkov.com)</button>
        {statusMessage && <p className="status-message">{statusMessage.text}</p>}
      </div>
    );
  }

  const serverMods = filteredMods.filter((m) => m.type === "server");
  const clientMods = filteredMods.filter((m) => m.type === "client");
  const otherMods = filteredMods.filter((m) => m.type === "hybrid" || m.type === "unknown");

  const listProps = {
    onToggle: handleToggle,
    onUninstall: handleUninstall,
    onOpenFolder: handleOpenFolder,
    onReinstall: handleReinstall,
    onRenameStart: startRename,
    onRenameCancel: cancelRename,
    onRenameConfirm: confirmRename,
    editingKey,
    editingValue,
    onEditingValueChange: setEditingValue,
    selectedKeys,
    onToggleSelect: toggleSelect,
    openMenuKey,
    onSetOpenMenuKey: setOpenMenuKey
  };

  return (
    <div
      className="app"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">Solte o(s) arquivo(s) .zip / .7z aqui pra instalar</div>
        </div>
      )}
      <header>
        <div>
          <h1>SPT Mod Manager</h1>
          <span className="instance-path">{sptPath}</span>
        </div>
        <div className="header-actions">
          <button onClick={handleOpenModHub}>Baixar mods</button>
          <button onClick={handleSelectFolder}>Trocar instância</button>
          <button onClick={handleInstall} disabled={loading} className="primary">
            {loading ? "Instalando..." : "Instalar mod (.zip / .7z)"}
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className={`status-bar ${statusMessage.ok ? "status-ok" : "status-error"}`}>
          {statusMessage.ok ? "✔ " : "❌ "}
          {statusMessage.text}
        </div>
      )}

      <input
        className="search-bar"
        type="text"
        placeholder="Pesquisar mod pelo nome..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <div className="filter-bar">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
          <option value="all">Todos os tipos</option>
          <option value="server">Server</option>
          <option value="client">Client</option>
          <option value="hybrid">Hybrid</option>
          <option value="unknown">Unknown</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Ativos e desativados</option>
          <option value="enabled">Só ativos</option>
          <option value="disabled">Só desativados</option>
        </select>
        <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}>
          <option value="all">Qualquer origem</option>
          <option value="manual">Instalados manualmente</option>
          <option value="manager">Instalados pelo Manager</option>
        </select>

        <span className="filter-separator" />

        <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
          <option value="name">Ordenar por Nome</option>
          <option value="type">Ordenar por Tipo</option>
          <option value="status">Ordenar por Status</option>
          <option value="origin">Ordenar por Origem</option>
          <option value="installedAt">Ordenar por Data de instalação</option>
        </select>
        <button
          onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
          title="Inverter direção da ordenação"
        >
          {sortDirection === "asc" ? "↑ Crescente" : "↓ Decrescente"}
        </button>

        <span className="filter-separator" />

        <button onClick={selectAllVisible}>Selecionar todos (visíveis)</button>
        {selectedKeys.size > 0 && <button onClick={clearSelection}>Limpar seleção</button>}
      </div>

      {sortField !== "name" && (
        <p className="sort-hint">
          A ordem de carregamento (▲▼) sempre segue o load order real — ordenar por outro campo só muda a exibição, não o load order.
        </p>
      )}

      {selectedKeys.size > 0 && (
        <div className="bulk-bar">
          <span>{selectedKeys.size} selecionado(s)</span>
          <div className="bulk-actions">
            <button onClick={() => runBulk("enable")}>Habilitar</button>
            <button onClick={() => runBulk("disable")}>Desabilitar</button>
            <button onClick={() => runBulk("remove")} className="danger">Remover</button>
            <button onClick={clearSelection}>Cancelar seleção</button>
          </div>
        </div>
      )}

      <section>
        <h2>Server Mods ({serverMods.length})</h2>
        <ModList mods={serverMods} onMove={handleMove} reorderable {...listProps} />
      </section>

      <section>
        <h2>Client Mods ({clientMods.length})</h2>
        <ModList mods={clientMods} {...listProps} />
      </section>

      {otherMods.length > 0 && (
        <section>
          <h2>Hybrid / Unknown ({otherMods.length})</h2>
          <ModList mods={otherMods} {...listProps} />
        </section>
      )}
    </div>
  );
}

function ModList({
  mods,
  onToggle,
  onUninstall,
  onOpenFolder,
  onReinstall,
  onMove,
  reorderable = false,
  onRenameStart,
  onRenameCancel,
  onRenameConfirm,
  editingKey,
  editingValue,
  onEditingValueChange,
  selectedKeys,
  onToggleSelect,
  openMenuKey,
  onSetOpenMenuKey
}: {
  mods: ModInfo[];
  onToggle: (mod: ModInfo) => void;
  onUninstall: (mod: ModInfo) => void;
  onOpenFolder: (mod: ModInfo) => void;
  onReinstall: (mod: ModInfo) => void;
  onMove?: (mod: ModInfo, direction: -1 | 1) => void;
  reorderable?: boolean;
  onRenameStart: (mod: ModInfo) => void;
  onRenameCancel: () => void;
  onRenameConfirm: (mod: ModInfo) => void;
  editingKey: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  selectedKeys: Set<string>;
  onToggleSelect: (mod: ModInfo) => void;
  openMenuKey: string | null;
  onSetOpenMenuKey: (key: string | null) => void;
}) {
  if (mods.length === 0) {
    return <p className="empty-list">Nenhum mod encontrado aqui.</p>;
  }

  return (
    <ul className="mod-list">
      {mods.map((mod, index) => {
        const key = selectionKey(mod);
        const isEditing = editingKey === key;
        const isMenuOpen = openMenuKey === key;
        return (
          <li key={key} className={`mod-item ${mod.enabled ? "" : "disabled"}`}>
            <input
              type="checkbox"
              checked={selectedKeys.has(key)}
              onChange={() => onToggleSelect(mod)}
              className="mod-checkbox"
            />
            <span className="mod-number">{String(index + 1).padStart(2, "0")}</span>
            {reorderable && mod.enabled && (
              <div className="reorder-buttons">
                <button onClick={() => onMove?.(mod, -1)} title="Mover pra cima">▲</button>
                <button onClick={() => onMove?.(mod, 1)} title="Mover pra baixo">▼</button>
              </div>
            )}
            <div className="mod-info">
              {isEditing ? (
                <input
                  className="rename-input"
                  autoFocus
                  value={editingValue}
                  onChange={(e) => onEditingValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameConfirm(mod);
                    if (e.key === "Escape") onRenameCancel();
                  }}
                  onBlur={() => onRenameConfirm(mod)}
                />
              ) : (
                <span className="mod-name" title={mod.originalName} onDoubleClick={() => onRenameStart(mod)}>
                  {mod.name}
                </span>
              )}
              <div className="mod-meta">
                <span className={`type-badge type-${mod.type}`}>{mod.type}</span>
                <span className={`status-chip ${mod.enabled ? "status-chip-on" : "status-chip-off"}`}>
                  {mod.enabled ? "Ativo" : "Desativado"}
                </span>
                <span className="origin-chip">{mod.installedManually ? "Manual" : "Manager"}</span>
                {mod.version && <span className="meta-chip">v{mod.version}</span>}
                {mod.author && <span className="meta-chip">por {mod.author}</span>}
              </div>
            </div>
            <div className="action-menu-wrapper">
              <button
                className="menu-trigger"
                onClick={() => onSetOpenMenuKey(isMenuOpen ? null : key)}
                title="Ações"
              >
                ⋮
              </button>
              {isMenuOpen && (
                <div className="action-menu">
                  <button
                    onClick={() => {
                      onToggle(mod);
                      onSetOpenMenuKey(null);
                    }}
                  >
                    {mod.enabled ? "Desabilitar" : "Habilitar"}
                  </button>
                  <button
                    onClick={() => {
                      onOpenFolder(mod);
                      onSetOpenMenuKey(null);
                    }}
                  >
                    Abrir pasta
                  </button>
                  <button onClick={() => onRenameStart(mod)}>Renomear</button>
                  <button
                    onClick={() => {
                      onReinstall(mod);
                      onSetOpenMenuKey(null);
                    }}
                  >
                    Reinstalar
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      onUninstall(mod);
                      onSetOpenMenuKey(null);
                    }}
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
