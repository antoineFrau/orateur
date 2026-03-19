"""Install Quickshell Orateur component when Quickshell is detected."""

import logging
import os
import shutil
from pathlib import Path

from .paths import XDG_CONFIG_HOME

log = logging.getLogger(__name__)

QUICKSHELL_CONFIG_DIR = XDG_CONFIG_HOME / "quickshell"
ORATEUR_QUICKSHELL_DEST = QUICKSHELL_CONFIG_DIR / "orateur"
# Written here (not inside the symlinked component dir) so dev symlinks don't put machine paths in the repo.
ORATEUR_BIN_PATH_FILE = QUICKSHELL_CONFIG_DIR / "orateur_bin_path"


def _detect_quickshell() -> bool:
    """Return True if Quickshell appears to be installed."""
    if shutil.which("quickshell") or shutil.which("qs"):
        return True
    if QUICKSHELL_CONFIG_DIR.exists():
        return True
    return False


def _resolve_orateur_bin(project_root: Path) -> str:
    """Path to the orateur launcher for Quickshell (absolute if known)."""
    bundled = project_root / "bin" / "orateur"
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled.resolve())
    found = shutil.which("orateur")
    return found if found else "orateur"


def _write_orateur_bin_path(project_root: Path) -> None:
    try:
        QUICKSHELL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        ORATEUR_BIN_PATH_FILE.write_text(
            _resolve_orateur_bin(project_root) + "\n",
            encoding="utf-8",
        )
    except OSError as e:
        log.warning("Could not write %s: %s", ORATEUR_BIN_PATH_FILE, e)


def _project_root() -> Path:
    """Project root (directory containing pyproject.toml)."""
    root = os.environ.get("ORATEUR_ROOT")
    if root:
        return Path(root)
    p = Path(__file__).resolve().parent
    for _ in range(5):
        if (p / "pyproject.toml").exists():
            return p
        p = p.parent
    return Path(__file__).resolve().parent.parent.parent


def install_quickshell() -> bool:
    """
    Install Orateur Quickshell component to ~/.config/quickshell/orateur/.

    Detects Quickshell; if present, copies or symlinks quickshell/orateur/
    from the repo to the config directory. Prefers symlink when ORATEUR_ROOT
    is set (development/editable install).
    """
    if not _detect_quickshell():
        log.debug("Quickshell not detected, skipping Quickshell install")
        return False

    project_root = _project_root()
    src = project_root / "quickshell" / "orateur"
    if not src.exists():
        log.warning("Quickshell source not found: %s", src)
        return False

    dest = ORATEUR_QUICKSHELL_DEST
    dest.parent.mkdir(parents=True, exist_ok=True)

    use_symlink = bool(os.environ.get("ORATEUR_ROOT"))

    if dest.exists():
        if dest.is_symlink():
            if dest.resolve() == src.resolve():
                log.info("Quickshell Orateur already installed (symlink)")
                _write_orateur_bin_path(project_root)
                return True
            dest.unlink()
        else:
            shutil.rmtree(dest)

    try:
        if use_symlink:
            dest.symlink_to(src.resolve())
            log.info("Quickshell Orateur installed (symlink) → %s", dest)
        else:
            shutil.copytree(src, dest)
            log.info("Quickshell Orateur installed (copy) → %s", dest)
        _write_orateur_bin_path(project_root)
        return True
    except OSError as e:
        log.warning("Failed to install Quickshell component: %s", e)
        return False
