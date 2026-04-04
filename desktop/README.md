# Orateur desktop (Tauri)

A small **status overlay** that follows **`ui_events.jsonl`** with the same event semantics as the Quickshell panel (`quickshell/orateur/OrateurWidget.qml`): waveform, timers, and status text.

## Prerequisites

- [Node.js](https://nodejs.org/) (for `npm`)
- [Rust](https://rustup.rs/) (for the Tauri backend)
- **Python 3.10+** on the machine if you use the in-app “Install with pip” flow (see below)

## Python package (first launch)

The desktop app **tails `ui_events.jsonl`** and, by default, **starts `orateur run` in the background** (after **`orateur setup`** if the STT stack in `~/.local/share/orateur/venv` is not ready). It does not bundle the Python engine. On open, it checks for the **`orateur`** CLI (including **`~/.local/bin`** even when the GUI has a minimal `PATH`) or an importable `orateur` via the detected interpreter.

- **Default install spec:** [`src-tauri/resources/orateur-pip-spec.txt`](./src-tauri/resources/orateur-pip-spec.txt) (pinned to `orateur==0.1.3`, matching the repo root `pyproject.toml`). Used to resolve the version for the installer and, on Windows, for `pip install --user`.
- **Unix (macOS / Linux):** Before each `vite` / Tauri build, [`scripts/copy-to-desktop-resources.mjs`](../scripts/copy-to-desktop-resources.mjs) copies [`scripts/install.sh`](../scripts/install.sh) and [`bin/orateur`](../bin/orateur) into `src-tauri/resources/`. The in-app installer runs **`bash install.sh`**, which creates **`~/.local/share/orateur/venv`**, installs the wheel (bundled or from GitHub Releases), optionally fetches **`quickshell-orateur.tar.gz`**, and installs **`~/.local/bin/orateur`**. This matches the [main README](../README.md) “GitHub Releases” flow.
- **Windows:** “Install” still runs **`pip install --user <spec>`** until a Windows-native installer exists.
- **Offline / air-gapped builds:** Build a wheel at the repo root, copy it to `src-tauri/resources/orateur-bundle.whl`, and list it under `bundle.resources` in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json). When present, the Unix installer passes that path to **`install.sh`** as **`ORATEUR_WHEEL`**. The wheel file is gitignored in `src-tauri/resources/.gitignore`.
- **After install:** Keep **`ui_events_mirror`** enabled for live events (default). The app runs **`orateur setup`** when the bundled venv exists but **`pywhispercpp`** is not importable, then **`orateur run`**. Logs: **`~/.cache/orateur/desktop-daemon.log`**. Turn auto-start off under **tray → Settings** (writes `auto-start-daemon` in the app config dir). If you already run **`orateur run`** elsewhere (e.g. systemd or a terminal), disable auto-start or you will have two daemons.

**Manual QA (installer):** (1) No Python → expect “Install Python 3.10+”. (2) Python 3.10+ but no `orateur` on `PATH` → install runs **`install.sh`** (Unix) or pip (Windows). (3) `orateur` already on `PATH` → no gate. (4) After success → gate closes; **`orateur setup`** / **`orateur run`** still apply.

## Development

1. **Orateur daemon:** By default the desktop app spawns **`orateur run`** on launch. Either let it do that, or disable **Start `orateur run` when this app launches** in Settings and run the daemon yourself from the repo root:

   ```bash
   uv sync
   uv run orateur run
   ```

   Ensure **`ui_events_mirror`** is **`true`** in **`~/.config/orateur/config.json`** (default) so events are appended to **`~/.cache/orateur/ui_events.jsonl`** (or **`$XDG_CACHE_HOME/orateur/ui_events.jsonl`** when `XDG_CACHE_HOME` is set). The Tauri app resolves the same default path using your user home (via Tauri’s `home_dir`, not only the `HOME` env var), so it stays aligned with **`orateur run`** when launched from the Dock or a terminal.

2. **Start the Tauri app** (in this directory):

   ```bash
   npm install
   npm run tauri dev
   ```

The **overlay** window is borderless and transparent: drag it by the bar, use **×** to hide it to the tray, or use the **tray icon** (menu bar on macOS, system tray on Linux/Windows):

- **Show status bar** — brings the overlay back
- **Settings** — path to `ui_events.jsonl`, “Apply path & restart tail”, and auto-start **`orateur run`**
- **Quit** — exit the app

Closing either window hides it (the app keeps running until **Quit**). The backend still tails `ui_events.jsonl` from the end of the file on connect (like `tail -n0 -F`).

## Overlay and virtual desktops

When the overlay is shown (activity in `ui_events.jsonl`, or **Show status bar** from the tray), the app aligns the window with the **currently active** Space (macOS), virtual desktop (Windows), or workspace (Linux).

| Platform | Approach |
| -------- | -------- |
| **macOS** | On startup the overlay `NSWindow` is turned into an **`NSPanel`** via **[tauri-nspanel](https://github.com/ahkohd/tauri-nspanel)** ([tauri#11488](https://github.com/tauri-apps/tauri/issues/11488), same patterns as [tauri-macos-spotlight-example](https://github.com/ahkohd/tauri-macos-spotlight-example)): brief **`ActivationPolicy::Accessory`**, then **`move_to_active_space` + `full_screen_auxiliary`**, **`NonactivatingPanel`** + borderless style mask, **`PanelLevel::Status`**, then **`ActivationPolicy::Regular`**. Show/hide use **`Panel::show` / `Panel::hide`** (`orderFrontRegardless` / `orderOut`), not `WebviewWindow::show` / `hide`. Requires `macOSPrivateApi` (already set). |
| **Windows** | The overlay `HWND` is moved onto the **current** virtual desktop (via `winvd`). |
| **Linux** | GTK `present()` raises the window; exact workspace behavior depends on the window manager. **Wayland** sessions are less predictable than **X11** because there is no single portable API for “move this window to the active workspace.” |

**See also (macOS overlay / panels):** [tauri#2258](https://github.com/tauri-apps/tauri/issues/2258) (`set_activation_policy`, Spotlight-style launchers), [tauri-macos-spotlight-example](https://github.com/ahkohd/tauri-macos-spotlight-example) (Spotlight-like demo using **tauri-nspanel**), and [Apple’s NSPanel](https://developer.apple.com/documentation/appkit/nspanel) overview.

### Manual verification checklist

Use when changing overlay or native window code, or before a release.

**macOS**

1. With multiple Spaces, switch Space then trigger an overlay show (`orateur run` + shortcut that appends to `ui_events.jsonl`). The bar should appear on the **active** Space.
2. From a **full-screen app** Space, trigger the same. The bar should appear on that Space.

**Windows**

1. Add a second virtual desktop (Task View).
2. Switch to it, then show the overlay. It should appear on the **current** desktop.

**Linux**

1. Under **X11**, confirm the overlay appears on the current workspace when shown.
2. Under **Wayland**, note the compositor (e.g. GNOME, KDE, Sway) if the overlay appears on the wrong workspace; fixes are compositor-specific and not guaranteed from the app alone.

## Build

```bash
npm run build
cargo build --release --manifest-path src-tauri/Cargo.toml
```

Use **`npm run tauri build`** when your environment supports the full bundler (icons, platform packages).

## Control model

See [CONTROL.md](./CONTROL.md) for how this relates to **`orateur run`**, shortcuts, and **`cmd.fifo`**.
