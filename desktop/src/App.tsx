import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Waveform } from "./components/Waveform";
import { debug } from "./debug";
import {
  OrateurInstallGate,
  type OrateurCliReleaseInfo,
} from "./OrateurInstallGate";
import {
  initialOrateurState,
  overlayVisualState,
  reduceOrateurEvent,
  selectDisplayLevels,
  showPulse,
  showRecording,
  showTtsChrome,
  type OrateurVisualState,
  type UiEventPayload,
} from "./orateurState";
import "./App.css";

/** Rounded clip for frameless transparent overlay (see App.css). Modal portal: `#modal-portal-root` in index.html. */
function OverlayAppShell({ children }: { children: React.ReactNode }) {
  return <div className="overlay-shell">{children}</div>;
}

function formatClockSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Frameless window: native edges + full-window drag conflict; use explicit resize strips. */
const OVERLAY_RESIZE_DIRS = [
  "NorthWest",
  "North",
  "NorthEast",
  "West",
  "East",
  "SouthWest",
  "South",
  "SouthEast",
] as const;

type OverlayResizeDir = (typeof OVERLAY_RESIZE_DIRS)[number];

function OverlayResizeEdges() {
  const onMouseDown = useCallback((e: React.MouseEvent, dir: OverlayResizeDir) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) return;
    void getCurrentWindow().startResizeDragging(dir);
  }, []);

  return (
    <>
      {OVERLAY_RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`overlay__resize overlay__resize--${dir}`}
          onMouseDown={(e) => onMouseDown(e, dir)}
          aria-hidden
        />
      ))}
    </>
  );
}

function SettingsPanel() {
  const [eventsPathLabel, setEventsPathLabel] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [autoStartDaemon, setAutoStartDaemon] = useState(true);
  const [checkCliOnStartup, setCheckCliOnStartup] = useState(false);
  const [cliHint, setCliHint] = useState<{ latest: string } | null>(null);
  const [cliInfo, setCliInfo] = useState<OrateurCliReleaseInfo | null>(null);
  const [cliPhase, setCliPhase] = useState<"idle" | "checking" | "updating">("idle");
  const [cliMessage, setCliMessage] = useState<string | null>(null);
  const [cliLog, setCliLog] = useState<string | null>(null);
  const [updatePhase, setUpdatePhase] = useState<
    "idle" | "checking" | "uptodate" | "downloading" | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string>("get_resolved_events_path")
      .then(setEventsPathLabel)
      .catch(() => {});
    void (async () => {
      try {
        const def = await invoke<string>("get_default_events_path");
        const cfg = await invoke<string | null>("read_events_path_config");
        setPathDraft(cfg?.trim() || def);
      } catch {
        setPathDraft("");
      }
    })();
    void invoke<boolean>("get_auto_start_daemon")
      .then(setAutoStartDaemon)
      .catch(() => {});
    void invoke<boolean>("get_check_orateur_cli_on_startup")
      .then(setCheckCliOnStartup)
      .catch(() => {});
    try {
      const raw = sessionStorage.getItem("orateur_cli_update_hint");
      if (raw) {
        setCliHint(JSON.parse(raw) as { latest: string });
      }
    } catch {
      /* ignore */
    }
    void invoke<OrateurCliReleaseInfo>("get_orateur_cli_release_info")
      .then((info) => {
        setCliInfo(info);
        setCliMessage(null);
      })
      .catch((e) => {
        setCliMessage(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ line: string; isStderr: boolean }>("orateur_install_log", (e) => {
      const { line, isStderr } = e.payload;
      setCliLog(
        (prev) =>
          (prev ?? "") + (isStderr ? "[stderr] " : "") + line + "\n",
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const savePath = useCallback(async () => {
    const trimmed = pathDraft.trim();
    const def = await invoke<string>("get_default_events_path");
    const pathOpt =
      trimmed.length === 0 || trimmed === def ? null : trimmed;
    await invoke("restart_tail_listener", {
      payload: { path: pathOpt },
    });
  }, [pathDraft]);

  const refreshCliRelease = useCallback(async () => {
    setCliPhase("checking");
    setCliMessage(null);
    try {
      const info = await invoke<OrateurCliReleaseInfo>("get_orateur_cli_release_info");
      setCliInfo(info);
    } catch (e) {
      setCliMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setCliPhase("idle");
    }
  }, []);

  const runCliUpgrade = useCallback(async () => {
    setCliPhase("updating");
    setCliLog("");
    setCliMessage(null);
    try {
      const r = await invoke<{ ok: boolean; stdout: string; stderr: string }>(
        "upgrade_orateur_cli",
      );
      if (r.ok) {
        const info = await invoke<OrateurCliReleaseInfo>("get_orateur_cli_release_info");
        setCliInfo(info);
        sessionStorage.removeItem("orateur_cli_update_hint");
        setCliHint(null);
        setCliMessage("Orateur CLI updated.");
      } else {
        setCliMessage([r.stderr, r.stdout].filter(Boolean).join("\n") || "Update failed.");
      }
    } catch (e) {
      setCliMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setCliPhase("idle");
    }
  }, []);

  const checkAndInstallUpdates = useCallback(async () => {
    if (!(await isTauri())) {
      setUpdateMessage("Updates are only available in the desktop app.");
      setUpdatePhase("error");
      return;
    }
    setUpdatePhase("checking");
    setUpdateMessage(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        setUpdatePhase("uptodate");
        setUpdateMessage("You are on the latest version.");
        return;
      }
      setUpdatePhase("downloading");
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") {
          setUpdateMessage("Installed. Restarting…");
        }
      });
      await relaunch();
    } catch (e) {
      setUpdatePhase("error");
      setUpdateMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="settings">
      {cliHint ? (
        <p className="settings__cli-banner" role="status">
          A newer Orateur CLI is available (latest: <code>{cliHint.latest}</code>). Update below or dismiss
          this message by updating.
        </p>
      ) : null}
      <header className="settings__header">
        <img
          className="settings__logo"
          src="/logo.png"
          alt=""
          width={40}
          height={40}
          decoding="async"
        />
        <h1 className="settings__title">Settings</h1>
      </header>
      <p className="settings__hint">
        Path to <code>ui_events.jsonl</code> (same as Quickshell or{" "}
        <code>orateur run</code> with <code>ui_events_mirror</code>). Default
        matches Python <code>~/.cache/orateur/ui_events.jsonl</code>.
      </p>
      <label className="settings__label">
        Events file
        <input
          className="settings__input"
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          placeholder={eventsPathLabel}
        />
      </label>
      <div className="settings__row">
        <button type="button" className="settings__btn settings__btn--primary" onClick={savePath}>
          Apply path &amp; restart tail
        </button>
      </div>
      <p className="settings__path">
        Active: <code>{eventsPathLabel || "…"}</code>
      </p>
      <label className="settings__label settings__label--checkbox">
        <input
          type="checkbox"
          checked={autoStartDaemon}
          onChange={(e) => {
            const v = e.target.checked;
            setAutoStartDaemon(v);
            void invoke("set_auto_start_daemon", { enabled: v }).catch(() => {});
          }}
        />
        Start <code>orateur run</code> when this app launches (runs <code>orateur setup</code> first if
        the STT stack is missing; applies on next launch)
      </label>
      <div className="settings__section">
        <p className="settings__hint">Orateur CLI (Python package and launcher from GitHub Releases).</p>
        {cliInfo ? (
          <p className="settings__path">
            Installed:{" "}
            <code>{cliInfo.currentVersion ?? "not detected"}</code> — latest:{" "}
            <code>{cliInfo.latestVersion}</code>
          </p>
        ) : null}
        <label className="settings__label settings__label--checkbox">
          <input
            type="checkbox"
            checked={checkCliOnStartup}
            onChange={(e) => {
              const v = e.target.checked;
              setCheckCliOnStartup(v);
              void invoke("set_check_orateur_cli_on_startup", { enabled: v }).catch(() => {});
            }}
          />
          Check for CLI updates when the app starts (compares to GitHub; no auto-install)
        </label>
        <div className="settings__row">
          <button
            type="button"
            className="settings__btn"
            disabled={cliPhase === "checking" || cliPhase === "updating"}
            onClick={() => void refreshCliRelease()}
          >
            {cliPhase === "checking" ? "Checking…" : "Check CLI updates"}
          </button>
          <button
            type="button"
            className="settings__btn settings__btn--primary"
            disabled={
              cliPhase === "checking" ||
              cliPhase === "updating" ||
              !cliInfo?.updateAvailable
            }
            onClick={() => void runCliUpgrade()}
          >
            {cliPhase === "updating"
              ? "Updating…"
              : cliInfo?.currentVersion
                ? "Update CLI"
                : "Install CLI"}
          </button>
        </div>
        {cliLog ? <pre className="settings__cli-log">{cliLog}</pre> : null}
        {cliMessage ? (
          <p
            className={
              cliMessage.startsWith("Orateur CLI updated")
                ? "settings__update-msg"
                : "settings__update-msg settings__update-msg--error"
            }
          >
            {cliMessage}
          </p>
        ) : null}
      </div>
      <div className="settings__section">
        <p className="settings__hint">Desktop app updates (signed builds from GitHub Releases).</p>
        <div className="settings__row">
          <button
            type="button"
            className="settings__btn"
            disabled={updatePhase === "checking" || updatePhase === "downloading"}
            onClick={() => void checkAndInstallUpdates()}
          >
            {updatePhase === "checking"
              ? "Checking…"
              : updatePhase === "downloading"
                ? "Downloading…"
                : "Check for updates"}
          </button>
        </div>
        {updateMessage ? (
          <p
            className={
              updatePhase === "error" ? "settings__update-msg settings__update-msg--error" : "settings__update-msg"
            }
          >
            {updateMessage}
          </p>
        ) : null}
      </div>
      <p className="settings__hint settings__hint--footer">
        Close this window when done. Reopen from the tray icon → Settings.
      </p>
    </div>
  );
}

function OverlayPanel() {
  const [state, setState] = useState<OrateurVisualState>(initialOrateurState);
  const [tick, setTick] = useState(0);
  const [ttsTick, setTtsTick] = useState(0);

  useEffect(() => {
    let unEvent: (() => void) | undefined;
    void (async () => {
      unEvent = await listen<UiEventPayload>("orateur:event", (e) => {
        setState((prev) => reduceOrateurEvent(prev, e.payload));
      });
    })();
    return () => {
      unEvent?.();
    };
  }, []);

  useEffect(() => {
    if (!state.showAfterDone) return;
    const t = window.setTimeout(() => {
      setState((s) => ({ ...s, showAfterDone: false }));
    }, 2500);
    return () => window.clearTimeout(t);
  }, [state.showAfterDone]);

  const visualState = useMemo(() => overlayVisualState(state), [state]);

  useEffect(() => {
    if (!visualState.recording) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [visualState.recording]);

  useEffect(() => {
    if (state.ttsPhase !== "play" || state.ttsPlayStartedAt <= 0) return;
    const id = window.setInterval(() => setTtsTick((x) => x + 1), 200);
    return () => window.clearInterval(id);
  }, [state.ttsPhase, state.ttsPlayStartedAt]);

  const displayLevels = useMemo(() => selectDisplayLevels(visualState), [visualState]);

  const recordingElapsed =
    visualState.recording && visualState.recordingStartTime > 0
      ? Math.floor(Date.now() / 1000 - visualState.recordingStartTime)
      : 0;
  void tick;

  const ttsRemainingSec = useMemo(() => {
    if (state.ttsPhase !== "play" || state.ttsPlayStartedAt <= 0) return 0;
    void ttsTick;
    const elapsed = Date.now() / 1000 - state.ttsPlayStartedAt;
    const left = Math.ceil(state.ttsDurationSec - elapsed);
    return left < 0 ? 0 : left;
  }, [state, ttsTick]);

  const isActive =
    visualState.uiState !== "idle" || state.showAfterDone || visualState.recording;

  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (debug.overlayNoAutoHide) {
      return;
    }
    if (isActive) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      void (async () => {
        if (await isTauri()) {
          await invoke("hide_overlay").catch(() => {});
        }
      })();
    }, 800);
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [isActive, debug.overlayNoAutoHide]);

  return (
    <div className="overlay">
      <div
        className={`overlay__bar ${isActive ? "overlay__bar--active" : ""}`}
        data-tauri-drag-region
      >
        <div className="app__barInner" data-tauri-drag-region>
          <div className="app__slot app__slot--left" data-tauri-drag-region>
            {showPulse(visualState) && (
              <span
                className={`app__pulse ${visualState.recording ? "" : "app__pulse--stt"}`}
                aria-hidden
              />
            )}
            {showTtsChrome(visualState) && (
              <span
                className={`app__ttsDot ${
                  visualState.ttsPhase === "synthesize" ? "app__ttsDot--syn" : "app__ttsDot--play"
                }`}
                aria-hidden
              />
            )}
          </div>

          <div className="app__waveWrap" data-tauri-drag-region>
            <Waveform levels={displayLevels} />
          </div>

          <div className="app__slot app__slot--right" data-tauri-drag-region>
            {(showRecording(visualState) || showTtsChrome(visualState)) && (
              <span className="app__timer">
                {showRecording(visualState)
                  ? formatClockSeconds(recordingElapsed)
                  : visualState.ttsPhase === "synthesize"
                    ? "--:--"
                    : formatClockSeconds(ttsRemainingSec)}
              </span>
            )}
          </div>
        </div>
      </div>
      <OverlayResizeEdges />
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<"loading" | "overlay" | "settings" | "browser">(
    "loading"
  );

  useEffect(() => {
    void (async () => {
      if (await isTauri()) {
        const label = await getCurrentWindow().label;
        const modeClass =
          label === "settings" ? "app--settings" : "app--overlay";
        // Apply mode on both `html` and `body` so `:root` / layout rules stay consistent.
        document.documentElement.classList.add(modeClass);
        document.body.classList.add(modeClass);
        setMode(label === "settings" ? "settings" : "overlay");
      } else {
        document.documentElement.classList.add("app--browser");
        document.body.classList.add("app--browser");
        setMode("browser");
      }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "overlay") return;
    void (async () => {
      if (!(await isTauri())) return;
      const on = await invoke<boolean>("get_check_orateur_cli_on_startup").catch(() => false);
      if (!on) return;
      const info = await invoke<OrateurCliReleaseInfo>("get_orateur_cli_release_info").catch(
        () => null,
      );
      if (info?.updateAvailable) {
        sessionStorage.setItem(
          "orateur_cli_update_hint",
          JSON.stringify({ latest: info.latestVersion }),
        );
      } else {
        sessionStorage.removeItem("orateur_cli_update_hint");
      }
    })();
  }, [mode]);

  if (mode === "loading") {
    return null;
  }

  if (mode === "settings") {
    return (
      <OrateurInstallGate>
        <SettingsPanel />
      </OrateurInstallGate>
    );
  }

  if (mode === "browser") {
    return (
      <div className="browserDev">
        <p className="browserDev__note">
          Browser preview: overlay layout below. Run <code>npm run tauri dev</code>{" "}
          for the real borderless window + tray.
        </p>
        <OverlayAppShell>
          <OverlayPanel />
        </OverlayAppShell>
      </div>
    );
  }

  return (
    <OrateurInstallGate>
      <OverlayAppShell>
        <OverlayPanel />
      </OverlayAppShell>
    </OrateurInstallGate>
  );
}
