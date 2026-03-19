"""Best-effort desktop notifications (notify-send / FreeDesktop)."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess

log = logging.getLogger(__name__)

_APP_NAME = "Orateur"


def notify(summary: str, body: str = "", *, urgency: str = "normal") -> None:
    """Send a desktop notification if notify-send is available. Never raises."""
    if os.environ.get("ORATEUR_NO_NOTIFY", "").strip() in ("1", "true", "yes"):
        return
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
