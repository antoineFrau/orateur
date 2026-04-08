//! Desktop-only global shortcut (Tauri) to restart `orateur run`.
//! The binding is stored in `~/.config/orateur/config.json` as `restart_daemon_shortcut`
//! (same token style as `primary_shortcut`). Legacy: `restart-daemon-shortcut.txt` in the app config dir.

use std::str::FromStr;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::orateur_config;

/// Default matches `src/orateur/config.py` and `ShortcutRecorder` / global-hotkey (`SUPER+ALT+R`).
pub const DEFAULT_RESTART_DAEMON_SHORTCUT: &str = "SUPER+ALT+R";

fn restart_shortcut_legacy_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("restart-daemon-shortcut.txt"))
}

fn parse_restart_value_from_config(v: &Value) -> String {
    if v.is_null() {
        return String::new();
    }
    if let Some(s) = v.as_str() {
        return s.trim().to_string();
    }
    String::new()
}

enum LegacyRestart {
    /// File missing — fall back to default string.
    Absent,
    /// File existed and was empty — user disabled the shortcut (pre–config.json).
    Empty,
    /// Legacy shortcut text.
    Value(String),
}

fn read_legacy_restart<R: Runtime>(app: &AppHandle<R>) -> LegacyRestart {
    let path = match restart_shortcut_legacy_path(app) {
        Ok(p) => p,
        Err(_) => return LegacyRestart::Absent,
    };
    match std::fs::read_to_string(&path) {
        Err(_) => LegacyRestart::Absent,
        Ok(s) => {
            let t = s.trim();
            if t.is_empty() {
                LegacyRestart::Empty
            } else {
                LegacyRestart::Value(t.to_string())
            }
        }
    }
}

/// Reads `restart_daemon_shortcut` from `config.json` when the key is present; otherwise legacy file, then default.
pub fn read_restart_daemon_shortcut<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Ok(cfg) = orateur_config::load_orateur_config_object(app) {
        if let Some(obj) = cfg.as_object() {
            if obj.contains_key("restart_daemon_shortcut") {
                return obj
                    .get("restart_daemon_shortcut")
                    .map(parse_restart_value_from_config)
                    .unwrap_or_default();
            }
        }
    }

    match read_legacy_restart(app) {
        LegacyRestart::Absent => DEFAULT_RESTART_DAEMON_SHORTCUT.to_string(),
        LegacyRestart::Empty => String::new(),
        LegacyRestart::Value(s) => s,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
static LAST_REGISTERED_RESTART: Mutex<Option<String>> = Mutex::new(None);

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn validate_shortcut(s: &str) -> Result<(), String> {
    Shortcut::from_str(s.trim()).map_err(|e| format!("Invalid shortcut: {e}"))?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn restart_shortcut_callback<R: Runtime>(app: &AppHandle<R>, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    if let Some(holder) = app.try_state::<crate::daemon::DaemonHolder>() {
        crate::daemon::schedule_restart_daemon(app, &*holder);
    }
}

/// Re-register the global shortcut from the current `config.json` / legacy rules. Unregisters the previous binding.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn sync_restart_daemon_shortcut_globals<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let new_s = read_restart_daemon_shortcut(app);
    let gs = app.global_shortcut();

    let old = LAST_REGISTERED_RESTART
        .lock()
        .ok()
        .and_then(|g| g.clone());

    if !new_s.is_empty() {
        validate_shortcut(&new_s)?;
    }

    if let Some(ref o) = old {
        if !o.is_empty() {
            let _ = gs.unregister(o.as_str());
        }
    }

    if new_s.is_empty() {
        if let Ok(mut g) = LAST_REGISTERED_RESTART.lock() {
            *g = None;
        }
        try_remove_legacy_shortcut_file(app);
        return Ok(());
    }

    gs.on_shortcut(new_s.as_str(), |app, _shortcut, event| {
        restart_shortcut_callback(app, event);
    })
    .map_err(|e| e.to_string())?;
    if let Ok(mut g) = LAST_REGISTERED_RESTART.lock() {
        *g = Some(new_s);
    }
    try_remove_legacy_shortcut_file(app);
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn try_remove_legacy_shortcut_file<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(cfg) = orateur_config::load_orateur_config_object(app) {
        if let Some(obj) = cfg.as_object() {
            if obj.contains_key("restart_daemon_shortcut") {
                if let Ok(p) = restart_shortcut_legacy_path(app) {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn sync_restart_daemon_shortcut_globals<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

/// Startup: register from disk (see [`sync_restart_daemon_shortcut_globals`]).
pub fn apply_restart_daemon_shortcut<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        sync_restart_daemon_shortcut_globals(app)
    }
}

#[tauri::command]
pub fn get_restart_daemon_shortcut(app: AppHandle) -> String {
    read_restart_daemon_shortcut(&app)
}

/// Writes `restart_daemon_shortcut` into `config.json` and applies the global shortcut immediately.
#[tauri::command]
pub fn set_restart_daemon_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, shortcut);
        return Err("Restart shortcut is only available on desktop".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let trimmed = shortcut.trim().to_string();
        if !trimmed.is_empty() {
            validate_shortcut(&trimmed)?;
        }
        orateur_config::merge_write_orateur_config(
            &app,
            json!({ "restart_daemon_shortcut": trimmed }),
        )?;
        sync_restart_daemon_shortcut_globals(&app)
    }
}

/// Call after `write_orateur_config_patch` updates `restart_daemon_shortcut` so the global hotkey matches disk.
#[tauri::command]
pub fn sync_restart_daemon_shortcut(app: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Err("Restart shortcut is only available on desktop".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        sync_restart_daemon_shortcut_globals(&app)
    }
}
