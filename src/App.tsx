import { useEffect, useState, useCallback, useMemo, useRef, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  ModInfo,
  ModType,
  ConflictReport,
  ForgeUpdateCheckResult,
  ForgeSptVersion,
  ForgeStatusCacheEntry,
  ForgeCatalogMod,
  ForgeCategory,
  InstallResult
} from "./types";
import { Lang, translate, translateBackendMessage } from "./i18n";

const LANG_STORAGE_KEY = "spt-mod-manager.lang";

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
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LANG_STORAGE_KEY) as Lang) || "pt-BR");
  function changeLang(next: Lang) {
    setLang(next);
    localStorage.setItem(LANG_STORAGE_KEY, next);
  }
  function t(key: string, vars?: Record<string, string | number>): string {
    return translate(lang, key, vars);
  }
  function tMsg(msg: string | undefined | null): string {
    return translateBackendMessage(msg, lang);
  }

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

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseCategory, setBrowseCategory] = useState("");
  const [browseCategories, setBrowseCategories] = useState<ForgeCategory[]>([]);
  const [browseOnlyCompatible, setBrowseOnlyCompatible] = useState(false);
  const [browseResults, setBrowseResults] = useState<ForgeCatalogMod[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLastPage, setBrowseLastPage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selectedVersionByModId, setSelectedVersionByModId] = useState<Map<number, number>>(new Map());
  const [installingModId, setInstallingModId] = useState<number | null>(null);

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
      pushToast(tMsg(result.message) || t("toast.instanceConfigured"), true);
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
      pushToast(tMsg(result.message) || t("toast.folderSelectFailed"), false);
    }
  }

  function handleOpenModHub() {
    window.modManagerAPI.openModHub();
  }

  const confirmResolverRef = useRef<((result: InstallResult) => void) | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ tmpDir: string; archivePath: string; rootEntries: string[] } | null>(null);

  // Ponto único por onde toda instalação passa. Se o backend responder pedindo
  // confirmação (estrutura de arquivo incomum), abre o modal e "pausa" aqui até o
  // usuário decidir — quem chamou só recebe o resultado final (instalado ou cancelado).
  async function installArchiveWithConfirmFlow(installCall: Promise<InstallResult>): Promise<InstallResult> {
    const result = await installCall;
    if (!result.needsConfirmation || !result.tmpDir) return result;
    return new Promise<InstallResult>((resolve) => {
      confirmResolverRef.current = resolve;
      setPendingConfirm({ tmpDir: result.tmpDir!, archivePath: result.archivePath ?? "", rootEntries: result.rootEntries ?? [] });
    });
  }

  async function handleConfirmProceed() {
    if (!pendingConfirm) return;
    const { tmpDir, archivePath } = pendingConfirm;
    setPendingConfirm(null);
    const result = await window.modManagerAPI.confirmUnrecognizedInstall(tmpDir, archivePath);
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
  }

  async function handleConfirmAbort() {
    if (!pendingConfirm) return;
    const { tmpDir } = pendingConfirm;
    setPendingConfirm(null);
    const result = await window.modManagerAPI.abortUnrecognizedInstall(tmpDir);
    confirmResolverRef.current?.({ success: false, message: result.message });
    confirmResolverRef.current = null;
  }

  async function handleInstall() {
    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    const result = await installArchiveWithConfirmFlow(window.modManagerAPI.installMod());
    pushToast(tMsg(result.message), result.success);
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
      pushToast(t("toast.dropInvalidFile"), false);
      return;
    }

    setLoading(true);
    const previousKeys = new Set(mods.map(selectionKey));
    let successCount = 0;
    for (const file of archives) {
      // @ts-expect-error o Electron injeta `.path` no objeto File nativo, fora da tipagem padrão do DOM
      const filePath: string | undefined = file.path;
      if (!filePath) continue;
      const result = await installArchiveWithConfirmFlow(window.modManagerAPI.installModFromPath(filePath));
      if (result.success) successCount++;
      pushToast(tMsg(result.message), result.success);
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
    pushToast(tMsg(result.message), result.success);
    if (result.success) {
      // Atualização local (sem re-escanear o disco inteiro) — bem mais rápido com muitos mods.
      setMods((prev) => prev.map((m) => (m.id === mod.id && m.type === mod.type ? { ...m, enabled: !m.enabled } : m)));
    }
    setMutating(false);
  }

  async function handleUninstall(mod: ModInfo) {
    const confirmed = window.confirm(t("toast.confirmRemove", { name: mod.name }));
    if (!confirmed) return;
    setMutating(true);
    const result = await window.modManagerAPI.uninstallMod(mod);
    pushToast(tMsg(result.message), result.success);
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
    if (!result.success) pushToast(tMsg(result.message), false);
  }

  async function handleReinstall() {
    pushToast(t("toast.selectUpdatedFile"), true);
    await handleInstall();
  }

  async function handleExportList() {
    const result = await window.modManagerAPI.exportModList();
    pushToast(tMsg(result.message), result.success);
  }

  async function handleImportList() {
    const result = await window.modManagerAPI.importModList();
    pushToast(tMsg(result.message), result.success);
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
    pushToast(total === 0 ? t("toast.noConflictsFound") : t("toast.conflictsFound", { count: total }), total === 0);
  }

  function persistForgeStatus(map: Map<string, { status: "update" | "blocked" | "incompatible" | "info"; version?: string }>) {
    const asArray: ForgeStatusCacheEntry[] = Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
    window.modManagerAPI.setForgeCache(asArray);
    setForgeCheckedAt(new Date().toISOString());
  }

  async function handleCheckForgeUpdates() {
    if (!sptVersionInput.trim()) {
      pushToast(t("toast.enterSptVersion"), false);
      return;
    }
    setCheckingForgeUpdates(true);
    setForgeError(null);
    const payload = mods.map((m) => ({ name: m.name, originalName: m.originalName, version: m.version }));
    const response = await window.modManagerAPI.checkForgeUpdates(payload, sptVersionInput.trim());
    setCheckingForgeUpdates(false);
    if (!response.success || !response.result) {
      const message = tMsg(response.message) || t("toast.forgeUpdateCheckFailed");
      setForgeError(message);
      pushToast(message, false);
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
    pushToast(total === 0 ? t("toast.forgeAllUpToDate") : t("toast.forgeUpdatesAvailable", { count: total }), true);
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

  async function runForgeSearch(page: number) {
    setBrowseLoading(true);
    setBrowseError(null);
    const response = await window.modManagerAPI.searchForgeMods({
      query: browseQuery.trim() || undefined,
      categorySlug: browseCategory || undefined,
      sptVersionConstraint: browseOnlyCompatible && sptVersionInput.trim() ? sptVersionInput.trim() : undefined,
      page
    });
    setBrowseLoading(false);
    if (!response.success || !response.result) {
      setBrowseError(tMsg(response.message) || t("toast.forgeSearchFailed"));
      return;
    }
    setBrowseResults(response.result.mods);
    setBrowsePage(response.result.page);
    setBrowseLastPage(response.result.lastPage);
  }

  async function handleOpenBrowse() {
    setBrowseOpen(true);
    if (browseCategories.length === 0) {
      window.modManagerAPI.getForgeCategories().then(setBrowseCategories);
    }
    runForgeSearch(1);
  }

  function handleSelectVersion(modId: number, versionId: number) {
    setSelectedVersionByModId((prev) => new Map(prev).set(modId, versionId));
  }

  async function handleInstallFromForge(mod: ForgeCatalogMod) {
    const versionId = selectedVersionByModId.get(mod.id) ?? mod.versions[0]?.id;
    const version = mod.versions.find((v) => v.id === versionId) ?? mod.versions[0];
    if (!version) {
      pushToast(t("browse.noVersionPublished", { name: mod.name }), false);
      return;
    }
    setInstallingModId(mod.id);
    const previousKeys = new Set(mods.map(selectionKey));
    const result = await installArchiveWithConfirmFlow(window.modManagerAPI.installForgeMod(version.link, mod.name));
    setInstallingModId(null);
    pushToast(tMsg(result.message), result.success);
    if (result.success) {
      const updated = await refreshMods();
      checkForgeForNewMods(previousKeys, updated);
    }
  }

  async function handleMove(mod: ModInfo, direction: -1 | 1) {
    const serverMods = mods.filter((m) => m.type === "server" && m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);
    const index = serverMods.findIndex((m) => m.id === mod.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= serverMods.length) return;

    const reordered = [...serverMods];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    const result = await window.modManagerAPI.reorderMods(reordered.map((m) => m.id));
    pushToast(tMsg(result.message), result.success);
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
    pushToast(tMsg(result.message), result.success);
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
      const confirmed = window.confirm(t("toast.confirmRemoveBulk", { count: selectedMods.length }));
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

    pushToast(t("toast.bulkProcessed", { done: succeededKeys.size, total: selectedMods.length }), true);
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
    forgeStatusByName,
    t
  };

  const langToggle = (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button className={lang === "pt-BR" ? "lang-active" : ""} onClick={() => changeLang("pt-BR")}>PT</button>
      <button className={lang === "en" ? "lang-active" : ""} onClick={() => changeLang("en")}>EN</button>
    </div>
  );

  return (
    <>
      <ToastStack toasts={toasts} />

      {!sptPath ? (
        <div className="empty-state">
          {langToggle}
          <h1>SPT Mod Manager</h1>
          <p>{t("empty.selectFolder")}</p>
          <button onClick={handleSelectFolder}>{t("empty.selectFolderButton")}</button>
          <button onClick={handleOpenModHub}>{t("empty.downloadModsButton")}</button>
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
              <div className="drop-overlay-box">{t("dropOverlay.text")}</div>
            </div>
          )}
          <header>
            <div>
              <h1>SPT Mod Manager</h1>
              <span className="instance-path" title={sptPath}>{sptPath}</span>
            </div>
            <div className="header-actions">
              {langToggle}
              <button onClick={handleOpenBrowse} className="primary" title={t("header.browseForgeTitle")}>
                {t("header.browseForge")}
              </button>
              <button onClick={handleOpenModHub} title={t("header.openHubTitle")}>{t("header.openHub")}</button>
              <button onClick={handleSelectFolder} title={t("header.changeInstanceTitle")}>{t("header.changeInstance")}</button>
              <button onClick={handleInstall} disabled={loading} className="primary" title={t("header.installButtonTitle")}>
                {loading ? t("header.installing") : t("header.installButton")}
              </button>
            </div>
          </header>

          <div className="summary-bar">
            <span className="summary-item">
              <strong>{summary.total}</strong> {t("summary.total")}
            </span>
            <span className="summary-item">Server: <strong>{summary.server}</strong></span>
            <span className="summary-item">Client: <strong>{summary.client}</strong></span>
            <span className="summary-item summary-active">{t("summary.active")} <strong>{summary.active}</strong></span>
            <span className="summary-item summary-disabled">{t("summary.disabled")} <strong>{summary.disabled}</strong></span>
            {sptVersion && (
              <span className="summary-item" title={t("summary.versionTooltip")}>
                {sptVersion}
              </span>
            )}
            <span className="summary-item summary-valid" title={t("summary.validInstanceTitle")}>✔ {t("summary.validInstance")}</span>
          </div>

          <input
            className="search-bar"
            type="text"
            placeholder={t("filters.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="filter-bar">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} title={t("filters.typeFilterTitle")}>
              <option value="all">{t("filters.typeAll")}</option>
              <option value="server">Server</option>
              <option value="client">Client</option>
              <option value="hybrid">Hybrid</option>
              <option value="unknown">Unknown</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} title={t("filters.statusFilterTitle")}>
              <option value="all">{t("filters.statusAll")}</option>
              <option value="enabled">{t("filters.statusEnabled")}</option>
              <option value="disabled">{t("filters.statusDisabled")}</option>
            </select>
            <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} title={t("filters.originFilterTitle")}>
              <option value="all">{t("filters.originAll")}</option>
              <option value="manual">{t("filters.originManual")}</option>
              <option value="manager">{t("filters.originManager")}</option>
            </select>

            <span className="filter-separator" />

            <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} title={t("filters.sortFieldTitle")}>
              <option value="name">{t("filters.sortByName")}</option>
              <option value="type">{t("filters.sortByType")}</option>
              <option value="status">{t("filters.sortByStatus")}</option>
              <option value="origin">{t("filters.sortByOrigin")}</option>
              <option value="installedAt">{t("filters.sortByInstalledAt")}</option>
            </select>
            <button onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))} title={t("filters.sortDirectionTitle")}>
              {sortDirection === "asc" ? t("filters.sortAsc") : t("filters.sortDesc")}
            </button>

            <span className="filter-separator" />

            <button onClick={selectAllVisible} title={t("filters.selectAllVisibleTitle")}>{t("filters.selectAllVisible")}</button>
            {selectedKeys.size > 0 && <button onClick={clearSelection}>{t("filters.clearSelection")}</button>}

            <span className="filter-separator" />

            <button onClick={handleExportList} title={t("filters.exportListTitle")}>{t("filters.exportList")}</button>
            <button onClick={handleImportList} title={t("filters.importCompareTitle")}>{t("filters.importCompare")}</button>
            <button onClick={handleDetectConflicts} disabled={checkingConflicts} title={t("filters.checkConflictsTitle")}>
              {checkingConflicts ? t("filters.checkingConflicts") : t("filters.checkConflicts")}
            </button>
            <span className="filter-separator"></span>
            <select
              className="version-input"
              value={sptVersionInput}
              onChange={(e) => {
                setSptVersionInput(e.target.value);
                window.modManagerAPI.setSptVersionOverride(e.target.value);
              }}
              title={t("filters.sptVersionTitle")}
            >
              <option value="">{t("filters.sptVersionPlaceholder")}</option>
              {forgeSptVersions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} ({v.modCount} mods)
                </option>
              ))}
              {sptVersionInput && !forgeSptVersions.some((v) => v.version === sptVersionInput) && (
                <option value={sptVersionInput}>{sptVersionInput} {t("filters.sptVersionNotListed")}</option>
              )}
            </select>
            <button
              onClick={handleCheckForgeUpdates}
              disabled={checkingForgeUpdates}
              title={t("filters.forgeCheckTitle")}
            >
              {checkingForgeUpdates ? t("filters.forgeChecking") : t("filters.forgeCheckButton")}
            </button>
          </div>

          {forgeCheckedAt && (
            <p className="sort-hint">
              {t("hint.forgeLastChecked", { date: new Date(forgeCheckedAt).toLocaleString(lang) })}
            </p>
          )}

          {sortField !== "name" && (
            <p className="sort-hint">{t("hint.sortOrderNote")}</p>
          )}

          {compareResult && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("compare.title")}</strong>
                <button onClick={() => setCompareResult(null)}>{t("common.close")}</button>
              </div>
              {compareResult.missing.length === 0 && compareResult.extra.length === 0 ? (
                <p>{t("compare.identical")}</p>
              ) : (
                <>
                  {compareResult.missing.length > 0 && (
                    <p>
                      <strong>{t("compare.missing", { count: compareResult.missing.length })}</strong> {compareResult.missing.join(", ")}
                    </p>
                  )}
                  {compareResult.extra.length > 0 && (
                    <p>
                      <strong>{t("compare.extra", { count: compareResult.extra.length })}</strong> {compareResult.extra.join(", ")}
                    </p>
                  )}
                </>
              )}
              <p className="compare-note">{t("compare.note")}</p>
            </div>
          )}

          {conflictReport && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("conflicts.title")}</strong>
                <button onClick={() => setConflictReport(null)}>{t("common.close")}</button>
              </div>
              {conflictReport.clientFileConflicts.length === 0 && conflictReport.duplicateServerNames.length === 0 ? (
                <p>{t("toast.noConflictsFound")}</p>
              ) : (
                <>
                  {conflictReport.clientFileConflicts.map((c) => (
                    <p key={`dll-${c.fileName}`}>
                      <strong>DLL "{c.fileName}"</strong> {t("conflicts.appearsIn")} {c.mods.join(", ")}
                    </p>
                  ))}
                  {conflictReport.duplicateServerNames.map((d) => (
                    <p key={`name-${d.declaredName}`}>
                      <strong>{t("conflicts.nameLabel")} "{d.declaredName}"</strong> {t("conflicts.declaredInMultiple")} {d.mods.join(", ")}
                    </p>
                  ))}
                </>
              )}
              <p className="compare-note">{t("conflicts.note")}</p>
            </div>
          )}

          {forgeError && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("forge.checkTitle")}</strong>
                <button onClick={() => setForgeError(null)}>{t("common.close")}</button>
              </div>
              <p>{forgeError}</p>
            </div>
          )}

          {forgeResult && (
            <div className="compare-panel">
              <div className="compare-header">
                <strong>{t("forge.checkTitle")} — SPT {forgeResult.sptVersionUsed}</strong>
                <button onClick={() => setForgeResult(null)}>{t("common.close")}</button>
              </div>
              {forgeResult.updates.length > 0 && (
                <>
                  <p><strong>{t("forge.updatesAvailable")}</strong></p>
                  {forgeResult.updates.map((u) => (
                    <p key={`update-${u.name}`}>
                      {u.name}: {u.currentVersion} → <strong>{u.recommendedVersion}</strong>
                      {u.downloadLink && (
                        <>
                          {" "}
                          (<a href={u.downloadLink} target="_blank" rel="noreferrer">{t("common.link")}</a>)
                        </>
                      )}
                    </p>
                  ))}
                </>
              )}
              {forgeResult.blocked.length > 0 && (
                <>
                  <p><strong>{t("forge.blockedTitle")}</strong></p>
                  {forgeResult.blocked.map((b) => (
                    <p key={`blocked-${b.name}`}>
                      {b.name}: {b.currentVersion} — {b.reason}
                    </p>
                  ))}
                </>
              )}
              {forgeResult.incompatible.length > 0 && (
                <>
                  <p><strong>{t("forge.incompatibleTitle")}</strong></p>
                  {forgeResult.incompatible.map((i) => (
                    <p key={`incompatible-${i.name}`}>{i.name} ({i.currentVersion})</p>
                  ))}
                </>
              )}
              {forgeResult.infoOnly.length > 0 && (
                <>
                  <p><strong>{t("forge.infoOnlyTitle")}</strong></p>
                  {forgeResult.infoOnly.map((info) => (
                    <p key={`info-${info.name}`}>{info.name}: {t("forge.infoHasVersion", { version: info.recommendedVersion ?? "" })}</p>
                  ))}
                </>
              )}
              {forgeResult.updates.length === 0 &&
                forgeResult.blocked.length === 0 &&
                forgeResult.incompatible.length === 0 &&
                forgeResult.infoOnly.length === 0 && (
                <p>{t("forge.allUpToDateDetailed")}</p>
              )}
              {forgeResult.unmatched.length > 0 && (
                <p className="compare-note">
                  {t("forge.unmatchedPrefix")} {forgeResult.unmatched.join(", ")}
                </p>
              )}
              <p className="compare-note">{t("forge.matchNote")}</p>
            </div>
          )}

          {selectedKeys.size > 0 && (
            <div className="bulk-bar">
              <span>{t("bulk.selectedCount", { count: selectedKeys.size })}</span>
              <div className="bulk-actions">
                <button onClick={() => runBulk("enable")} disabled={mutating}>{t("bulk.enable")}</button>
                <button onClick={() => runBulk("disable")} disabled={mutating}>{t("bulk.disable")}</button>
                <button onClick={() => runBulk("remove")} className="danger" disabled={mutating}>{t("bulk.remove")}</button>
                <button onClick={clearSelection}>{t("bulk.cancelSelection")}</button>
              </div>
            </div>
          )}

          {filtersActive && filteredMods.length === 0 && mods.length > 0 && (
            <div className="no-results">
              {t("noResults.text")}
              <button onClick={clearFilters}>{t("noResults.clearFilters")}</button>
            </div>
          )}

          <Section title="Server Mods" mods={filteredMods.filter((m) => m.type === "server")} onMove={handleMove} reorderable {...listProps} />
          <Section title="Client Mods" mods={filteredMods.filter((m) => m.type === "client")} {...listProps} />
          {mods.some((m) => m.type === "hybrid" || m.type === "unknown") && (
            <Section title="Hybrid / Unknown" mods={filteredMods.filter((m) => m.type === "hybrid" || m.type === "unknown")} {...listProps} />
          )}
        </div>
      )}

      {browseOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setBrowseOpen(false); }}>
          <div className="modal-box forge-browse-modal">
            <div className="modal-header">
              <strong>{t("browse.title")}</strong>
              <button onClick={() => setBrowseOpen(false)} title={t("common.close")}>✕</button>
            </div>

            <div className="forge-browse-controls">
              <input
                type="text"
                placeholder={t("browse.searchPlaceholder")}
                value={browseQuery}
                onChange={(e) => setBrowseQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runForgeSearch(1); }}
              />
              <select value={browseCategory} onChange={(e) => setBrowseCategory(e.target.value)} title={t("browse.categoryFilterTitle")}>
                <option value="">{t("browse.allCategories")}</option>
                {browseCategories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.title}</option>
                ))}
              </select>
              <label className="forge-browse-checkbox" title={t("browse.compatibleOnlyTitle")}>
                <input
                  type="checkbox"
                  checked={browseOnlyCompatible}
                  onChange={(e) => setBrowseOnlyCompatible(e.target.checked)}
                  disabled={!sptVersionInput.trim()}
                />
                {t("browse.compatibleOnlyLabel", { version: sptVersionInput.trim() || t("browse.selectVersionPlaceholder") })}
              </label>
              <button onClick={() => runForgeSearch(1)} disabled={browseLoading} className="primary">
                {browseLoading ? t("browse.searching") : t("browse.searchButton")}
              </button>
            </div>

            {browseError && <p className="compare-note">{browseError}</p>}

            <div className="forge-browse-results">
              {!browseLoading && browseResults.length === 0 && !browseError && (
                <p className="compare-note">{t("browse.noResults")}</p>
              )}
              {browseResults.map((mod) => {
                const selectedId = selectedVersionByModId.get(mod.id) ?? mod.versions[0]?.id;
                return (
                  <div key={mod.id} className="forge-mod-card">
                    {mod.thumbnail ? (
                      <img
                        src={mod.thumbnail}
                        alt=""
                        className="forge-mod-thumb"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                          e.currentTarget.nextElementSibling?.classList.remove("forge-mod-thumb-hidden");
                        }}
                      />
                    ) : null}
                    <div className={`forge-mod-thumb forge-mod-thumb-placeholder ${mod.thumbnail ? "forge-mod-thumb-hidden" : ""}`} />
                    <div className="forge-mod-info">
                      <div className="forge-mod-title-row">
                        <a href={mod.detailUrl} onClick={(e) => { e.preventDefault(); window.modManagerAPI.openModHub(); }} title={t("browse.viewOnForgeTitle")}>
                          {mod.name}
                        </a>
                        {mod.category && <span className="meta-chip">{mod.category}</span>}
                        {mod.fikaCompatible && <span className="meta-chip forge-chip-update" title={t("browse.fikaCompatibleTitle")}>Fika</span>}
                      </div>
                      {mod.teaser && <p className="forge-mod-teaser">{mod.teaser}</p>}
                      <div className="forge-mod-meta">
                        {mod.author && <span>{t("browse.byAuthor", { author: mod.author })}</span>}
                        <span>{mod.downloads.toLocaleString(lang)} {t("browse.downloadsLabel")}</span>
                      </div>
                    </div>
                    <div className="forge-mod-install">
                      {mod.versions.length > 0 ? (
                        <>
                          <select
                            value={selectedId}
                            onChange={(e) => handleSelectVersion(mod.id, Number(e.target.value))}
                            title={t("browse.chooseVersionTitle")}
                          >
                            {mod.versions.map((v) => (
                              <option key={v.id} value={v.id}>
                                v{v.version}{v.sptConstraint ? ` (SPT ${v.sptConstraint})` : ""}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => handleInstallFromForge(mod)} disabled={installingModId === mod.id} className="primary">
                            {installingModId === mod.id ? t("browse.installing") : t("browse.installButton")}
                          </button>
                        </>
                      ) : (
                        <span className="forge-mod-no-version">{t("browse.noVersionPublishedShort")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {browseLastPage > 1 && (
              <div className="forge-browse-pagination">
                <button onClick={() => runForgeSearch(browsePage - 1)} disabled={browsePage <= 1 || browseLoading}>{t("browse.prevPage")}</button>
                <span>{t("browse.pageOf", { page: browsePage, lastPage: browseLastPage })}</span>
                <button onClick={() => runForgeSearch(browsePage + 1)} disabled={browsePage >= browseLastPage || browseLoading}>{t("browse.nextPage")}</button>
              </div>
            )}

            <p className="compare-note">{t("browse.installNote")}</p>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div className="modal-backdrop">
          <div className="modal-box confirm-structure-modal">
            <div className="modal-header">
              <strong>{t("confirm.title")}</strong>
            </div>
            <p className="compare-note">
              {t("confirm.descriptionPrefix")} <code>package.json</code> {t("confirm.descriptionMid")} <code>user</code>/<code>BepInEx</code> {t("confirm.descriptionSuffix")}
            </p>
            <ul className="confirm-structure-list">
              {pendingConfirm.rootEntries.length > 0 ? (
                pendingConfirm.rootEntries.map((entry) => <li key={entry}>{entry}</li>)
              ) : (
                <li className="empty-list">{t("confirm.emptyArchive")}</li>
              )}
            </ul>
            <p className="compare-note">{t("confirm.explanation")}</p>
            <div className="confirm-structure-actions">
              <button onClick={handleConfirmAbort}>{t("confirm.abort")}</button>
              <button onClick={handleConfirmProceed} className="primary">{t("confirm.proceed")}</button>
            </div>
          </div>
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
  forgeStatusByName,
  t
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
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  if (mods.length === 0) {
    return <p className="empty-list">{t("modlist.emptyCategory")}</p>;
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
              title={t("modlist.checkboxTitle")}
            />
            <span className="mod-number">{String(index + 1).padStart(2, "0")}</span>
            {reorderable && mod.enabled && (
              <div className="reorder-buttons">
                <button onClick={() => onMove?.(mod, -1)} title={t("modlist.moveUpTitle")} disabled={disabled}>▲</button>
                <button onClick={() => onMove?.(mod, 1)} title={t("modlist.moveDownTitle")} disabled={disabled}>▼</button>
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
                <span className="mod-name" title={t("modlist.renameTitle", { name: mod.originalName })} onDoubleClick={() => onRenameStart(mod)}>
                  {mod.name}
                </span>
              )}
              <div className="mod-meta">
                <span className={`type-badge type-${mod.type}`}>{mod.type}</span>
                <span className={`status-chip ${mod.enabled ? "status-chip-on" : "status-chip-off"}`}>
                  {mod.enabled ? t("modlist.statusActive") : t("modlist.statusDisabled")}
                </span>
                <span className="origin-chip">{mod.installedManually ? "Manual" : "Manager"}</span>
                {mod.version && <span className="meta-chip">v{mod.version}</span>}
                {mod.author && <span className="meta-chip">{t("browse.byAuthor", { author: mod.author })}</span>}
                {forgeStatus?.status === "update" && (
                  <span className="meta-chip forge-chip-update" title={t("modlist.forgeUpdateAvailableTitle")}>
                    {t("modlist.forgeUpdateAvailable", { version: forgeStatus.version ?? "" })}
                  </span>
                )}
                {forgeStatus?.status === "blocked" && (
                  <span className="meta-chip forge-chip-blocked" title={t("modlist.forgeBlockedTitle")}>
                    {t("modlist.forgeBlocked")}
                  </span>
                )}
                {forgeStatus?.status === "incompatible" && (
                  <span className="meta-chip forge-chip-incompatible" title={t("modlist.forgeIncompatibleTitle")}>
                    {t("modlist.forgeIncompatible")}
                  </span>
                )}
                {forgeStatus?.status === "info" && (
                  <span className="meta-chip forge-chip-info" title={t("modlist.forgeInfoTitle")}>
                    {t("modlist.forgeInfo", { version: forgeStatus.version ?? "" })}
                  </span>
                )}
                {mod.manifestOnly && (
                  <span className="meta-chip" title={t("modlist.orphanTitle")}>
                    {t("modlist.orphan")}
                  </span>
                )}
              </div>
            </div>
            <div className="action-menu-wrapper">
              <button className="menu-trigger" onClick={() => onSetOpenMenuKey(isMenuOpen ? null : key)} title={t("modlist.actionsTitle")} disabled={disabled}>
                ⋮
              </button>
              {isMenuOpen && (
                <div className="action-menu">
                  {!mod.manifestOnly && (
                    <button onClick={() => { onToggle(mod); onSetOpenMenuKey(null); }}>
                      {mod.enabled ? t("bulk.disable") : t("bulk.enable")}
                    </button>
                  )}
                  {!mod.manifestOnly && (
                    <button onClick={() => { onOpenFolder(mod); onSetOpenMenuKey(null); }}>{t("modlist.openFolder")}</button>
                  )}
                  <button onClick={() => onRenameStart(mod)}>{t("modlist.rename")}</button>
                  <button onClick={() => { onReinstall(mod); onSetOpenMenuKey(null); }}>{t("modlist.reinstall")}</button>
                  <button className="danger" onClick={() => { onUninstall(mod); onSetOpenMenuKey(null); }}>{t("bulk.remove")}</button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}