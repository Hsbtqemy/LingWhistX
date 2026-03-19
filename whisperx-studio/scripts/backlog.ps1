param(
    [ValidateSet("ready", "list", "next", "show", "set")]
    [string]$Action = "ready",
    [string]$Id = "",
    [ValidateSet("todo", "in_progress", "blocked", "done")]
    [string]$Status = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backlogPath = Join-Path $projectRoot "backlog\backlog.json"

if (-not (Test-Path $backlogPath)) {
    throw "Backlog file not found: $backlogPath"
}

$doc = Get-Content $backlogPath -Raw | ConvertFrom-Json
$tasks = @($doc.tasks)

function Get-PriorityRank {
    param([string]$Priority)
    switch ($Priority) {
        "P0" { return 0 }
        "P1" { return 1 }
        "P2" { return 2 }
        default { return 9 }
    }
}

function Get-TaskById {
    param([string]$TaskId)
    $task = $tasks | Where-Object { $_.id -eq $TaskId } | Select-Object -First 1
    return $task
}

function Is-TaskReady {
    param($Task)

    if ($Task.status -ne "todo") {
        return $false
    }

    foreach ($depId in @($Task.dependsOn)) {
        $depTask = Get-TaskById -TaskId $depId
        if ($null -eq $depTask) {
            return $false
        }
        if ($depTask.status -ne "done") {
            return $false
        }
    }

    return $true
}

function Sort-Tasks {
    param($InputTasks)

    return @($InputTasks | Sort-Object `
        @{ Expression = { Get-PriorityRank $_.priority } }, `
        @{ Expression = { $_.id } })
}

function Write-TaskTable {
    param($InputTasks)

    if ($null -eq $InputTasks -or @($InputTasks).Count -eq 0) {
        Write-Host "No tasks."
        return
    }

    $rows = foreach ($task in (Sort-Tasks -InputTasks $InputTasks)) {
        [PSCustomObject]@{
            Id       = $task.id
            Priority = $task.priority
            Status   = $task.status
            Ready    = (Is-TaskReady -Task $task)
            Depends  = (@($task.dependsOn) -join ",")
            Title    = $task.title
        }
    }

    $rows | Format-Table -AutoSize
}

function Show-TaskDetails {
    param($Task)
    Write-Host "Id: $($Task.id)"
    Write-Host "Title: $($Task.title)"
    Write-Host "Status: $($Task.status)"
    Write-Host "Priority: $($Task.priority)"
    Write-Host "Estimate: $($Task.estimate)"
    Write-Host "DependsOn: $(@($Task.dependsOn) -join ", ")"
    Write-Host "Scope:"
    foreach ($line in @($Task.scope)) {
        Write-Host "  - $line"
    }
    Write-Host "Execute:"
    foreach ($line in @($Task.execute)) {
        Write-Host "  - $line"
    }
    Write-Host "DefinitionOfDone:"
    foreach ($line in @($Task.definitionOfDone)) {
        Write-Host "  - $line"
    }
    Write-Host "Acceptance:"
    foreach ($line in @($Task.acceptance)) {
        Write-Host "  - $line"
    }
}

switch ($Action) {
    "list" {
        Write-TaskTable -InputTasks $tasks
        exit 0
    }
    "ready" {
        $readyTasks = @($tasks | Where-Object { Is-TaskReady -Task $_ })
        Write-TaskTable -InputTasks $readyTasks
        exit 0
    }
    "next" {
        $readyTasks = Sort-Tasks -InputTasks @($tasks | Where-Object { Is-TaskReady -Task $_ })
        if ($readyTasks.Count -eq 0) {
            Write-Host "No ready task."
            exit 0
        }
        $next = $readyTasks[0]
        Show-TaskDetails -Task $next
        exit 0
    }
    "show" {
        if ([string]::IsNullOrWhiteSpace($Id)) {
            throw "Use -Id <task-id> with -Action show."
        }
        $task = Get-TaskById -TaskId $Id
        if ($null -eq $task) {
            throw "Task not found: $Id"
        }
        Show-TaskDetails -Task $task
        exit 0
    }
    "set" {
        if ([string]::IsNullOrWhiteSpace($Id)) {
            throw "Use -Id <task-id> with -Action set."
        }
        if ([string]::IsNullOrWhiteSpace($Status)) {
            throw "Use -Status <todo|in_progress|blocked|done> with -Action set."
        }

        $task = Get-TaskById -TaskId $Id
        if ($null -eq $task) {
            throw "Task not found: $Id"
        }

        $task.status = $Status
        $doc.updatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
        $doc | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $backlogPath

        Write-Host "Updated $Id => $Status"
        exit 0
    }
}
