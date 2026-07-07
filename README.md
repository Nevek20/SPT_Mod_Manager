# SPT Mod Manager

🇧🇷 **Português:** [Leia o README em Português](README-pt_BR.md)

A **Vortex / Mod Organizer 2**-style mod manager, built specifically for **Single Player Tarkov (SPT)**.

A desktop app (Electron + React + TypeScript) that handles installing, organizing, enabling/disabling, and removing mods without manually messing with folders — while staying compatible with mods you already installed by hand.

> Personal project, not affiliated with the SPT team or Battlestate Games. Tarkov and Escape from Tarkov are trademarks of their respective owners.

---

## Features

**Installation**
- Install mods from `.zip`, `.7z`, or `.rar`, via file picker or drag-and-drop straight into the window
- Automatic structure detection — works even when the mod is wrapped in extra folders (e.g. `SPT/user/mods/ModName/...`)
- Type detection: Server, Client, or Hybrid (when the mod has both parts)
- Post-install verification: checks file by file that everything was copied correctly before reporting success

**Organization**
- Enable/disable mods without deleting anything (moves between an active folder and a `.disabled` one)
- Reorder server mod load order (up/down buttons, using numeric folder prefixes — that's how SPT respects load order)
- Rename a mod's display name (alias) without touching any real file or folder
- Detects manually installed mods (outside the app) and distinguishes them from "installed by the Manager"
- Export the current mod list to a JSON file, and import a previous export to compare it against what's currently installed (shows what's missing / extra — it doesn't reinstall anything automatically, since the app doesn't keep the original archives)
- "Hybrid" mods installed via merge that leave loose files with no folder of their own still show up as an "Orphan" row, tracked through a manifest — removable cleanly even without a named folder

**Reliability**
- Conflict detection: duplicate DLL names across different client mods, and server mods declaring the same `name` in different folders
- Automatic SPT version detection (read from the instance's `core.json`), shown in the summary

**Finding what you need**
- Real-time search by name
- Filters by type, status (enabled/disabled), and origin (manual/Manager)
- Sort by name, type, status, origin, or install date
- Multi-select with bulk actions (enable/disable/remove several at once), including Shift+Click for range selection

**Interface**
- Cards showing type, status, origin, and — when available — mod version and author
- Per-mod action menu: enable/disable, open folder, rename, reinstall, remove (orphan entries only show rename/remove, since they don't have a folder of their own to enable or open)
- Instance summary in the header (total mods, breakdown by type, enabled/disabled, detected SPT version)
- Temporary success/error notifications

---

## Screenshots

![main screen](docs/screenshot.png)`)

![main screen 2](docs/screenshot2.png)`)
---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- Windows (the app assumes Windows-style SPT folder conventions; not tested on Linux/macOS)
- An existing SPT instance installed somewhere on your PC

### Development

```bash
git clone https://github.com/YOUR_USERNAME/spt-mod-manager.git
cd spt-mod-manager
npm install
npm run electron:dev
```

This builds the renderer (Vite) + the main process (`tsc`) and opens the Electron window.

If you just want to work on the UI without opening Electron (faster to iterate on CSS/layout):
```bash
npm run dev
```
In this mode `window.modManagerAPI` doesn't exist, so anything depending on the backend will fail — it's just for visuals.

### Building the installer (Windows)

```bash
npm run electron:build
```
Generates a `.exe` via `electron-builder` (configuration already set in `package.json`).

---

## Project structure

```
spt-mod-manager/
├── electron/
│   ├── main.ts         # Electron window + IPC handlers
│   ├── preload.ts       # exposes window.modManagerAPI to the renderer (contextIsolation)
│   ├── modManager.ts    # all the filesystem logic (scan, install, enable, etc)
│   └── types.ts         # shared types on the Electron side
├── src/
│   ├── App.tsx           # the whole React UI
│   ├── App.css           # styles
│   ├── main.tsx           # React entry point
│   └── types.ts           # types + interface for the API exposed by preload
├── package.json
└── vite.config.ts
```

---

## How it works under the hood

### Folder conventions used
| What | Where |
|---|---|
| Active server mods | `<instance>/user/mods/` |
| Disabled server mods | `<instance>/user/mods.disabled/` |
| Active client mods | `<instance>/BepInEx/plugins/` |
| Disabled client mods | `<instance>/BepInEx/plugins.disabled/` |

### Load order
SPT loads server mods in alphabetical order. The app controls this by prefixing the mod's folder with a 2-digit number (`01_modname`, `02_othermod`, ...), which gets updated whenever you use the reorder buttons.

### Control files (at the instance root)
- `.spt-mod-manager-registry.json` — tracks which mods were installed by the app (to tell them apart from "manually installed")
- `.spt-mod-manager-aliases.json` — custom display names (renaming doesn't touch any real file)

### "Smart" installation
When installing a `.zip`/`.7z`/`.rar`, the app searches recursively (not just at the archive's root) for a folder containing `user/` and/or `BepInEx/` — this covers both "ready to copy" mods and mods wrapped in an extra folder. If that structure isn't found, it tries to identify whether it's a server mod (via `package.json`) or a client mod (via `.dll`) and installs it in the right place.

---

## Known limitations

- **"Hybrid" mods installed via merge** show up as an "Orphan" row tracked through a manifest, but only support rename/remove — no enable/disable as a unit, since there's no folder of their own to move.
- **"Reinstall"** in the action menu opens the generic file picker (it doesn't keep the original `.zip`/`.7z`/`.rar`) — works well for updating a mod to a new version, but isn't a true one-click "reinstall this exact thing."
- **Conflict detection is file-level**, not semantic — it flags duplicate DLLs and duplicate server mod names, but has no idea whether two mods actually touch the same thing in-game.
- **No integrated search/download** from [hub.sp-tarkov.com](https://hub.sp-tarkov.com/) — intentionally, to avoid depending on an external API that can change without notice (the app just opens the link in your browser).
- Only tested on Windows.

---

## Roadmap

Done (moved up into Features ⬆️):
- [x] Conflict detection between mods (file-level)
- [x] Automatic SPT version detection in the header summary
- [x] Install manifest for hybrid mods (they show up in the list and can be removed cleanly)

Still open:
- [ ] A real one-click "reinstall", remembering the original `.zip`/`.7z`/`.rar` instead of reopening the generic file picker
- [ ] Deeper conflict detection (e.g. two mods editing the same loot table), not just duplicate file names
- [ ] Linux/macOS support

---

## Contributing

Personal project, but issues and PRs are welcome. If you're planning something big, open an issue first to align on it.

## License

[MIT](LICENSE)

`.rar` extraction is powered by [node-unrar-js](https://github.com/YuJianrong/node-unrar.js), a WASM build of the official UnRAR source, which is free to use but distributed under its own license (not MIT) — see the package's `LICENSE.md` for details.
