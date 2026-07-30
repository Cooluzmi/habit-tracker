// ================================================================
// k6 script — GitHub Actions runner içinde çalışan senaryo
// ENV: TARGET_URL, DURATION, VUS, RPS
// ================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const TARGET_URL = __ENV.TARGET_URL || 'https://hhh.frostai.com.tr';
const BOT_ID = __ENV.BOT_ID || '?';

// Özel metrikler
const bytesReceived = new Counter('bytes_received_total');
const successRate = new Rate('success_rate');
const responseTime = new Trend('response_time_ms', true);

// Realistic User-Agent list (bot detection'dan kaçınmak için)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'];

const ACCEPT_LANGUAGES = ['tr-TR,tr;q=0.9,en;q=0.8', 'en-US,en;q=0.9', 'tr,en-US;q=0.9,en;q=0.8'];

function randomHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };
}

// k6 options CLI flag'leri ile geliyor (--vus, --duration, --rps)
// Ek options burada:
export const options = {
    discardResponseBodies: false,
    noConnectionReuse: false,
    batch: 20,
    batchPerHost: 20,
    insecureSkipTLSVerify: false,

    // Zaman aşımı
    httpDebug: false,

    tags: {
        bot_id: __ENV.BOT_ID || 'unknown',
        test_type: 'distributed_loadtest'
    }
};

export function setup() {
    console.log(`═══════════════════════════════════════════════════`);
    console.log(`  🤖 BOT #${BOT_ID} baslatildi`);
    console.log(`  🎯 Hedef: ${TARGET_URL}`);
    console.log(`═══════════════════════════════════════════════════`);
}

export default function () {
    const res = http.get(TARGET_URL + '/', {
        headers: randomHeaders(),
        timeout: '15s',
        tags: { endpoint: '/' }
    });

    check(res, {
        'status ok': (r) => r.status >= 200 && r.status < 400
    });

    if (res.body) {
        bytesReceived.add(res.body.length);
    }
    successRate.add(res.status >= 200 && res.status < 400);
    responseTime.add(res.timings.duration);
}

export function teardown() {
    console.log(`🤖 BOT #${BOT_ID} tamamlandi`);
}

// Summary — özet konsola yazsın (JSON zaten CLI ile export edilir)
export function handleSummary(data) {
    const reqs = data.metrics.http_reqs ? (data.metrics.http_reqs.values.count || 0) : 0;
    const bytes = data.metrics.data_received ? (data.metrics.data_received.values.count || 0) : 0;
    const failed = data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.rate || 0) : 0;
    const p95 = data.metrics.http_req_duration ? (data.metrics.http_req_duration.values['p(95)'] || 0) : 0;

    const summary =
        `═══════════════════════════════════════════════════════
  🤖 BOT #${BOT_ID} SONUÇ ÖZETİ
═══════════════════════════════════════════════════════
  Toplam istek     : ${reqs}
  Toplam veri      : ${(bytes / 1024 / 1024).toFixed(2)} MB
  Hata oranı       : ${(failed * 100).toFixed(2)}%
  Yanıt p95        : ${p95.toFixed(0)} ms
═══════════════════════════════════════════════════════
`;

    return {
        'stdout': summary,
        [`reports/bot-${BOT_ID}-summary.json`]: JSON.stringify(data, null, 2)
    };
}