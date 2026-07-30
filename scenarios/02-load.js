// ================================================================
// 2️⃣ LOAD TEST
// Amaç: Normal beklenen yük altında performans
// Aşamalı 100 VU'ya çıkış, 3 dk sabit, sonra iniş — toplam ~5 dk
// ================================================================

import { getPage, randomEndpoint, thinkTime, printBanner } from '../utils/helpers.js';
import { generateSummary } from '../utils/summary.js';

export const options = {
    scenarios: {
        load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 100 },   // ramp-up: 0 → 100 VU
                { duration: '3m', target: 100 },   // sabit: 100 VU
                { duration: '1m', target: 0 }      // ramp-down
            ],
            gracefulRampDown: '30s'
        }
    },

    thresholds: {
        'http_req_failed': ['rate<0.02'],       // < %2 hata
        'http_req_duration': ['p(95)<2000', 'p(99)<4000'],
        'checks': ['rate>0.98']
    },

    tags: { test_type: 'load' }
};

export function setup() {
    printBanner('LOAD TEST — 100 Concurrent User / 5 dakika');
}

export default function () {
    getPage(randomEndpoint());
    thinkTime();
}

export const handleSummary = generateSummary('02-load');