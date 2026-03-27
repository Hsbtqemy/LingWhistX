#!/usr/bin/env node
/**
 * Installation du runtime Python + WhisperX (macOS / Linux / Windows).
 * Répertoire aligné sur `app.path().app_local_data_dir()` / `python-runtime` (voir `python_runtime.rs`).
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/** Racine du dépôt (…/LingWhistX) : scripts/ → whisperx-studio/ → repo. */
function monorepoWhisperxRoot() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return join(scriptDir, "..", "..");
}

function shouldInstallForkFromRepo() {
  if (process.env.WHISPERX_STUDIO_PIP_WHISPERX?.trim() === "pypi") {
    return false;
  }
  const root = monorepoWhisperxRoot();
  return (
    existsSync(join(root, "pyproject.toml")) && existsSync(join(root, "whisperx", "__init__.py"))
  );
}

const BUNDLE_ID = process.env.WHISPERX_STUDIO_BUNDLE_ID ?? "com.hsemil01.whisperx-studio";

function defaultRuntimeDir() {
  if (process.env.RUNTIME_DIR?.trim()) {
    return process.env.RUNTIME_DIR.trim();
  }
  const platform = process.platform;
  if (platform === "win32") {
    const base = join(process.env.LOCALAPPDATA ?? "", BUNDLE_ID);
    return join(base, "python-runtime");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", BUNDLE_ID, "python-runtime");
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdg, BUNDLE_ID, "python-runtime");
}

function venvPythonExecutable(runtimeDir) {
  if (process.platform === "win32") {
    return join(runtimeDir, "Scripts", "python.exe");
  }
  const py3 = join(runtimeDir, "bin", "python3");
  const py = join(runtimeDir, "bin", "python");
  if (existsSync(py3)) return py3;
  if (existsSync(py)) return py;
  return py3;
}

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { stdio: "inherit", ...opts });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const pythonExe =
  process.env.PYTHON_EXE?.trim() || (process.platform === "win32" ? "python" : "python3");
const runtimeDir = defaultRuntimeDir();

console.log("[1/4] Runtime directory:", runtimeDir);
mkdirSync(runtimeDir, { recursive: true });

const venvPy = venvPythonExecutable(runtimeDir);

if (!existsSync(venvPy)) {
  console.log(`[2/4] Creating virtual environment with ${pythonExe}...`);
  run(pythonExe, ["-m", "venv", runtimeDir]);
} else {
  console.log("[2/4] Virtual environment already exists.");
}

console.log("[3/4] Upgrading pip/setuptools/wheel...");
run(venvPy, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]);

if (shouldInstallForkFromRepo()) {
  const root = monorepoWhisperxRoot();
  console.log("[4/4] Installing WhisperX (fork LingWhistX, editable depuis le dépôt)...");
  console.log("    ", root);
  run(venvPy, ["-m", "pip", "install", "--upgrade", "-e", root]);
} else {
  console.log("[4/4] Installing WhisperX from PyPI...");
  console.warn(
    "    Attention: le worker Studio envoie des options CLI (--analysis_*, etc.) absentes du paquet PyPI.",
  );
  console.warn(
    "    Clone le dépôt LingWhistX et relance ce script depuis whisperx-studio/ pour installer le fork.",
  );
  run(venvPy, ["-m", "pip", "install", "--upgrade", "whisperx"]);
}

console.log("");
console.log("Runtime installed successfully.");
console.log("Python executable used by WhisperX Studio:");
console.log(" ", venvPy);
console.log("");

const which = process.platform === "win32" ? "where" : "which";
const ff = spawnSync(which, ["ffmpeg"], { encoding: "utf8" });
if (ff.status !== 0) {
  console.warn(
    "ffmpeg introuvable dans le PATH. Il n'est pas installe par ce script. " +
      "macOS (Homebrew): brew install ffmpeg — puis relance le terminal ou l'app.",
  );
} else {
  console.log("ffmpeg detected:", ff.stdout.trim().split("\n")[0]);
}

console.log("");
console.log("Optional override (session or shell profile):");
if (process.platform === "win32") {
  console.log(`  set WHISPERX_STUDIO_PYTHON=${venvPy}`);
} else {
  console.log(`  export WHISPERX_STUDIO_PYTHON="${venvPy}"`);
}
