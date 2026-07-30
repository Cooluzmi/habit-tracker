// ================================================================
// 3️⃣ STRESS TEST
// Amaç: Yüksek yükte davranış — kademeli olarak 1000 VU'ya kadar
// Toplam süre: ~15 dakika
// ================================================================

import { getPage, randomEndpoint, thinkTime, printBanner } from '../utils/helpers.js';
import { generateSummary } from '../utils/summary.js';

export const options = {
    scenarios: {
        stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 100 },    // 0 → 100
                { duration: '3m', target: 500 },    // 100 → 500
                { duration: '3m', target: 1000 },   // 500 → 1000
                { duration: '5m', target: 1000 },   // 1000 sabit
                { duration: '2m', target: 0 }       // ramp-down
            ],
            gracefulRampDown: '1m'
        }
    },

    thresholds: {
        // Stress testte daha toleranslıyız
        'http_req_failed': ['rate<0.10'],        // < %10 hata
        'http_req_duration': ['p(95)<5000'],       // p95 < 5s
        'http_reqs': ['count>10000']       // en az 10k istek
    },

    // Bağlantı reuse ve HTTP/2
    discardResponseBodies: false,

    tags: { test_type: 'stress' }
};

export function setup() {
    printBanner('STRESS TEST — 100 → 500 → 1000 VU / ~15 dakika');
    console.log('  ⚠️  Yüksek yük! Sunucuyu monitör edin (htop, netstat).');
}

export default function () {
    getPage(randomEndpoint());
    thinkTime();
}

export const handleSummary = generateSummary('03-stress');