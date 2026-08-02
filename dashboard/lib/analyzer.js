const https = require('https');
const http = require('http');
const { URL } = require('url');
const dns = require('dns');

const agent = new https.Agent({ rejectUnauthorized: false });

function dnsLookup(host) {
    return new Promise((resolve) => {
        dns.lookup(host, (err, addr) => resolve(err ? '' : addr));
    });
}

function httpGet(url, timeout = 10000) {
    return new Promise((resolve) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const start = Date.now();

        const req = mod.get(url, {
            agent: parsed.protocol === 'https:' ? agent : undefined,
            timeout,
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' },
            // Follow redirects manually
        }, (res) => {
            // Handle redirects
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                let loc = res.headers.location;
                if (loc.startsWith('/')) loc = `${parsed.protocol}//${parsed.host}${loc}`;
                res.resume();
                return httpGet(loc, timeout).then(resolve);
            }

            const ms = Date.now() - start;
            const hdrs = res.headers;
            let body = '';
            res.on('data', c => body += c.toString().slice(0, 2000));
            res.on('end', () => {
                resolve({ status: res.statusCode, ms, headers: hdrs, body: body.slice(0, 1000), error: '' });
            });
        });

        req.on('error', (e) => resolve({ status: 0, ms: 0, headers: {}, body: '', error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: timeout, headers: {}, body: '', error: 'Timeout' }); });
    });
}

async function analyzeTarget(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return { url, error: 'Invalid URL' }; }

    const host = parsed.hostname;
    const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
    const ip = await dnsLookup(host);

    const result = {
        url, host, port, ip,
        server: '', cf: false, cache: '', origin_ms: 0,
        status: 0, error: '', recommendation: ''
    };

    if (!ip) { result.error = 'DNS resolve failed'; return result; }

    const resp = await httpGet(url);
    result.status = resp.status;
    result.origin_ms = resp.ms;
    result.error = resp.error;

    if (resp.headers) {
        result.server = resp.headers['server'] || '';
        result.cf = result.server.toLowerCase().includes('cloudflare');
        result.cache = resp.headers['cf-cache-status'] || '';

        // Server-Timing cfOrigin
        const st = resp.headers['server-timing'] || '';
        const m = st.match(/cfOrigin;dur=(\d+)/);
        if (m) result.origin_ms = parseInt(m[1]);
    }

    // Recommendation
    if (result.status === 403) {
        result.recommendation = 'ADAPTIVE (403 — fingerprint rotate lazım)';
    } else if (result.cache === 'DYNAMIC' && result.origin_ms > 500) {
        result.recommendation = 'FLOOD veya POST (yavaş origin, DYNAMIC cache)';
    } else if (result.cache === 'HIT') {
        result.recommendation = 'POST (cache bypass, POST asla cache\'lenmez)';
    } else if (!result.cf) {
        result.recommendation = 'L4 + FLOOD (CF yok, ham güç etkili)';
    } else {
        result.recommendation = 'FLOOD (genel amaçlı)';
    }

    return result;
}

async function checkHealth(url, count = 3) {
    const results = [];
    for (let i = 0; i < count; i++) {
        const resp = await httpGet(url, 5000);
        results.push({
            status: resp.status, ms: resp.ms,
            ok: resp.status > 0 && !resp.error,
            error: resp.error
        });
    }
    return results;
}

module.exports = { analyzeTarget, checkHealth };