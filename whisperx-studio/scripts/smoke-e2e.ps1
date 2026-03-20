param(
    [string]$ReportDir = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $projectRoot "runs\smoke"
}

New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $ReportDir "smoke-release-$stamp.md"

$steps = New-Object System.Collections.Generic.List[object]
$status = "success"
$errorMessage = ""
$msiArtifact = $null
$exeArtifact = $null
$msiHash = ""
$exeHash = ""

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Name"
    $startedAt = Get-Date
    try {
        $global:LASTEXITCODE = 0
        & $Action
        if (-not $?) {
            throw "Command failed."
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Command exited with code $LASTEXITCODE."
        }
        $steps.Add([pscustomobject]@{
                Name        = $Name
                Status      = "ok"
                DurationSec = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
                Error       = ""
            })
    }
    catch {
        $steps.Add([pscustomobject]@{
                Name        = $Name
                Status      = "failed"
                DurationSec = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
                Error       = $_.Exception.Message
            })
        throw
    }
}

Push-Location $projectRoot
try {
    Invoke-Step -Name "npm run build" -Action { npm run build }
    Invoke-Step -Name "cargo check --manifest-path .\\src-tauri\\Cargo.toml" -Action {
        cargo check --manifest-path .\src-tauri\Cargo.toml
    }
    Invoke-Step -Name "cargo test smoke_mock_edit_export_flow" -Action {
        cargo test --manifest-path .\src-tauri\Cargo.toml smoke_mock_edit_export_flow -- --nocapture
    }
    Invoke-Step -Name "npm run tauri build" -Action { npm run tauri build }

    $bundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
    $msiDir = Join-Path $bundleRoot "msi"
    $nsisDir = Join-Path $bundleRoot "nsis"

    $msiArtifact = Get-ChildItem -Path $msiDir -Filter *.msi -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
    if ($null -eq $msiArtifact) {
        throw "MSI artifact not found in $msiDir"
    }

    $exeArtifact = Get-ChildItem -Path $nsisDir -Filter *setup.exe -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
    if ($null -eq $exeArtifact) {
        $exeArtifact = Get-ChildItem -Path $nsisDir -Filter *.exe -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    }
    if ($null -eq $exeArtifact) {
        throw "NSIS EXE artifact not found in $nsisDir"
    }

    $msiHash = (Get-FileHash -Algorithm SHA256 -Path $msiArtifact.FullName).Hash
    $exeHash = (Get-FileHash -Algorithm SHA256 -Path $exeArtifact.FullName).Hash
}
catch {
    $status = "failed"
    $errorMessage = $_.Exception.Message
}
finally {
    Pop-Location

    $reportLines = @()
    $reportLines += "# Smoke Release Report v1"
    $reportLines += ""
    $reportLines += "- GeneratedAt: $(Get-Date -Format o)"
    $reportLines += "- ProjectRoot: $projectRoot"
    $reportLines += "- Status: $status"
    $reportLines += ""
    $reportLines += "## Steps"
    foreach ($step in $steps) {
        if ($step.Status -eq "ok") {
            $reportLines += "- [x] $($step.Name) ($($step.DurationSec)s)"
        }
        else {
            $reportLines += "- [ ] $($step.Name) ($($step.DurationSec)s) - $($step.Error)"
        }
    }

    $reportLines += ""
    $reportLines += "## Artifacts"
    if ($null -ne $msiArtifact) {
        $reportLines += "- MSI: $($msiArtifact.FullName)"
        $reportLines += "- MSI SHA256: $msiHash"
    }
    else {
        $reportLines += "- MSI: not found"
    }
    if ($null -ne $exeArtifact) {
        $reportLines += "- EXE: $($exeArtifact.FullName)"
        $reportLines += "- EXE SHA256: $exeHash"
    }
    else {
        $reportLines += "- EXE: not found"
    }

    if (-not [string]::IsNullOrWhiteSpace($errorMessage)) {
        $reportLines += ""
        $reportLines += "## Error"
        $reportLines += "- $errorMessage"
    }

    Set-Content -Path $reportPath -Value ($reportLines -join "`n") -Encoding UTF8
    Write-Host ""
    Write-Host "Smoke report: $reportPath"
}

if ($status -ne "success") {
    throw "Smoke release failed. See report: $reportPath"
}
