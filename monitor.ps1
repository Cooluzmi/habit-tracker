# ================================================================
#  CANLI SALDIRI MONITOR (tek hesap)
#  GitHub Actions workflow'unu canli takip eder
#
#  Multi-account monitor icin: monitor-multi.ps1
# ================================================================

param(
    [string]$Token = "",
    [string]$Owner = "",
    [string]$Repo = "",
    [int]$RefreshSec = 5
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [System.Text.Encoding]::UTF8

# Secrets fallback (once .bat sonra .env)
if (-not $Token -or -not $Owner -or -not $Repo) {
    $secretsPath = $null
    $tryBat = Join-Path $PSScriptRoot "config\secrets.bat"
    $tryEnv = Join-Path $PSScriptRoot "config\secrets.env"
    if (Test-Path $tryBat)     { $secretsPath = $tryBat }
    elseif (Test-Path $tryEnv) { $secretsPath = $tryEnv }

    if ($secretsPath) {
        $secrets = @{}
        Get-Content $secretsPath | ForEach-Object {
            if ($_ -match '^\s*set\s+"([^=]+)=([^"]*)"') {
                $secrets[$matches[1].Trim()] = $matches[2].Trim()
            }
        }
        if (-not $Token) { $Token = $secrets['GH1_TOKEN'] }
        if (-not $Owner) { $Owner = $secrets['GH1_USER'] }
        if (-not $Repo)  { $Repo  = $secrets['GH1_REPO'] }
    }
}

if (-not $Token -or -not $Owner -or -not $Repo) {
    Write-Host "HATA: Token/Owner/Repo eksik. config\secrets.bat kontrol et." -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "token $Token"
    "Accept"        = "application/vnd.github+json"
}

function Get-LatestRun {
    $url = "https://api.github.com/repos/$Owner/$Repo/actions/runs?per_page=1"
    return Invoke-RestMethod -Uri $url -Headers $headers
}

function Get-RunJobs {
    param($runId)
    $url = "https://api.github.com/repos/$Owner/$Repo/actions/runs/$runId/jobs?per_page=30"
    return Invoke-RestMethod -Uri $url -Headers $headers
}

function Draw-Bar {
    param([int]$percent, [int]$width = 30)
    $filled = [Math]::Floor($percent * $width / 100)
    if ($filled -gt $width) { $filled = $width }
    if ($filled -lt 0) { $filled = 0 }
    $bar = ("#" * $filled) + ("." * ($width - $filled))
    return $bar
}

function Get-JobStatusIcon {
    param($status, $conclusion)
    if ($conclusion -eq "success")   { return "OK" }
    if ($conclusion -eq "failure")   { return "XX" }
    if ($conclusion -eq "cancelled") { return "!!" }
    if ($conclusion -eq "skipped")   { return "--" }
    if ($status -eq "in_progress")   { return ">>" }
    if ($status -eq "queued")        { return ".." }
    return "??"
}

# Ana monitor loop
Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "          CANLI SALDIRI MONITOR - GitHub Actions Botnet" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Yukleniyor..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

$startTime = Get-Date

while ($true) {
    try {
        $runData = Get-LatestRun
        $run = $runData.workflow_runs[0]

        if (-not $run) {
            Write-Host "Aktif run bulunamadi." -ForegroundColor Red
            Start-Sleep -Seconds 5
            continue
        }

        $jobsData = Get-RunJobs -runId $run.id
        $jobs = $jobsData.jobs | Where-Object { $_.name -like "bot-*" } | Sort-Object { [int]($_.name -replace 'bot-','') }

        Clear-Host

        # Header
        Write-Host ""
        Write-Host "========================================================================" -ForegroundColor Cyan
        Write-Host "          CANLI SALDIRI MONITOR" -ForegroundColor Cyan
        Write-Host "========================================================================" -ForegroundColor Cyan

        # Genel bilgi
        $elapsed = (Get-Date) - $startTime
        $runElapsed = [TimeSpan]::Zero
        if ($run.run_started_at) {
            $runElapsed = (Get-Date) - [DateTime]$run.run_started_at
        }

        Write-Host ""
        Write-Host "  Run ID    : " -NoNewline
        Write-Host "$($run.id)" -ForegroundColor Yellow
        Write-Host "  Durum     : " -NoNewline
        $statusColor = switch($run.status) { "in_progress" {"Green"} "queued" {"Yellow"} "completed" {"Cyan"} default {"Gray"} }
        Write-Host "$($run.status)" -ForegroundColor $statusColor -NoNewline
        if ($run.conclusion) {
            Write-Host " -> $($run.conclusion)" -ForegroundColor Magenta
        } else {
            Write-Host ""
        }
        Write-Host "  Sure      : $($runElapsed.ToString('mm\:ss'))" -ForegroundColor White
        Write-Host "  Link      : https://github.com/$Owner/$Repo/actions/runs/$($run.id)" -ForegroundColor DarkGray

        Write-Host ""
        Write-Host "  ---------------------------------------------------------------------" -ForegroundColor DarkCyan
        Write-Host "   BOT   | DURUM          | ADIM                            | GECEN" -ForegroundColor White
        Write-Host "  ---------------------------------------------------------------------" -ForegroundColor DarkCyan

        $totalJobs = $jobs.Count
        $completedJobs = 0
        $inProgressJobs = 0
        $queuedJobs = 0
        $failedJobs = 0
        $successJobs = 0

        foreach ($j in $jobs) {
            $botName = $j.name
            $status = $j.status
            $conclusion = $j.conclusion
            $icon = Get-JobStatusIcon -status $status -conclusion $conclusion

            # Suanki adim
            $currentStep = "-"
            if ($j.steps) {
                $active = $j.steps | Where-Object { $_.status -eq "in_progress" } | Select-Object -First 1
                if ($active) {
                    $currentStep = $active.name
                } else {
                    $lastCompleted = $j.steps | Where-Object { $_.status -eq "completed" } | Select-Object -Last 1
                    if ($lastCompleted) { $currentStep = $lastCompleted.name }
                }
            }

            # Sayac
            if ($status -eq "completed") {
                $completedJobs++
                if ($conclusion -eq "success") { $successJobs++ }
                elseif ($conclusion -eq "failure") { $failedJobs++ }
            } elseif ($status -eq "in_progress") {
                $inProgressJobs++
            } elseif ($status -eq "queued") {
                $queuedJobs++
            }

            # Gecen sure
            $jobElapsed = "-"
            if ($j.started_at) {
                $endTime = if ($j.completed_at) { [DateTime]$j.completed_at } else { Get-Date }
                $span = $endTime - [DateTime]$j.started_at
                $jobElapsed = "{0:mm\:ss}" -f $span
            }

            # Renk
            $rowColor = switch($status) {
                "in_progress" { "Green" }
                "queued"      { "Yellow" }
                "completed"   { if ($conclusion -eq "success") { "Cyan" } else { "Red" } }
                default       { "Gray" }
            }

            $stepDisplay = if ($currentStep.Length -gt 30) { $currentStep.Substring(0,30) } else { $currentStep.PadRight(30) }
            $botDisplay = $botName.PadRight(6)
            $statusDisplay = ($status).PadRight(14)

            Write-Host ("   " + $botDisplay + " | $icon " + $statusDisplay + " | " + $stepDisplay + " | " + $jobElapsed.PadRight(9)) -ForegroundColor $rowColor
        }

        Write-Host "  ---------------------------------------------------------------------" -ForegroundColor DarkCyan

        # Progress bar
        $overallPercent = if ($totalJobs -gt 0) { [Math]::Floor(($completedJobs / $totalJobs) * 100) } else { 0 }
        $bar = Draw-Bar -percent $overallPercent -width 50
        Write-Host ""
        Write-Host "  Ilerleme  : [" -NoNewline
        Write-Host $bar -NoNewline -ForegroundColor Green
        Write-Host "] $overallPercent% ($completedJobs/$totalJobs)"

        # Ozet
        Write-Host ""
        Write-Host "  ---------- Ozet ----------" -ForegroundColor DarkCyan
        Write-Host "   Calisan    : $inProgressJobs" -ForegroundColor Green
        Write-Host "   Kuyrukta   : $queuedJobs" -ForegroundColor Yellow
        Write-Host "   Basarili   : $successJobs" -ForegroundColor Cyan
        Write-Host "   Basarisiz  : $failedJobs" -ForegroundColor Red
        Write-Host "  --------------------------" -ForegroundColor DarkCyan

        Write-Host ""
        if ($run.status -eq "completed") {
            Write-Host "  *** TEST TAMAMLANDI ***" -ForegroundColor Green
            Write-Host "  Toplu Rapor icin:" -ForegroundColor White
            Write-Host "     https://github.com/$Owner/$Repo/actions/runs/$($run.id)" -ForegroundColor DarkGray
            Write-Host ""
            Write-Host "  'Toplu Rapor' job'una tikla -> toplam RPS + Gbps orada." -ForegroundColor Cyan
            Write-Host ""
            break
        }

        Write-Host "  Sonraki guncelleme: $RefreshSec saniye | Durdurmak icin Ctrl+C" -ForegroundColor DarkGray
        Write-Host ""

        Start-Sleep -Seconds $RefreshSec
    }
    catch {
        Write-Host "Hata: $_" -ForegroundColor Red
        Start-Sleep -Seconds 5
    }
}

Write-Host ""
Write-Host "Monitor kapatiliyor. Cikmak icin bir tusa basin..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")