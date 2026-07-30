// ================================================================
// 4️⃣ SPIKE TEST
// Amaç: Ani trafik patlamasına dayanıklılık (viral olma senaryosu)
// 10 VU → aniden 2000 VU → 10 VU
// ================================================================

import { getPage, randomEndpoint, printBanner } from '../utils/helpers.js';
import { generateSummary } from '../utils/summary.js';
import { sleep } from 'k6';

export const options = {
    scenarios: {
        spike: {
            executor: 'ramping-vus',
            startVUs: 10,
            stages: [
                { duration: '1m', target: 10 },     // baseline
                { duration: '10s', target: 2000 },   // 💥 ANİ PATLAMA
                { duration: '2m', target: 2000 },   // 2000 sabit
                { duration: '10s', target: 10 },     // ani düşüş
                { duration: '1m', target: 10 },     // recovery gözlemi
                { duration: '30s', target: 0 }
            ],
            gracefulRampDown: '30s'
        }
    },

    thresholds: {
        // Spike testte hata beklenir, ama tamamen çökmemeli
        'http_req_failed': ['rate<0.30'],       // < %30 hata (spike'ta normal)
        'http_req_duration': ['p(95)<8000']
    },

    tags: { test_type: 'spike' }
};

export function setup() {
    printBanner('SPIKE TEST — Ani 2000 VU Patlaması');
    console.log('  💥 10 saniye içinde 2000 kullanıcıya çıkacak!');
}

export default function () {
    getPage(randomEndpoint());
    // Spike testte think time yok — maksimum baskı
    sleep(0.1);
}

export const handleSummary = generateSummary('04-spike');