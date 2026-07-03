import { useEffect, useState, useCallback } from "react";
import { ModInfo } from "./types";

export default function App() {
  const [sptPath, setSptPath] = useState<string | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refreshMods = useCallback(async () => {
    const list = await window.modManagerAPI.scanMods();
    setMods(list);
  }, []);

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
      setStatusMessage("Instância configurada.");
      refreshMods();
    } else {
      setStatusMessage(result.message ?? "Não foi possível selecionar a pasta.");
    }
  }

  async function handleInstall() {
    setLoading(true);
    const result = await window.modManagerAPI.installMod();
    setStatusMessage(result.message);
    setLoading(false);
    if (result.success) refreshMods();
  }

  async function handleToggle(mod: ModInfo) {
    const result = await window.modManagerAPI.toggleMod(mod);
    setStatusMessage(result.message);
    if (result.success) refreshMods();
  }

  async function handleUninstall(mod: ModInfo) {
    const confirmed = window.confirm(`Remover "${mod.name}" permanentemente?`);
    if (!confirmed) return;
    const result = await window.modManagerAPI.uninstallMod(mod);
    setStatusMessage(result.message);
    if (result.success) refreshMods();
  }

  async function handleMove(mod: ModInfo, direction: -1 | 1) {
    const serverMods = mods.filter((m) => m.type === "server" && m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);
    const index = serverMods.findIndex((m) => m.id === mod.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= serverMods.length) return;

    const reordered = [...serverMods];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    const result = await window.modManagerAPI.reorderMods(reordered.map((m) => m.id));
    setStatusMessage(result.message);
    if (result.success) refreshMods();
  }

  if (!sptPath) {
    return (
      <div className="empty-state">
        <h1>SPT Mod Manager</h1>
        <p>Selecione a pasta da sua instância SPT pra começar.</p>
        <button onClick={handleSelectFolder}>Selecionar pasta da instância</button>
        {statusMessage && <p className="status-message">{statusMessage}</p>}
      </div>
    );
  }

  const serverMods = mods.filter((m) => m.type === "server");
  const clientMods = mods.filter((m) => m.type === "client");

  return (
    <div className="app">
      <header>
        <div>
          <h1>SPT Mod Manager</h1>
          <span className="instance-path">{sptPath}</span>
        </div>
        <div className="header-actions">
          <button onClick={handleSelectFolder}>Trocar instância</button>
          <button onClick={handleInstall} disabled={loading} className="primary">
            {loading ? "Instalando..." : "Instalar mod (.zip / .7z)"}
          </button>
        </div>
      </header>

      {statusMessage && <div className="status-bar">{statusMessage}</div>}

      <section>
        <h2>Server Mods ({serverMods.length})</h2>
        <ModList mods={serverMods} onToggle={handleToggle} onUninstall={handleUninstall} onMove={handleMove} reorderable />
      </section>

      <section>
        <h2>Client Mods ({clientMods.length})</h2>
        <ModList mods={clientMods} onToggle={handleToggle} onUninstall={handleUninstall} />
      </section>
    </div>
  );
}

function ModList({
  mods,
  onToggle,
  onUninstall,
  onMove,
  reorderable = false
}: {
  mods: ModInfo[];
  onToggle: (mod: ModInfo) => void;
  onUninstall: (mod: ModInfo) => void;
  onMove?: (mod: ModInfo, direction: -1 | 1) => void;
  reorderable?: boolean;
}) {
  if (mods.length === 0) {
    return <p className="empty-list">Nenhum mod encontrado aqui.</p>;
  }

  return (
    <ul className="mod-list">
      {mods.map((mod) => (
        <li key={mod.id} className={`mod-item ${mod.enabled ? "" : "disabled"}`}>
          {reorderable && mod.enabled && (
            <div className="reorder-buttons">
              <button onClick={() => onMove?.(mod, -1)} title="Mover pra cima">▲</button>
              <button onClick={() => onMove?.(mod, 1)} title="Mover pra baixo">▼</button>
            </div>
          )}
          <div className="mod-info">
            <span className="mod-name">{mod.name}</span>
            {mod.installedManually && <span className="badge">instalado manualmente</span>}
          </div>
          <div className="mod-actions">
            <button onClick={() => onToggle(mod)}>{mod.enabled ? "Desabilitar" : "Habilitar"}</button>
            <button onClick={() => onUninstall(mod)} className="danger">Remover</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
