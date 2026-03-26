param(
    [string]$PythonExe = "python",
    [string]$RuntimeDir = ""
)

$ErrorActionPreference = "Stop"

# Aligné sur `app.path().app_local_data_dir()` (Tauri) — même identifiant que `tauri.conf.json`.
$bundleId = "com.hsemil01.whisperx-studio"
if ([string]::IsNullOrWhiteSpace($RuntimeDir)) {
    $baseDir = Join-Path $env:LOCALAPPDATA $bundleId
    $RuntimeDir = Join-Path $baseDir "python-runtime"
}

$venvPython = Join-Path (Join-Path $RuntimeDir "Scripts") "python.exe"

Write-Host "[1/4] Runtime directory: $RuntimeDir"
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

if (-not (Test-Path $venvPython)) {
    Write-Host "[2/4] Creating virtual environment with $PythonExe..."
    & $PythonExe -m venv $RuntimeDir
    if ($LASTEXITCODE -ne 0) {
        throw "Virtual environment creation failed."
    }
}
else {
    Write-Host "[2/4] Virtual environment already exists."
}

Write-Host "[3/4] Upgrading pip/setuptools/wheel..."
& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) {
    throw "pip upgrade failed."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$pyproject = Join-Path $repoRoot "pyproject.toml"
$whisperxInit = Join-Path $repoRoot "whisperx\__init__.py"
$usePypiOnly = $env:WHISPERX_STUDIO_PIP_WHISPERX -eq "pypi"

if (-not $usePypiOnly -and (Test-Path $pyproject) -and (Test-Path $whisperxInit)) {
    Write-Host "[4/4] Installing WhisperX (LingWhistX fork, editable from repo)..."
    Write-Host "     $repoRoot"
    & $venvPython -m pip install --upgrade -e $repoRoot
}
else {
    Write-Host "[4/4] Installing WhisperX from PyPI..."
    Write-Warning "The Studio worker passes CLI flags (--analysis_*, etc.) that are not in the PyPI package. Clone the LingWhistX repo and re-run this script from whisperx-studio/ to install the fork."
    & $venvPython -m pip install --upgrade whisperx
}
if ($LASTEXITCODE -ne 0) {
    throw "whisperx installation failed."
}

Write-Host ""
Write-Host "Runtime installed successfully."
Write-Host "Python executable used by WhisperX Studio:"
Write-Host "  $venvPython"

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($null -eq $ffmpegCommand) {
    Write-Warning "ffmpeg not found in PATH. Install ffmpeg to run real WhisperX jobs."
}
else {
    Write-Host "ffmpeg detected: $($ffmpegCommand.Source)"
}

Write-Host ""
Write-Host "Optional override:"
Write-Host "  setx WHISPERX_STUDIO_PYTHON `"$venvPython`""
