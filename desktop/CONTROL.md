# Controlling Orateur from the desktop shell

The Tauri app mirrors **`ui_events.jsonl`** (same as Quickshell). By default it also **spawns `orateur run`** as a child process (and runs **`orateur setup`** first if the venv exists but **`pywhispercpp`** is not importable). It does **not** send recording commands to that process over IPC; global shortcuts in **`orateur run`** still drive STT/TTS. Disable auto-start under **tray → Settings** if you use **systemd** or another **`orateur run`** and want a single daemon. The Rust side uses the same **`XDG_CACHE_HOME`** / **`~/.cache/orateur`** rules as Python, resolves **`~`** in a custom path from Settings, and re-tails after log rotation (same path, new inode) or after **Apply path & restart tail** (even if the path string is unchanged).

## How `orateur run` is controlled today

- **`orateur run`** handles STT/TTS/STS and writes UI lines to **`~/.cache/orateur/ui_events.jsonl`** when **`ui_events_mirror`** is enabled in `~/.config/orateur/config.json`.
- **Global keyboard shortcuts** (configured in the same `config.json`) start/stop recording and TTS. This is the supported way to drive the main daemon.
- **`~/.cache/orateur/cmd.fifo`** is read by **`orateur ui`**, not by **`orateur run`**. Using **`orateur ui --events-only`** does not accept FIFO commands that replace shortcuts while `orateur run` owns the pipeline.

## Options if you want on-screen buttons later

| Approach | Pros | Cons |
|--------|------|------|
| **A — Shortcuts only** (current) | No duplicate processes; one Whisper load | Buttons in the UI are display-only |
| **B — New IPC in `orateur run`** (e.g. Unix socket or localhost HTTP) | Single STT stack; explicit API for UI | Requires changes in the Python codebase |
| **C — Full `orateur ui`** | FIFO/`ui-send` can drive recording | Second process loading STT/TTS/LLM |

For a remote Mac talking to Linux, prefer **B** on the host running `orateur run`, or SSH-based triggering of the same shortcuts, rather than tunneling a FIFO.
