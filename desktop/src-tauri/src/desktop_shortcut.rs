//! Desktop-only global shortcut (Tauri), separate from `config.json` / `orateur run` shortcuts.

use std::str::FromStr;

use tauri::{AppHandle, Runtime};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const DEFAULT_RESTART_DAEMON_SHORTCUT: &str = "Super+Alt+R";

fn restart_shortcut_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("restart-daemon-shortcut.txt"))
}

/// Missing file → default; empty file → disabled (no global shortcut).
pub fn read_restart_daemon_shortcut<R: Runtime>(app: &AppHandle<R>) -> String {
    let path = match restart_shortcut_path(app) {
        Ok(p) => p,
        Err(_) => return DEFAULT_RESTART_DAEMON_SHORTCUT.to_string(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let t = s.trim();
            if t.is_empty() {
                String::new()
            } else {
                t.to_string()
            }
        }
        Err(_) => DEFAULT_RESTART_DAEMON_SHORTCUT.to_string(),
    }
}

fn write_restart_shortcut_file<R: Runtime>(app: &AppHandle<R>, shortcut: &str) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("restart-daemon-shortcut.txt");
    let body = if shortcut.is_empty() {
        String::new()
    } else {
        format!("{}\n", shortcut.trim())
    };
    std::fs::write(&p, body).map_err(|e| e.to_string())
}

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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn apply_restart_daemon_shortcut<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let s = read_restart_daemon_shortcut(app);
    if s.is_empty() {
        return Ok(());
    }
    validate_shortcut(&s)?;
    app.global_shortcut()
        .on_shortcut(s.as_str(), |app, _shortcut, event| {
            restart_shortcut_callback(app, event);
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_restart_daemon_shortcut(app: AppHandle) -> String {
    read_restart_daemon_shortcut(&app)
}

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
        let old = read_restart_daemon_shortcut(&app);
        if trimmed == old {
            return Ok(());
        }
        if !trimmed.is_empty() {
            validate_shortcut(&trimmed)?;
        }

        let gs = app.global_shortcut();
        if !old.is_empty() {
            let _ = gs.unregister(old.as_str());
        }
        write_restart_shortcut_file(&app, &trimmed)?;
        if !trimmed.is_empty() {
            gs.on_shortcut(trimmed.as_str(), |app, _shortcut, event| {
                restart_shortcut_callback(app, event);
            })
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
