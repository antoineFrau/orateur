import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const SNOOZE_KEY = "orateur_install_snoozed";

export type OrateurEnvCheck = {
  orateurInstalled: boolean;
  pythonOk: boolean;
  pythonVersion: string | null;
  pythonExecutable: string | null;
  orateurCliWorks: boolean;
  detail: string;
};

export type InstallPreview = {
  usesBundledWheel: boolean;
  installSource: string;
};

export type OrateurInstallResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type OrateurCliReleaseInfo = {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
};

type GatePhase = "pending" | "checking" | "blocked" | "passed";

function portalTarget(): HTMLElement {
  return document.getElementById("modal-portal-root") ?? document.body;
}

export function OrateurInstallGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<GatePhase>("pending");
  const [check, setCheck] = useState<OrateurEnvCheck | null>(null);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ line: string; isStderr: boolean }>("orateur_install_log", (e) => {
      const { line, isStderr } = e.payload;
      setInstallLog((prev) => {
        const next = (prev ?? "") + (isStderr ? "[stderr] " : "") + line + "\n";
        return next;
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const runCheck = useCallback(async () => {
    const c = await invoke<OrateurEnvCheck>("check_orateur_environment");
    setCheck(c);
    if (c.orateurInstalled) {
      setPhase("passed");
      return true;
    }
    const p = await invoke<InstallPreview>("get_orateur_install_preview");
    setPreview(p);
    setPhase("blocked");
    return false;
  }, []);

  useEffect(() => {
    void (async () => {
      if (!(await isTauri())) {
        setPhase("passed");
        return;
      }
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SNOOZE_KEY) === "1") {
        setPhase("passed");
        return;
      }
      setPhase("checking");
      try {
        await runCheck();
      } catch (e) {
        setCheck({
          orateurInstalled: false,
          pythonOk: false,
          pythonVersion: null,
          pythonExecutable: null,
          orateurCliWorks: false,
          detail: e instanceof Error ? e.message : String(e),
        });
        try {
          const p = await invoke<InstallPreview>("get_orateur_install_preview");
          setPreview(p);
        } catch {
          /* ignore */
        }
        setPhase("blocked");
      }
    })();
  }, [runCheck]);

  const snooze = useCallback(() => {
    sessionStorage.setItem(SNOOZE_KEY, "1");
    setPhase("passed");
  }, []);

  const runInstall = useCallback(async () => {
    setInstalling(true);
    setInstallLog("");
    try {
      const r = await invoke<OrateurInstallResult>("install_orateur_from_desktop");
      if (r.ok) {
        const c = await invoke<OrateurEnvCheck>("check_orateur_environment");
        setCheck(c);
        if (c.orateurInstalled) {
          void invoke("trigger_orateur_daemon").catch(() => {});
          setPhase("passed");
        } else {
          setInstallLog(
            (prev) =>
              (prev ?? "") +
              [r.stdout, r.stderr].filter(Boolean).join("\n") +
              "\nInstall reported success but orateur is still not detected. Try restarting the app, or install manually.",
          );
        }
      } else {
        setInstallLog(
          (prev) =>
            (prev ?? "") + ([r.stderr, r.stdout].filter(Boolean).join("\n") || "Install failed."),
        );
      }
    } catch (e) {
      setInstallLog((prev) => (prev ?? "") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setInstalling(false);
    }
  }, []);

  if (phase === "pending") {
    return null;
  }
  if (phase === "passed") {
    return <>{children}</>;
  }

  const modal = (
    <div className="installGate" role="dialog" aria-modal="true" aria-labelledby="installGate-title">
      <div className="installGate__backdrop" />
      <div className="installGate__panel">
        <img
          className="installGate__logo"
          src="/logo.png"
          alt=""
          width={48}
          height={48}
          decoding="async"
        />
        <h2 id="installGate-title" className="installGate__title">
          {phase === "checking" ? "Checking…" : "Install Orateur"}
        </h2>
        {phase === "checking" && (
          <p className="installGate__text">
            Looking for the <code>orateur</code> command and Python 3.10+.
          </p>
        )}
        {phase === "blocked" && check && (
          <>
            <p className="installGate__text">
              This desktop app only reads <code>ui_events.jsonl</code>. The <strong>orateur</strong> CLI
              is not available on this system yet (or it is not on your <code>PATH</code>).
            </p>
            {check.detail ? <pre className="installGate__detail">{check.detail}</pre> : null}
            {preview?.usesBundledWheel ? (
              <p className="installGate__hint installGate__text">Using offline bundle from the app.</p>
            ) : null}
            {!check.pythonOk && (
              <p className="installGate__warn">
                Install <strong>Python 3.10+</strong> first (from python.org or your package manager), then
                reopen this app.
              </p>
            )}
            {installLog !== null && installLog !== "" && (
              <pre className="installGate__log installGate__log--scroll">{installLog}</pre>
            )}
            <div className="installGate__actions">
              <button
                type="button"
                className="installGate__btn installGate__btn--primary"
                disabled={installing || !check.pythonOk}
                onClick={() => void runInstall()}
              >
                {installing ? "Installing…" : "Install"}
              </button>
              <button type="button" className="installGate__btn" disabled={installing} onClick={snooze}>
                Not now
              </button>
            </div>
            <p className="installGate__footer">
              After install, the desktop app can run <code>orateur setup</code> (if STT is not ready) and{" "}
              <code>orateur run</code> for you. Ensure <code>ui_events_mirror</code> is enabled in config
              (default). You can turn this off under tray → Settings.
            </p>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, portalTarget());
}
