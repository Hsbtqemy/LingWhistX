param(
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
if (-not (Test-Path $tauriConfigPath)) {
    throw "Missing tauri config: $tauriConfigPath"
}

$tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
$productName = $tauriConfig.productName
$version = $tauriConfig.version

if ([string]::IsNullOrWhiteSpace($productName)) {
    $productName = "whisperx-studio"
}
if ([string]::IsNullOrWhiteSpace($version)) {
    $version = "0.0.0"
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $projectRoot "src-tauri\target\release\portable"
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Push-Location $projectRoot
try {
    $runningProcesses = Get-Process -Name $productName -ErrorAction SilentlyContinue
    if ($null -ne $runningProcesses) {
        Write-Host "==> Stop running process: $productName"
        $runningProcesses | Stop-Process -Force
        Start-Sleep -Milliseconds 500
    }

    Write-Host "==> Build Tauri release binary (no installer bundle)"
    npm run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "tauri build --no-bundle failed with code $LASTEXITCODE"
    }

    $exeSource = Join-Path $projectRoot "src-tauri\target\release\$productName.exe"
    if (-not (Test-Path $exeSource)) {
        $fallbackExe = Get-ChildItem -Path (Join-Path $projectRoot "src-tauri\target\release") -Filter *.exe -File |
        Where-Object { $_.Name -notlike "*.pdb" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
        if ($null -eq $fallbackExe) {
            throw "Unable to locate built executable in src-tauri\\target\\release"
        }
        $exeSource = $fallbackExe.FullName
    }

    $portableName = "$productName" + "_" + "$version" + "_portable.exe"
    $portablePath = Join-Path $OutDir $portableName
    Copy-Item -Path $exeSource -Destination $portablePath -Force

    $hash = (Get-FileHash -Algorithm SHA256 -Path $portablePath).Hash
    $hashFile = "$portablePath.sha256"
    Set-Content -Path $hashFile -Value "$hash  $portableName" -Encoding ASCII

    Write-Host ""
    Write-Host "Portable EXE generated:"
    Write-Host "  $portablePath"
    Write-Host "SHA256:"
    Write-Host "  $hash"
    Write-Host ""
    Write-Host "Note: WebView2 runtime is still required on the target machine."
}
finally {
    Pop-Location
}
