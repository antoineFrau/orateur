import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const destDir = join(root, "desktop", "src-tauri", "resources");
mkdirSync(destDir, { recursive: true });
copyFileSync(join(root, "scripts", "install.sh"), join(destDir, "install.sh"));
copyFileSync(join(root, "bin", "orateur"), join(destDir, "orateur-launcher"));
