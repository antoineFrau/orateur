"""Best-effort desktop notifications (Linux: notify-send; macOS: AppleScript)."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys

log = logging.getLogger(__name__)

_APP_NAME = "Orateur"
_MAX_BODY = 500


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _notify_linux(summary: str, body: str, *, urgency: str) -> None:
    exe = shutil.which("notify-send")
    if not exe:
        log.debug("notify-send not found; skipping desktop notification")
        return
    urgency = urgency if urgency in ("low", "normal", "critical") else "normal"
    cmd = [exe, "-a", _APP_NAME, f"--urgency={urgency}", summary]
    if body:
        cmd.append(body)
    try:
        subprocess.run(
            cmd,
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        log.debug("Desktop notification failed: %s", e)


def _applescript_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _notify_macos(summary: str, body: str, *, urgency: str) -> None:
    osa = "/usr/bin/osascript"
    if not os.path.isfile(osa):
        w = shutil.which("osascript")
        if not w:
            log.debug("osascript not found; skipping desktop notification")
            return
        osa = w
    if body:
        text = f"{summary}\n{body}"
    else:
        text = summary
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", " ")
    text = _truncate(text, _MAX_BODY)
    title = _truncate(_APP_NAME, 120)
    t_esc = _applescript_escape(title)
    m_esc = _applescript_escape(text)
    script = f'display notification "{m_esc}" with title "{t_esc}"'
    if urgency == "critical":
        script += ' sound name "Basso"'
    try:
        subprocess.run(
            [osa, "-e", script],
            capture_output=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        log.debug("Desktop notification failed: %s", e)


def notify(summary: str, body: str = "", *, urgency: str = "normal") -> None:
    """Send a desktop notification when supported on this OS. Never raises."""
    if os.environ.get("ORATEUR_NO_NOTIFY", "").strip() in ("1", "true", "yes"):
        return
    summary = _truncate(summary.strip() or _APP_NAME, 200)
    body = _truncate(body.strip(), 400) if body else ""

    if sys.platform == "darwin":
        _notify_macos(summary, body, urgency=urgency)
    else:
        _notify_linux(summary, body, urgency=urgency)
