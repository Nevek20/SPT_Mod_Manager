# SPT Mod Manager

[![Latest release](https://img.shields.io/github/v/release/Nevek20/SPT_Mod_Manager?label=release)](https://github.com/Nevek20/SPT_Mod_Manager/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Nevek20/SPT_Mod_Manager/total?label=GitHub%20downloads)](https://github.com/Nevek20/SPT_Mod_Manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

🇧🇷 Leia em Português: [README_pt-BR.md](README_pt-BR.md)

A mod manager in the spirit of **Vortex** and **Mod Organizer 2**, built specifically for **SPT**.

Install, update, enable, disable and remove mods without digging through folders. Browse the mod catalogue and install in one click, with dependencies pulled in automatically. Mods you already installed by hand keep working and show up in the list like any other.

> ⚠️ Personal project, not affiliated with the SPT team or Battlestate Games. Tarkov and Escape from Tarkov are trademarks of their respective owners.

![Main window](docs/screenshot.png)

---

## Download

**[Get the latest installer from Releases](https://github.com/Nevek20/SPT_Mod_Manager/releases/latest)** (`SPT-Mod-Manager-x.x.x-win-x64.exe`), or from the [mod page on sp-mod.com](https://sp-mod.com/mod/2851/spt-mod-manager).

1. Run the installer.
2. Windows SmartScreen may warn about an unrecognized app, because the installer isn't code-signed. Click **More info → Run anyway**.
3. Open the app and point it at your SPT folder. It finds the instance on its own, including setups where the client and the server live in different folders.

The app can also check for new versions of itself, so you don't have to come back here.

**Requirements:** Windows 10 or 11 (x64) and an existing SPT install. Linux and macOS aren't officially supported yet.

---

## Features

### Browse and install
- Search the catalogue from inside the app, by name or category, sorted by downloads, recently updated, recently added or name.
- Filter to mods compatible with your SPT version, and pick which version of a mod to install.
- One click downloads and installs. Big downloads stream straight to disk, with progress, percentage and speed in the download queue.
- Install your own `.zip`, `.7z` or `.rar` files with the file picker or by dragging them onto the window.
- Archives with odd layouts (extra wrapper folders, loose files next to `user/`) are handled. If the app can't tell what an archive is, it shows you its contents and asks, instead of guessing.

![Browse tab](docs/screenshot2.png)

### Dependencies
- Before installing, the app asks the source which mods this one needs and compares that with what you have.
- Missing or outdated dependencies are listed with their size, and **Install all** gets them first, then the mod.
- Search results show a badge on mods that need something you don't have.
- Mods that are made of several parts (server + client) are treated as one package: enabling, disabling or removing one part takes the others along.

### Updates
- **Check for updates** compares every installed mod against the source, with a status chip on each row: update available, blocked, incompatible with your SPT version.
- **Update all** installs everything in dependency order. When mod A needs the new version of mod B, B goes first.
- Updating keeps what you had: a disabled mod stays disabled, and if the new version renamed its folder, the old one is removed instead of left behind to load twice.

### Organize
- Enable and disable without deleting anything.
- A tree view groups multi-part mods under one row, with filters by type, status and origin, and sorting by name, type, status, origin or install date.
- Rename how a mod shows up without touching any real file.
- Select several mods (Shift+Click for a range) and enable, disable or remove them at once.
- Open a mod's folder (either half, for server + client mods) or its page on the source.

### Mod lists
- Export your mod list to a file, and import it on another PC or a fresh install.
- On import, the app compares against what's installed, downloads the exact versions that are missing and offers to disable the extras.

### Safety
- SPT's own files (like `spt-core.dll`) are never listed or touched as if they were mods, and a mod that ships its own copy can't overwrite yours.
- Archive entries are checked before extraction, so nothing can write outside the SPT folder.
- Every install is verified file by file before reporting success.
- Conflict check: flags duplicate DLLs across client mods and server mods declaring the same name.

### Languages
English, Português, 中文, Русский, Français, 日本語 and Deutsch, picked from your system language on first launch.

---

## Found a bug?

When something fails, the error has a **Details** button. It opens a box with:

- **Copy error**: the error plus the app version, SPT version and Windows version, which is exactly what's needed to look into it. Your Windows username is removed from any path.
- **Open a GitHub issue**: opens a new issue with all of that already filled in.

You can also post it in the comments on the [sp-mod.com page](https://sp-mod.com/mod/2851/spt-mod-manager).

---

## How it works

### Where mods live
| What | Where |
|---|---|
| Active server mods | `<SPT>/user/mods/` |
| Disabled server mods | `<SPT>/user/mods.disabled/` |
| Active client mods | `<SPT>/BepInEx/plugins/` |
| Disabled client mods | `<SPT>/BepInEx/plugins.disabled/` |

### Mod sources
The catalogue comes from [sp-mod.com](https://sp-mod.com) by default, with [Forge Alt](https://forge-alt.katrinfoxvr.com) as a second option. Both use the same API and the same mod IDs, so switching between them doesn't lose anything. The app is read-only toward them and needs no account or API key.

### Recognizing installed mods
SPT 4.x mods declare an ID (`com.author.mod`), a version and their dependencies inside their DLL, and the app reads them from there. That ID is what links a mod on disk to the catalogue, and most mods are resolved in a single batched request. Mods without one fall back to name matching, and every hit is double-checked, because a wrong match is worse than none. Once found, the catalogue ID is cached, so later checks take seconds.

For mods installed through the app, the version the source reported at install time wins over the one in the DLL: some authors forget to bump the number inside the DLL, which would otherwise show an update forever.

### Load order
SPT 4.x mods handle their own load order, so the app doesn't rename folders or force any order. Older folders with a numeric prefix (`01_modname`) are still read and sorted correctly.

### Files the app keeps in your SPT folder
- `.spt-mod-manager-registry.json`: which mods the app installed, and what the source said about them
- `.spt-mod-manager-aliases.json`: your custom display names
- `.spt-mod-manager-manifest.json`: loose files a mod brought along outside its own folder, so they're removed with it
- `.spt-mod-manager-forge-match.json`: cached catalogue IDs for faster update checks

---

## Known limitations

- **Conflict detection is file-level.** It catches duplicate DLLs and duplicate server mod names, but can't tell whether two mods change the same thing in-game.
- **Two mods can pin different versions of the same library.** Only one copy fits on disk, so the last one installed wins. The dependency dialog shows which other mods use a library before you update it.
- **Reinstall asks for the file again.** Keeping every archive would double the disk space of your mods (a 3 GB mod would take 6 GB).
- **Mods that aren't on the catalogue** can be installed and managed, but can't be checked for updates.
- **Windows only**, for now.

---

## Development

Requires [Node.js](https://nodejs.org/) 18 or later.

```bash
git clone https://github.com/Nevek20/SPT_Mod_Manager.git
cd SPT_Mod_Manager
npm install
npm run electron:dev     # build and open the app
npm test                 # run the test suite
npm run electron:build   # build the Windows installer into release/
```

`npm run dev` opens only the UI in a browser, which is handy for CSS work, but nothing that needs the backend will work there.

### Project structure
```
electron/
  main.ts          window, IPC handlers, settings
  preload.ts       exposes window.modManagerAPI to the UI
  modManager.ts    everything that touches disk or the network
  sources.ts       mod sources (sp-mod.com, Forge Alt)
  peVersion.ts     reads the SPT version from SPT.Server.exe
src/
  App.tsx          the UI
  modTree.ts       groups mod parts into the tree view
  i18n.ts          the 7 dictionaries
  reportError.ts   builds the error report
tests/             one file per area (npm test runs all of them)
scripts/           one-off investigation scripts
```

### Tests
Each file in `tests/` covers one area and most of them work on real temporary folders. `npm version` runs the whole suite first and refuses to bump if anything fails.

---

## Contributing

Issues and PRs are welcome. For anything big, open an issue first so we can agree on the approach.

**Translations are especially welcome.** Copy an existing dictionary in `src/i18n.ts`, add the code to the `Lang` type and to `LANG_LABELS`, and run:

```bash
npx tsx tests/checkTranslations.ts
```

It compares every key against English and catches what a manual review usually misses, like a placeholder such as `{name}` renamed or dropped, which would make the app show the literal `{name}` instead of the mod's name.

---

## Credits

The Chinese, Russian, French, Japanese and German translations were contributed by **[GΛVRIEL](https://github.com/GAVRIEL-911)**, who built a multilingual edition of the Manager on his own and offered it back to the project. Portuguese and English are maintained here.

Thanks to everyone who reports bugs and suggests features in the comments. Most of what's in this README exists because someone asked for it.

## License

[MIT](LICENSE)

`.rar` extraction uses [node-unrar-js](https://github.com/YuJianrong/node-unrar.js), a WASM build of the official UnRAR source, which has its own license (not MIT). See the package's `LICENSE.md`.