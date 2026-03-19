"""Optional Quickshell child process for orateur run."""

import logging
import shutil
import subprocess
import time
from typing import Optional

log = logging.getLogger(__name__)


def _quickshell_argv() -> Optional[list[str]]:
    for name in ("quickshell", "qs"):
        exe = shutil.which(name)
        if exe:
            return [exe, "-c", "orateur"]
    return None


def start_quickshell() -> Optional[subprocess.Popen]:
    """Spawn quickshell -c orateur detached from our stdin; returns None if not found."""
    argv = _quickshell_argv()
    if not argv:
        log.warning("quickshell not found in PATH; install Quickshell or extend PATH")
        return None
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=None,
            start_new_session=True,
        )
    except OSError as e:
        log.warning("Failed to start Quickshell: %s", e)
        return None
    time.sleep(0.15)
    if proc.poll() is not None:
        log.warning("Quickshell exited immediately (code %s)", proc.returncode)
        return None
    log.info("Started Quickshell (pid %s)", proc.pid)
    return proc


def stop_quickshell(proc: Optional[subprocess.Popen], *, timeout: float = 4.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
    except OSError:
        return
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except OSError:
            pass
