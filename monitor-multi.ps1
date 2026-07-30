# ================================================================
#  MULTI-ACCOUNT CANLI MONITOR
#  Iki GitHub hesabindaki paralel run'lari es zamanli takip eder
# ================================================================

param(
    [int]$RefreshSec = 6
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [System.Text.Encoding]::UTF8

# Secrets yukle (once .bat sonra .env)
$secretsPath = $null
$tryBat = Join-Path $PSScriptRoot "config\secrets.bat"
$tryEnv = Join-Path $PSScriptRoot "config\secrets.env"
if (Test-Path $tryBat)     { $secretsPath = $tryBat }
elseif (Test-Path $tryEnv) { $secretsPath = $tryEnv }

if (-not $secretsPath) {
    Write-Host "HATA: config\secrets.bat bulunamadi!" -ForegroundColor Red
    exit 1
}

$secrets = @{}
Get-Content $secretsPath | ForEach-Object {
    if ($_ -match '^\s*set\s+"([^=]+)=([^"]*)"') {
        $secrets[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$accounts = @()
$accounts += @{
    Name  = "Hesap 1"
    User  = $secrets['GH1_USER']
    Repo  = $secrets['GH1_REPO']
    Token = $secrets['GH1_TOKEN']
    Color = "Cyan"
}

# Hesap 2 varsa ekle
if ($secrets['GH2_WORKFLOW_ID']) {
    $accounts += @{
        Name  = "Hesap 2"
        User  = $secrets['GH2_USER']
        Repo  = $secrets['GH2_REPO']
        Token = $secrets['GH2_TOKEN']
        Color = "Magenta"
    }
}

# Hesap 3 varsa ekle
if ($secrets['GH3_WORKFLOW_ID']) {
    $accounts += @{
        Name  = "Hesap 3"
        User  = $secrets['GH3_USER']
        Repo  = $secrets['GH3_REPO']
        Token = $secrets['GH3_TOKEN']
        Color = "Yellow"
    }
}

# Hesap 4 varsa ekle
if ($secrets['GH4_WORKFLOW_ID']) {
    $accounts += @{
        Name  = "Hesap 4"
        User  = $secrets['GH4_USER']
        Repo  = $secrets['GH4_REPO']
        Token = $secrets['GH4_TOKEN']
        Color = "Green"
    }
}

function Get-LatestRun {
    param($account)
    try {
        $headers = @{
            "Authorization" = "token $($account.Token)"
            "Accept"        = "application/vnd.github+json"
        }
        $url = "https://api.github.com/repos/$($account.User)/$($account.Repo)/actions/runs?per_page=1"
        return Invoke-RestMethod -Uri $url -Headers $headers
    } catch {
        return $null
    }
}

function Get-RunJobs {
    param($account, $runId)
    try {
        $headers = @{
            "Authorization" = "token $($account.Token)"
            "Accept"        = "application/vnd.github+json"
        }
        $url = "https://api.github.com/repos/$($account.User)/$($account.Repo)/actions/runs/$runId/jobs?per_page=30"
        return Invoke-RestMethod -Uri $url -Headers $headers
    } catch {
        return $null
    }
}

function Get-Icon {
    param($status, $conclusion)
    if ($conclusion -eq "success")   { return "OK " }
    if ($conclusion -eq "failure")   { return "X  " }
    if ($conclusion -eq "cancelled") { return "!! " }
    if ($conclusion -eq "skipped")   { return "-- " }
    if ($status -eq "in_progress")   { return ">> " }
    if ($status -eq "queued")        { return ".. " }
    return "?  "
}

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host "       MEGA MULTI-ACCOUNT MONITOR - Distributed Load Test" -ForegroundColor Yellow
Write-Host "       $($accounts.Count) hesap x 20 bot = kombine gorunum" -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Baslamasi bekleniyor..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$startTime = Get-Date
$completedAccounts = @{}

while ($true) {
    try {
        Clear-Host
        Write-Host ""
        Write-Host "=========================================================================" -ForegroundColor Yellow
        Write-Host "       MEGA MULTI-ACCOUNT MONITOR" -ForegroundColor Yellow
        Write-Host "=========================================================================" -ForegroundColor Yellow

        $elapsed = (Get-Date) - $startTime
        Write-Host "  Toplam gecen: $($elapsed.ToString('mm\:ss'))" -ForegroundColor Gray
        Write-Host ""

        $grandTotal = 0
        $grandRunning = 0
        $grandCompleted = 0
        $grandSuccess = 0
        $grandFailed = 0
        $grandQueued = 0
        $allCompleted = $true

        foreach ($account in $accounts) {
            Write-Host "  ---------------------------------------------------------------------" -ForegroundColor $account.Color
            Write-Host "   $($account.Name.PadRight(10)) $($account.User.PadRight(20))" -ForegroundColor $account.Color
            Write-Host "  ---------------------------------------------------------------------" -ForegroundColor $account.Color

            $runData = Get-LatestRun -account $account
            if (-not $runData -or -not $runData.workflow_runs -or $runData.workflow_runs.Count -eq 0) {
                Write-Host "    Run bulunamadi." -ForegroundColor DarkGray
                Write-Host ""
                continue
            }

            $run = $runData.workflow_runs[0]
            $jobsData = Get-RunJobs -account $account -runId $run.id
            if (-not $jobsData -or -not $jobsData.jobs) {
                Write-Host "    Job listesi alinamadi." -ForegroundColor DarkGray
                Write-Host ""
                continue
            }

            $jobs = $jobsData.jobs | Where-Object { $_.name -like "bot-*" } | Sort-Object { [int]($_.name -replace 'bot-','') }

            $runElapsed = [TimeSpan]::Zero
            if ($run.run_started_at) {
                $runElapsed = (Get-Date) - [DateTime]$run.run_started_at
            }
            $statusText = $run.status
            if ($run.conclusion) {
                $statusText = "$($run.status) -> $($run.conclusion)"
            }
            Write-Host "    Run #$($run.id)  |  $statusText  |  $($runElapsed.ToString('mm\:ss'))" -ForegroundColor $account.Color

            $total = $jobs.Count
            $running = 0
            $completed = 0
            $success = 0
            $failed = 0
            $queued = 0

            foreach ($j in $jobs) {
                if ($j.status -eq "in_progress") { $running++ }
                elseif ($j.status -eq "queued")  { $queued++ }
                elseif ($j.status -eq "completed") {
                    $completed++
                    if ($j.conclusion -eq "success") { $success++ }
                    elseif ($j.conclusion -eq "failure") { $failed++ }
                }
            }

            # Bot grid
            $line = "    "
            $count = 0
            foreach ($j in $jobs) {
                $icon = Get-Icon -status $j.status -conclusion $j.conclusion
                $line += $icon
                $count++
                if ($count % 10 -eq 0) {
                    Write-Host $line -ForegroundColor $account.Color
                    $line = "    "
                }
            }
            if ($line -ne "    ") { Write-Host $line -ForegroundColor $account.Color }

            Write-Host "    Toplam: $total  |  Calisan: $running  |  Basarili: $success  |  Basarisiz: $failed  |  Kuyruk: $queued" -ForegroundColor Gray
            Write-Host ""

            $grandTotal += $total
            $grandRunning += $running
            $grandCompleted += $completed
            $grandSuccess += $success
            $grandFailed += $failed
            $grandQueued += $queued

            if ($run.status -ne "completed") {
                $allCompleted = $false
            } else {
                $completedAccounts[$account.Name] = $true
            }
        }

        # Grand total
        Write-Host "=========================================================================" -ForegroundColor Green
        Write-Host "  GRAND TOTAL" -ForegroundColor Green
        Write-Host "=========================================================================" -ForegroundColor Green
        Write-Host "  Toplam bot    : $grandTotal" -ForegroundColor White
        Write-Host "  Calisan       : $grandRunning" -ForegroundColor Green
        Write-Host "  Basarili      : $grandSuccess" -ForegroundColor Cyan
        Write-Host "  Basarisiz     : $grandFailed" -ForegroundColor Red
        Write-Host "  Kuyrukta      : $grandQueued" -ForegroundColor Yellow

        if ($grandTotal -gt 0) {
            $pct = [Math]::Floor(($grandCompleted / $grandTotal) * 100)
            $barW = 50
            $filled = [Math]::Floor($pct * $barW / 100)
            $bar = ("#" * $filled) + ("." * ($barW - $filled))
            Write-Host ""
            Write-Host "  [$bar] $pct%" -ForegroundColor Green
        }

        Write-Host ""

        if ($allCompleted -and $accounts.Count -eq $completedAccounts.Count) {
            Write-Host "  *** TUM HESAPLARDA TESTLER TAMAMLANDI! ***" -ForegroundColor Green
            Write-Host ""
            foreach ($account in $accounts) {
                Write-Host "  $($account.Name) sonuclari:" -ForegroundColor $account.Color
                Write-Host "     https://github.com/$($account.User)/$($account.Repo)/actions" -ForegroundColor DarkGray
            }
            Write-Host ""
            break
        }

        Write-Host "  Sonraki guncelleme: $RefreshSec sn  |  Cikis: Ctrl+C" -ForegroundColor DarkGray
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