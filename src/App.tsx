import { useEffect, useState, useCallback, useMemo, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ModInfo, ModType, ConflictReport, ForgeUpdateCheckResult, ForgeSptVersion, ForgeStatusCacheEntry } from "./types";

interface Toast {
  id: number;
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

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.ok ? "toast-ok" : "toast-error"}`}>
          {t.ok ? "✔ " : "❌ "}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [sptPath, setSptPath] = useState<string | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
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
  const [compareResult, setCompareResult] = useState<{ missing: string[]; extra: string[] } | null>(null);
  const [sptVersion, setSptVersion] = useState<string | undefined>(undefined);
  const [conflictReport, setConflictReport] = useState<ConflictReport | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [sptVersionInput, setSptVersionInput] = useState("");
  const [forgeResult, setForgeResult] = useState<ForgeUpdateCheckResult | null>(null);
  const [checkingForgeUpdates, setCheckingForgeUpdates] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeStatusByName, setForgeStatusByName] = useState<
    Map<string, { status: "update" | "blocked" | "incompatible" | "info"; version?: string }>
  >(new Map());
  const [forgeSptVersions, setForgeSptVersions] = useState<ForgeSptVersion[]>([]);
  const [forgeCheckedAt, setForgeCheckedAt] = useState<string | null>(null);

  const pushToast = useCallback((text: string, ok: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, ok }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const refreshMods = useCallback(async () => {
    const list = await window.modManagerAPI.scanMods();
    setMods(list);
    return list;
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

  const summary = useMemo(() => {
    const server = mods.filter((m) => m.type === "server").length;
    const client = mods.filter((m) => m.type === "client").length;
    const active = mods.filter((m) => m.enabled).length;
    const disabled = mods.length - active;
    return { total: mods.length, server, client, active, disabled };
  }, [mods]);

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

  const filtersActive = searchQuery.trim() !== "" || typeFilter !== "all" || statusFilter !== "all" || originFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    setOriginFilter("all");
  }

  useEffect(() => {
    (async () => {
      const path = await window.modManagerAPI.getSptPath();
      setSptPath(path);
      if (path) {
        refreshMods();
        setSptVersion(await window.modManagerAPI.getSptVersion());
        const semver = await window.modManagerAPI.getSptSemver();
        if (semver) {
          setSptVersionInput(semver);
        } else {
          const override = await window.modManagerAPI.getSptVersionOverride();
          if (override) setSptVersionInput(override);
        }

        window.modManagerAPI.getForgeSptVersions().then(setForgeSptVersions);

        const cache = await window.modManagerAPI.getForgeCache();
        if (cache.statusCache) {
          const restored = new Map(cache.statusCache.map((entry) => [entry.name, { status: entry.status, version: entry.version }]));
          setForgeStatusByName(restored);
        }
        setForgeCheckedAt(cache.checkedAt);
      }
    })();
  }, [refreshMods]);

  async function handleSelectFolder() {
    const result = await window.modManagerAPI.selectSptFolder();
    if (result.success && result.path) {
      setSptPath(result.path);
      pushToast(result.message ?? "Instância configurada.", true);
      refreshMods();
      setSptVersion(await window.modManagerAPI.getSptVersion());
      const semver = await window.modManagerAPI.getSptSemver();
      if (semver) {
        setSptVersionInput(semver);
      } else {
        const override = await window.modManagerAPI.getSptVersionOverride();
        setSptVersionInput(override || "");
      }
    } else {
      pushToast(result.message ?? "Não foi possível selecionar a pasta.", false);
    }
  }

  function handleOpenModHub() {
    window.modManagerAPI.openModHub();
  }

  async function handleInstall() {
    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    const result = await window.modManagerAPI.installMod();
    pushToast(result.message, result.success);
    setLoading(false);
    if (result.success) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
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
    const archives = files.filter((f) => /\.(zip|7z|rar)$/i.test(f.name));

    if (archives.length === 0) {
      pushToast("Solte um arquivo .zip, .7z ou .rar pra instalar.", false);
      return;
    }

    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    let successCount = 0;
    for (const file of archives) {
      // @ts-expect-error o Electron injeta `.path` no objeto File nativo, fora da tipagem padrão do DOM
      const filePath: string | undefined = file.path;
      if (!filePath) continue;
      const result = await window.modManagerAPI.installModFromPath(filePath);
      if (result.success) successCount++;
      pushToast(result.message, result.success);
    }
    setLoading(false);
    if (successCount > 0) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
  }

  async function handleToggle(mod: ModInfo) {
    setMutating(true);
    const result = await window.modManagerAPI.toggleMod(mod);
    pushToast(result.message, result.success);
    if (result.success) {
      // Atualização local (sem re-escanear o disco inteiro) — bem mais rápido com muitos mods.
      setMods((prev) => prev.map((m) => (m.id === mod.id && m.type === mod.type ? { ...m, enabled: !m.enabled } : m)));
    }
    setMutating(false);
  }

  async function handleUninstall(mod: ModInfo) {
    const confirmed = window.confirm(`Remover "${mod.name}" permanentemente?`);
    if (!confirmed) return;
    setMutating(true);
    const result = await window.modManagerAPI.uninstallMod(mod);
    pushToast(result.message, result.success);
    if (result.success) {
      const key = selectionKey(mod);
      setMods((prev) => prev.filter((m) => selectionKey(m) !== key));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setMutating(false);
  }

  async function handleOpenFolder(mod: ModInfo) {
    const result = await window.modManagerAPI.openModFolder(mod);
    if (!result.success) pushToast(result.message, false);
  }

  async function handleReinstall() {
    pushToast("Selecione o arquivo atualizado do mod (.zip / .7z / .rar)...", true);
    await handleInstall();
  }

  async function handleExportList() {
    const result = await window.modManagerAPI.exportModList();
    pushToast(result.message, result.success);
  }

  async function handleImportList() {
    const result = await window.modManagerAPI.importModList();
    pushToast(result.message, result.success);
    if (result.success && result.comparison) {
      setCompareResult(result.comparison);
    }
  }

  async function handleDetectConflicts() {
    setCheckingConflicts(true);
    const report = await window.modManagerAPI.detectConflicts();
    setConflictReport(report);
    setCheckingConflicts(false);
    const total = report.clientFileConflicts.length + report.duplicateServerNames.length;
    pushToast(total === 0 ? "Nenhum conflito óbvio encontrado." : `${total} possível(is) conflito(s) encontrado(s).`, total === 0);
  }

  function persistForgeStatus(map: Map<string, { status: "update" | "blocked" | "incompatible" | "info"; version?: string }>) {
    const asArray: ForgeStatusCacheEntry[] = Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
    window.modManagerAPI.setForgeCache(asArray);
    setForgeCheckedAt(new Date().toISOString());
  }

  async function handleCheckForgeUpdates() {
    if (!sptVersionInput.trim()) {
      pushToast("Informe a versão do SPT antes de verificar.", false);
      return;
    }
    setCheckingForgeUpdates(true);
    setForgeError(null);
    const payload = mods.map((m) => ({ name: m.name, originalName: m.originalName, version: m.version }));
    const response = await window.modManagerAPI.checkForgeUpdates(payload, sptVersionInput.trim());
    setCheckingForgeUpdates(false);
    if (!response.success || !response.result) {
      setForgeError(response.message || "Falha ao verificar atualizações.");
      pushToast(response.message || "Falha ao verificar atualizações.", false);
      return;
    }
    setForgeResult(response.result);

    const statusMap = new Map<string, { status: "update" | "blocked" | "incompatible" | "info"; version?: string }>();
    for (const u of response.result.updates) {
      statusMap.set(u.name, { status: "update", version: u.recommendedVersion });
    }
    for (const b of response.result.blocked) {
      if (!statusMap.has(b.name)) statusMap.set(b.name, { status: "blocked", version: b.recommendedVersion });
    }
    for (const i of response.result.incompatible) {
      if (!statusMap.has(i.name)) statusMap.set(i.name, { status: "incompatible" });
    }
    for (const info of response.result.infoOnly) {
      if (!statusMap.has(info.name)) statusMap.set(info.name, { status: "info", version: info.recommendedVersion });
    }
    setForgeStatusByName(statusMap);
    persistForgeStatus(statusMap);

    const total = response.result.updates.length;
    pushToast(total === 0 ? "Tudo atualizado (ou não encontrado no Forge)." : `${total} atualização(ões) disponível(is).`, true);
  }

  // Roda a checagem da Forge só pros mods que acabaram de entrar (comparando
  // a lista antes/depois da instalação), sem re-consultar os outros já
  // verificados. Silenciosamente não faz nada se não tiver uma versão do SPT
  // informada ainda (não dá pra checar sem isso).
  async function checkForgeForNewMods(previousKeys: Set<string>, updatedMods: ModInfo[]) {
    if (!sptVersionInput.trim()) return;
    const newMods = updatedMods.filter((m) => !previousKeys.has(selectionKey(m)));
    if (newMods.length === 0) return;

    const payload = newMods.map((m) => ({ name: m.name, originalName: m.originalName, version: m.version }));
    const response = await window.modManagerAPI.checkForgeUpdates(payload, sptVersionInput.trim());
    if (!response.success || !response.result) return;

    const next = new Map(forgeStatusByName);
    for (const u of response.result.updates) next.set(u.name, { status: "update", version: u.recommendedVersion });
    for (const b of response.result.blocked) {
      if (!next.has(b.name)) next.set(b.name, { status: "blocked", version: b.recommendedVersion });
    }
    for (const i of response.result.incompatible) {
      if (!next.has(i.name)) next.set(i.name, { status: "incompatible" });
    }
    for (const info of response.result.infoOnly) {
      if (!next.has(info.name)) next.set(info.name, { status: "info", version: info.recommendedVersion });
    }
    setForgeStatusByName(next);
    persistForgeStatus(next);
  }

  async function handleMove(mod: ModInfo, direction: -1 | 1) {
    const serverMods = mods.filter((m) => m.type === "server" && m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);
    const index = serverMods.findIndex((m) => m.id === mod.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= serverMods.length) return;

    const reordered = [...serverMods];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    const result = await window.modManagerAPI.reorderMods(reordered.map((m) => m.id));
    pushToast(result.message, result.success);
    // Renumerar mexe nos nomes das pastas de vários mods de uma vez, então aqui vale a pena re-escanear.
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
    const trimmed = editingValue.trim();
    const newAlias = trimmed === mod.originalName ? "" : trimmed;
    const result = await window.modManagerAPI.renameMod(mod.id, newAlias);
    pushToast(result.message, result.success);
    setEditingKey(null);
    if (result.success) {
      const displayName = newAlias || mod.originalName;
      setMods((prev) => prev.map((m) => (m.id === mod.id && m.type === mod.type ? { ...m, name: displayName } : m)));
    }
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

  const selectedMods = useMemo(() => mods.filter((m) => selectedKeys.has(selectionKey(m))), [mods, selectedKeys]);

  async function runBulk(action: "enable" | "disable" | "remove") {
    if (selectedMods.length === 0) return;
    if (action === "remove") {
      const confirmed = window.confirm(`Remover ${selectedMods.length} mod(s) permanentemente?`);
      if (!confirmed) return;
    }
    setMutating(true);
    const succeededKeys = new Set<string>();
    for (const mod of selectedMods) {
      if (action === "enable" && mod.enabled) continue;
      if (action === "disable" && !mod.enabled) continue;
      const result = action === "remove" ? await window.modManagerAPI.uninstallMod(mod) : await window.modManagerAPI.toggleMod(mod);
      if (result.success) succeededKeys.add(selectionKey(mod));
    }

    if (action === "remove") {
      setMods((prev) => prev.filter((m) => !succeededKeys.has(selectionKey(m))));
    } else {
      setMods((prev) => prev.map((m) => (succeededKeys.has(selectionKey(m)) ? { ...m, enabled: action === "enable" } : m)));
    }

    pushToast(`${succeededKeys.size}/${selectedMods.length} mod(s) processado(s).`, true);
    clearSelection();
    setMutating(false);
  }

  function selectRange(keys: string[]) {
    setSelectedKeys((prev) => new Set([...prev, ...keys]));
  }

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
    onRangeSelect: selectRange,
    openMenuKey,
    onSetOpenMenuKey: setOpenMenuKey,
    disabled: mutating,
    forgeStatusByName
  };

  return (
    <>
      <ToastStack toasts={toasts} />

      {!sptPath ? (
        <div className="empty-state">
          <h1>SPT Mod Manager</h1>
          <p>Selecione a pasta da sua instância SPT pra começar.</p>
          <button onClick={handleSelectFolder}>Selecionar pasta da instância</button>
          <button onClick={handleOpenModHub}>Baixar mods (hub.sp-tarkov.com)</button>
        </div>
      ) : (
        <div
          className="app"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDraggingFile && (
            <div className="drop-overlay">
              <div className="drop-overlay-box">Solte o(s) arquivo(s) .zip / .7z / .rar aqui pra instalar</div>
            </div>
          )}
          <header>
            <div>
              <h1>SPT Mod Manager</h1>
              <span className="instance-path" title={sptPath}>{sptPath}</span>
            </div>
            <div className="header-actions">
              <button onClick={handleOpenModHub} title="Abrir hub.sp-tarkov.com no navegador">Baixar mods</button>
              <button onClick={handleSelectFolder} title="Selecionar outra instância SPT">Trocar instância</button>
              <button onClick={handleInstall} disabled={loading} className="primary" title="Escolher um .zip, .7z ou .rar pra instalar">
                {loading ? "Instalando..." : "Instalar mod (.zip / .7z / .rar)"}
              </button>
            </div>
          </header>

          <div className="summary-bar">
            <span className="summary-item">
              <strong>{summary.total}</strong> mod(s) instalado(s)
            </span>
            <span className="summary-item">Server: <strong>{summary.server}</strong></span>
            <span className="summary-item">Client: <strong>{summary.client}</strong></span>
            <span className="summary-item summary-active">Ativos: <strong>{summary.active}</strong></span>
            <span className="summary-item summary-disabled">Desativados: <strong>{summary.disabled}</strong></span>
            {sptVersion && (
              <span
                className="summary-item"
                title="Lido de SPT_Data/Server/configs/core.json — a partir do SPT 4.0 esse arquivo só guarda a versão do Tarkov compatível, não a versão do SPT em si"
              >
                {sptVersion}
              </span>
            )}
            <span className="summary-item summary-valid" title="A pasta selecionada passou na validação de instância SPT">✔ Instância válida</span>
          </div>

          <input
            className="search-bar"
            type="text"
            placeholder="Pesquisar mod pelo nome..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="filter-bar">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} title="Filtrar por tipo">
              <option value="all">Todos os tipos</option>
              <option value="server">Server</option>
              <option value="client">Client</option>
              <option value="hybrid">Hybrid</option>
              <option value="unknown">Unknown</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} title="Filtrar por status">
              <option value="all">Ativos e desativados</option>
              <option value="enabled">Só ativos</option>
              <option value="disabled">Só desativados</option>
            </select>
            <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} title="Filtrar por origem">
              <option value="all">Qualquer origem</option>
              <option value="manual">Instalados manualmente</option>
              <option value="manager">Instalados pelo Manager</option>
            </select>

            <span className="filter-separator" />

            <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} title="Ordenar por">
              <option value="name">Ordenar por Nome</option>
              <option value="type">Ordenar por Tipo</option>
              <option value="status">Ordenar por Status</option>
              <option value="origin">Ordenar por Origem</option>
              <option value="installedAt">Ordenar por Data de instalação</option>
            </select>
            <button onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))} title="Inverter direção da ordenação">
              {sortDirection === "asc" ? "↑ Crescente" : "↓ Decrescente"}
            </button>

            <span className="filter-separator" />

            <button onClick={selectAllVisible} title="Selecionar todos os mods visíveis com os filtros atuais">Selecionar todos (visíveis)</button>
            {selectedKeys.size > 0 && <button onClick={clearSelection}>Limpar seleção</button>}

            <span className="filter-separator" />

            <button onClick={handleExportList} title="Salvar a lista atual de mods num arquivo JSON">Exportar lista</button>
            <button onClick={handleImportList} title="Comparar a instância atual com uma lista exportada antes">Importar / Comparar</button>
            <button onClick={handleDetectConflicts} disabled={checkingConflicts} title="Procura DLLs duplicadas entre client mods e nomes duplicados entre server mods">
              {checkingConflicts ? "Verificando..." : "Verificar conflitos"}
            </button>
            <span className="filter-separator"></span>
            <select
              className="version-input"
              value={sptVersionInput}
              onChange={(e) => {
                setSptVersionInput(e.target.value);
                window.modManagerAPI.setSptVersionOverride(e.target.value);
              }}
              title="Versão do SPT usada na checagem de atualizações da Forge — a lista vem direto da Forge"
            >
              <option value="">selecione a versão do SPT...</option>
              {forgeSptVersions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} ({v.modCount} mods)
                </option>
              ))}
              {sptVersionInput && !forgeSptVersions.some((v) => v.version === sptVersionInput) && (
                <option value={sptVersionInput}>{sptVersionInput} (não listada na Forge)</option>
              )}
            </select>
            <button
              onClick={handleCheckForgeUpdates}
              disabled={checkingForgeUpdates}
              title="Consulta a API pública da Forge (forge.sp-tarkov.com) por atualizações dos mods instalados"
            >
              {checkingForgeUpdates ? "Consultando Forge..." : "Verificar atualizações (Forge)"}
            </button>
          </div>

          {forgeCheckedAt && (
            <p className="sort-hint">
              Última verificação da Forge: {new Date(forgeCheckedAt).toLocaleString("pt-BR")}
            </p>
          )}

          {sortField !== "name" && (
            <p className="sort-hint">
              A ordem de carregamento (▲▼) sempre segue o load order real — ordenar por outro campo só muda a exibição.
            </p>
          )}

          {compareResult && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>Comparação com a lista importada</strong>
                <button onClick={() => setCompareResult(null)}>Fechar</button>
              </div>
              {compareResult.missing.length === 0 && compareResult.extra.length === 0 ? (
                <p>As duas listas são idênticas.</p>
              ) : (
                <>
                  {compareResult.missing.length > 0 && (
                    <p>
                      <strong>Faltando aqui ({compareResult.missing.length}):</strong> {compareResult.missing.join(", ")}
                    </p>
                  )}
                  {compareResult.extra.length > 0 && (
                    <p>
                      <strong>A mais aqui, fora da lista importada ({compareResult.extra.length}):</strong> {compareResult.extra.join(", ")}
                    </p>
                  )}
                </>
              )}
              <p className="compare-note">
                Isso é só uma comparação — o app não guarda os arquivos originais dos mods, então reinstalar os que
                estão faltando precisa ser feito manualmente.
              </p>
            </div>
          )}

          {conflictReport && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>Verificação de conflitos</strong>
                <button onClick={() => setConflictReport(null)}>Fechar</button>
              </div>
              {conflictReport.clientFileConflicts.length === 0 && conflictReport.duplicateServerNames.length === 0 ? (
                <p>Nenhum conflito óbvio encontrado.</p>
              ) : (
                <>
                  {conflictReport.clientFileConflicts.map((c) => (
                    <p key={`dll-${c.fileName}`}>
                      <strong>DLL "{c.fileName}"</strong> aparece em: {c.mods.join(", ")}
                    </p>
                  ))}
                  {conflictReport.duplicateServerNames.map((d) => (
                    <p key={`name-${d.declaredName}`}>
                      <strong>Nome "{d.declaredName}"</strong> declarado em mais de uma pasta: {d.mods.join(", ")}
                    </p>
                  ))}
                </>
              )}
              <p className="compare-note">
                Checagem no nível de arquivo — sinaliza sobreposição, não garante incompatibilidade de verdade.
              </p>
            </div>
          )}

          {forgeError && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>Verificação de atualizações (Forge)</strong>
                <button onClick={() => setForgeError(null)}>Fechar</button>
              </div>
              <p>{forgeError}</p>
            </div>
          )}

          {forgeResult && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>Verificação de atualizações (Forge) — SPT {forgeResult.sptVersionUsed}</strong>
                <button onClick={() => setForgeResult(null)}>Fechar</button>
              </div>
              {forgeResult.updates.length > 0 && (
                <>
                  <p><strong>Atualizações disponíveis:</strong></p>
                  {forgeResult.updates.map((u) => (
                    <p key={`update-${u.name}`}>
                      {u.name}: {u.currentVersion} → <strong>{u.recommendedVersion}</strong>
                      {u.downloadLink && (
                        <>
                          {" "}
                          (<a href={u.downloadLink} target="_blank" rel="noreferrer">link</a>)
                        </>
                      )}
                    </p>
                  ))}
                </>
              )}
              {forgeResult.blocked.length > 0 && (
                <>
                  <p><strong>Atualizações bloqueadas (quebrariam dependência):</strong></p>
                  {forgeResult.blocked.map((b) => (
                    <p key={`blocked-${b.name}`}>
                      {b.name}: {b.currentVersion} — {b.reason}
                    </p>
                  ))}
                </>
              )}
              {forgeResult.incompatible.length > 0 && (
                <>
                  <p><strong>Incompatíveis com essa versão do SPT:</strong></p>
                  {forgeResult.incompatible.map((i) => (
                    <p key={`incompatible-${i.name}`}>{i.name} ({i.currentVersion})</p>
                  ))}
                </>
              )}
              {forgeResult.infoOnly.length > 0 && (
                <>
                  <p><strong>Sem versão local pra comparar (mostrando o que a Forge tem):</strong></p>
                  {forgeResult.infoOnly.map((info) => (
                    <p key={`info-${info.name}`}>{info.name}: Forge tem v{info.recommendedVersion}</p>
                  ))}
                </>
              )}
              {forgeResult.updates.length === 0 &&
                forgeResult.blocked.length === 0 &&
                forgeResult.incompatible.length === 0 &&
                forgeResult.infoOnly.length === 0 && (
                <p>Todos os mods identificados no Forge estão atualizados.</p>
              )}
              {forgeResult.unmatched.length > 0 && (
                <p className="compare-note">
                  Não encontrados no Forge (busca por nome): {forgeResult.unmatched.join(", ")}
                </p>
              )}
              <p className="compare-note">
                Casamento com o catálogo da Forge é por nome — pode não achar mods com nome muito genérico ou que
                não estão listados lá.
              </p>
            </div>
          )}

          {selectedKeys.size > 0 && (
            <div className="bulk-bar">
              <span>{selectedKeys.size} selecionado(s)</span>
              <div className="bulk-actions">
                <button onClick={() => runBulk("enable")} disabled={mutating}>Habilitar</button>
                <button onClick={() => runBulk("disable")} disabled={mutating}>Desabilitar</button>
                <button onClick={() => runBulk("remove")} className="danger" disabled={mutating}>Remover</button>
                <button onClick={clearSelection}>Cancelar seleção</button>
              </div>
            </div>
          )}

          {filtersActive && filteredMods.length === 0 && mods.length > 0 && (
            <div className="no-results">
              Nenhum mod bate com os filtros/busca atuais.
              <button onClick={clearFilters}>Limpar filtros</button>
            </div>
          )}

          <Section title="Server Mods" mods={filteredMods.filter((m) => m.type === "server")} onMove={handleMove} reorderable {...listProps} />
          <Section title="Client Mods" mods={filteredMods.filter((m) => m.type === "client")} {...listProps} />
          {mods.some((m) => m.type === "hybrid" || m.type === "unknown") && (
            <Section title="Hybrid / Unknown" mods={filteredMods.filter((m) => m.type === "hybrid" || m.type === "unknown")} {...listProps} />
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  mods,
  ...listProps
}: { title: string; mods: ModInfo[] } & Omit<Parameters<typeof ModList>[0], "mods">) {
  return (
    <section>
      <h2>{title} ({mods.length})</h2>
      <ModList mods={mods} {...listProps} />
    </section>
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
  onRangeSelect,
  openMenuKey,
  onSetOpenMenuKey,
  disabled = false,
  forgeStatusByName
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
  onRangeSelect: (keys: string[]) => void;
  openMenuKey: string | null;
  onSetOpenMenuKey: (key: string | null) => void;
  disabled?: boolean;
  forgeStatusByName?: Map<string, { status: "update" | "blocked" | "incompatible" | "info"; version?: string }>;
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  if (mods.length === 0) {
    return <p className="empty-list">Nenhum mod nessa categoria.</p>;
  }

  function handleCheckboxClick(e: ReactMouseEvent<HTMLInputElement>, mod: ModInfo, index: number) {
    if (e.shiftKey && lastClickedIndex !== null) {
      const [start, end] = lastClickedIndex < index ? [lastClickedIndex, index] : [index, lastClickedIndex];
      onRangeSelect(mods.slice(start, end + 1).map(selectionKey));
    } else {
      onToggleSelect(mod);
    }
    setLastClickedIndex(index);
  }

  return (
    <ul className="mod-list">
      {mods.map((mod, index) => {
        const key = selectionKey(mod);
        const isEditing = editingKey === key;
        const isMenuOpen = openMenuKey === key;
        const forgeStatus = forgeStatusByName?.get(mod.name);
        return (
          <li key={key} className={`mod-item ${mod.enabled ? "" : "disabled"}`}>
            <input
              type="checkbox"
              checked={selectedKeys.has(key)}
              onClick={(e) => handleCheckboxClick(e, mod, index)}
              onChange={() => {}}
              className="mod-checkbox"
              disabled={disabled}
              title="Clique para selecionar, Shift+Clique para selecionar um intervalo"
            />
            <span className="mod-number">{String(index + 1).padStart(2, "0")}</span>
            {reorderable && mod.enabled && (
              <div className="reorder-buttons">
                <button onClick={() => onMove?.(mod, -1)} title="Mover pra cima" disabled={disabled}>▲</button>
                <button onClick={() => onMove?.(mod, 1)} title="Mover pra baixo" disabled={disabled}>▼</button>
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
                <span className="mod-name" title={`${mod.originalName} (duplo-clique pra renomear)`} onDoubleClick={() => onRenameStart(mod)}>
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
                {forgeStatus?.status === "update" && (
                  <span className="meta-chip forge-chip-update" title="Nova versão disponível na Forge">
                    Forge: v{forgeStatus.version} disponível
                  </span>
                )}
                {forgeStatus?.status === "blocked" && (
                  <span className="meta-chip forge-chip-blocked" title="Tem atualização na Forge, mas instalar quebraria a dependência de outro mod">
                    Forge: atualização bloqueada
                  </span>
                )}
                {forgeStatus?.status === "incompatible" && (
                  <span className="meta-chip forge-chip-incompatible" title="A versão instalada não é compatível com a versão do SPT informada na última checagem">
                    Forge: incompatível
                  </span>
                )}
                {forgeStatus?.status === "info" && (
                  <span className="meta-chip forge-chip-info" title="Sem versão local legível pra comparar (mod sem package.json, ex: mods .dll) — essa é a versão mais recente conhecida na Forge">
                    Forge: v{forgeStatus.version}
                  </span>
                )}
                {mod.manifestOnly && (
                  <span className="meta-chip" title="Arquivos soltos rastreados por manifesto (sem pasta própria) — só dá pra remover">
                    Órfão
                  </span>
                )}
              </div>
            </div>
            <div className="action-menu-wrapper">
              <button className="menu-trigger" onClick={() => onSetOpenMenuKey(isMenuOpen ? null : key)} title="Ações" disabled={disabled}>
                ⋮
              </button>
              {isMenuOpen && (
                <div className="action-menu">
                  {!mod.manifestOnly && (
                    <button onClick={() => { onToggle(mod); onSetOpenMenuKey(null); }}>
                      {mod.enabled ? "Desabilitar" : "Habilitar"}
                    </button>
                  )}
                  {!mod.manifestOnly && (
                    <button onClick={() => { onOpenFolder(mod); onSetOpenMenuKey(null); }}>Abrir pasta</button>
                  )}
                  <button onClick={() => onRenameStart(mod)}>Renomear</button>
                  <button onClick={() => { onReinstall(mod); onSetOpenMenuKey(null); }}>Reinstalar</button>
                  <button className="danger" onClick={() => { onUninstall(mod); onSetOpenMenuKey(null); }}>Remover</button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}