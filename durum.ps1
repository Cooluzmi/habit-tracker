# ================================================================
#  ANLIK DURUM RAPORLAYICI
#  - Hedef site sagligi (5 test / 2sn timeout)
#  - Her iki hesabin bot durumu (aktif/tamam/kuyruk)
#  - En son log satirlarindan RPS/2xx/5xx snapshot
#
#  Kullanim:
#    durum.bat        (yerel PC'den)
#    powershell -ExecutionPolicy Bypass -File durum.ps1
# ================================================================

$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

# Secrets yukle
$secretsPath = Join-Path $PSScriptRoot "config\secrets.bat"
if (-not (Test-Path $secretsPath)) {
    Write-Host "HATA: config\secrets.bat yok!" -ForegroundColor Red
    exit 1
}
$secrets = @{}
Get-Content $secretsPath | ForEach-Object {
    if ($_ -match '^\s*set\s+"([^=]+)=([^"]*)"') {
        $secrets[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$accounts = @(
    @{name='Forest'; user=$secrets['GH1_USER']; token=$secrets['GH1_TOKEN']}
)
if ($secrets['GH2_WORKFLOW_ID']) {
    $accounts += @{name='Stranic'; user=$secrets['GH2_USER']; token=$secrets['GH2_TOKEN']}
}

# ---- 1. Son run'lari cek ----
$runs = @()
foreach ($acc in $accounts) {
    $h = @{Authorization = "token $($acc.token)"; Accept = "application/vnd.github+json"}
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$($acc.user)/loadtest/actions/runs?per_page=1" -Headers $h -TimeoutSec 8
        $run = $r.workflow_runs[0]
        $runs += @{acc=$acc; h=$h; run=$run}
    } catch {
        Write-Host "$($acc.name): API erisim hatasi" -ForegroundColor Red
    }
}

# ---- 2. Hedefi tespit et (son run'in target_url input'u) ----
$target = ''
if ($runs.Count -gt 0) {
    try {
        $r0 = $runs[0]
        $runDetail = Invoke-RestMethod -Uri "https://api.github.com/repos/$($r0.acc.user)/loadtest/actions/runs/$($r0.run.id)" -Headers $r0.h -TimeoutSec 5
        # k6 log'undan hedefi cikar
        $jobs = (Invoke-RestMethod -Uri "https://api.github.com/repos/$($r0.acc.user)/loadtest/actions/runs/$($r0.run.id)/jobs?per_page=1" -Headers $r0.h -TimeoutSec 5).jobs
        if ($jobs.Count -gt 0) {
            try {
                $logResp = Invoke-WebRequest -Uri "https://api.github.com/repos/$($r0.acc.user)/loadtest/actions/jobs/$($jobs[0].id)/logs" -Headers $r0.h -UseBasicParsing -TimeoutSec 10
                if ($logResp.Content -match 'Target\s*:\s*(https?://[^\s]+)') {
                    $target = $matches[1]
                } elseif ($logResp.Content -match 'target_url[^\S]*[:=][^\S]*(https?://[^\s"]+)') {
                    $target = $matches[1]
                }
            } catch {}
        }
    } catch {}
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Yellow
Write-Host "  ANLIK DURUM RAPORU                    $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Yellow
Write-Host "===========================================================" -ForegroundColor Yellow

# ---- 3. Hedef site sagligi ----
if ($target) {
    Write-Host ""
    Write-Host "== HEDEF SITE SAGLIGI ==" -ForegroundColor Cyan
    Write-Host "  URL: $target" -ForegroundColor White
    Write-Host ""
    $ok = 0; $fail = 0; $totalMs = 0
    for ($i=1; $i -le 5; $i++) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $resp = Invoke-WebRequest -Uri $target -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            $sw.Stop()
            $ok++
            $totalMs += $sw.ElapsedMilliseconds
            Write-Host "  Test $($i): HTTP $($resp.StatusCode)  |  $($sw.ElapsedMilliseconds) ms" -ForegroundColor Green
        } catch {
            $sw.Stop()
            $fail++
            $errMsg = $_.Exception.Message
            if ($errMsg.Length -gt 70) { $errMsg = $errMsg.Substring(0,70) }
            Write-Host "  Test $($i): FAIL  |  $($sw.ElapsedMilliseconds) ms  |  $errMsg" -ForegroundColor Red
        }
    }
    Write-Host ""
    if ($ok -gt 0) {
        $avgMs = [Math]::Floor($totalMs / $ok)
        Write-Host "  Sonuc: $ok/5 basarili  |  Ortalama $avgMs ms" -ForegroundColor $(if ($ok -ge 4) {'Green'} elseif ($ok -ge 2) {'Yellow'} else {'Red'})
    } else {
        Write-Host "  Sonuc: HEDEF TAMAMEN COKMUS (0/5)" -ForegroundColor Red -BackgroundColor Black
    }
} else {
    Write-Host ""
    Write-Host "  (Hedef URL log'dan cikarilamadi)" -ForegroundColor DarkGray
}

# ---- 4. Bot durumu ve son LIVE satirlari ----
Write-Host ""
Write-Host "== BOT DURUMU (canli) ==" -ForegroundColor Cyan
Write-Host ""

$grandActive = 0
$grandDone = 0
$grandQueued = 0
$sampleLive = @()

foreach ($r in $runs) {
    $acc = $r.acc
    $run = $r.run
    try {
        $jobs = (Invoke-RestMethod -Uri "https://api.github.com/repos/$($acc.user)/loadtest/actions/runs/$($run.id)/jobs?per_page=30" -Headers $r.h -TimeoutSec 8).jobs
    } catch { continue }
    
    $bots = $jobs | Where-Object {$_.name -like 'bot-*'}
    $active = ($bots | Where-Object {$_.status -eq 'in_progress'}).Count
    $done = ($bots | Where-Object {$_.status -eq 'completed'}).Count
    $queued = ($bots | Where-Object {$_.status -eq 'queued'}).Count
    $success = ($bots | Where-Object {$_.conclusion -eq 'success'}).Count
    $failed = ($bots | Where-Object {$_.conclusion -eq 'failure'}).Count
    
    $grandActive += $active
    $grandDone += $done
    $grandQueued += $queued
    
    $elapsed = ""
    if ($run.run_started_at) {
        $elapsed = ((Get-Date) - [DateTime]$run.run_started_at).ToString('mm\:ss')
    }
    
    $statusText = $run.status
    if ($run.conclusion) { $statusText = "$($run.status) -> $($run.conclusion)" }
    
    Write-Host "  === $($acc.name) ($($acc.user)) ===" -ForegroundColor Magenta
    Write-Host "     Run #$($run.id)  |  $statusText  |  sure: $elapsed"
    Write-Host "     Aktif: $active  |  Tamam: $done ($success OK / $failed FAIL)  |  Kuyruk: $queued"
    Write-Host ""
    
    # En son LIVE satirlarini cek (ilk 2 aktif bottan)
    $activeBots = $bots | Where-Object {$_.status -eq 'in_progress'} | Select-Object -First 2
    foreach ($j in $activeBots) {
        try {
            $logResp = Invoke-WebRequest -Uri "https://api.github.com/repos/$($acc.user)/loadtest/actions/jobs/$($j.id)/logs" -Headers $r.h -UseBasicParsing -TimeoutSec 8
            $liveLines = $logResp.Content -split "`n" | Where-Object {$_ -match '\[LIVE bot='} | Select-Object -Last 1
            if ($liveLines) {
                $line = $liveLines.Trim() -replace '^\d+-\d+-\d+T[^\s]+ ', ''
                Write-Host "     $($j.name): $line" -ForegroundColor Green
                $sampleLive += $line
            }
        } catch {}
    }
    Write-Host ""
}

# ---- 5. Grand total ----
Write-Host "===========================================================" -ForegroundColor Yellow
Write-Host "  GRAND TOTAL" -ForegroundColor Yellow
Write-Host "===========================================================" -ForegroundColor Yellow
Write-Host "  Toplam aktif bot  : $grandActive" -ForegroundColor Green
Write-Host "  Tamamlanmis       : $grandDone" -ForegroundColor Cyan
Write-Host "  Kuyrukta          : $grandQueued" -ForegroundColor Yellow

# LIVE satirlarindan toplam RPS tahmini
$totalRps = 0
$rpsCount = 0
foreach ($line in $sampleLive) {
    if ($line -match 'rps~(\d+)') {
        $totalRps += [int]$matches[1]
        $rpsCount++
    }
}
if ($rpsCount -gt 0 -and $grandActive -gt 0) {
    $avgRps = [Math]::Floor($totalRps / $rpsCount)
    $totalEst = $avgRps * $grandActive
    Write-Host "  Ornek RPS/bot     : ~$avgRps req/s" -ForegroundColor Magenta
    Write-Host "  TAHMINI TOPLAM RPS: ~$totalEst req/s (aktif bot x avg)" -ForegroundColor Magenta -BackgroundColor Black
}

Write-Host ""
Write-Host "  Linkler:"
foreach ($r in $runs) {
    Write-Host "    $($r.acc.name): https://github.com/$($r.acc.user)/loadtest/actions/runs/$($r.run.id)" -ForegroundColor DarkGray
}
Write-Host ""