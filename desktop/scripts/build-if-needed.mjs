#!/usr/bin/env node
/**
 * CI sets SKIP_FRONTEND_BUILD=1 and uploads dist/; we only copy install resources.
 * Locally: full `npm run build` when dist/ is missing or empty.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const distDir = path.join(desktopRoot, "dist");

function runCopy() {
  execSync("npm run copy-install-resources", { cwd: desktopRoot, stdio: "inherit" });
}

function runFullBuild() {
  execSync("npm run build", { cwd: desktopRoot, stdio: "inherit" });
  runCopy();
}

if (process.env.SKIP_FRONTEND_BUILD) {
  console.log("Skipping frontend build (SKIP_FRONTEND_BUILD)");
  runCopy();
  process.exit(0);
}

if (fs.existsSync(distDir)) {
  const entries = fs.readdirSync(distDir);
  if (entries.length > 0) {
    console.log("Using cached frontend build");
    runCopy();
    process.exit(0);
  }
}

runFullBuild();
