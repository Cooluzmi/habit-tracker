// ================================================================
// 5️⃣ BREAKPOINT TEST — KIRILMA NOKTASI TESTİ ⚠️ AGRESİF
// Amaç: Sunucunun kaç req/s'de çöktüğünü bulmak
//
// Executor: ramping-arrival-rate (istek/saniye bazlı, VU-bağımsız)
// Başlangıç: 100 req/s
// Her dakika +200 req/s artış
// Maksimum: 5000 req/s (güvenlik tavanı)
// Otomatik abort: error rate %30'u aşarsa VEYA p95 > 10s
// ================================================================

import { getPage, randomEndpoint, printBanner } from '../utils/helpers.js';
import { generateSummary } from '../utils/summary.js';

export const options = {
    scenarios: {
        breakpoint: {
            executor: 'ramping-arrival-rate',
            startRate: 100,               // 100 req/s ile başla
            timeUnit: '1s',
            preAllocatedVUs: 500,         // Başlangıç VU havuzu
            maxVUs: 5000,                 // Maksimum VU (5000 req/s için yeterli)
            stages: [
                { duration: '1m', target: 100 },
                { duration: '1m', target: 300 },
                { duration: '1m', target: 500 },
                { duration: '1m', target: 800 },
                { duration: '1m', target: 1200 },
                { duration: '1m', target: 1700 },
                { duration: '1m', target: 2300 },
                { duration: '1m', target: 3000 },
                { duration: '1m', target: 4000 },
                { duration: '1m', target: 5000 },
                { duration: '2m', target: 5000 }    // Tavanda tut
            ]
        }
    },

    thresholds: {
        // ⚠️ abortOnFail: true → kırılma noktasında testi otomatik durdurur
        'http_req_failed': [{ threshold: 'rate<0.30', abortOnFail: true, delayAbortEval: '30s' }],
        'http_req_duration': [{ threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '30s' }]
    },

    tags: { test_type: 'breakpoint' }
};

export function setup() {
    printBanner('BREAKPOINT TEST — Kırılma Noktası Bulma');
    console.log('  🔥 100 → 5000 req/s aşamalı artış');
    console.log('  🛑 Hata %30 veya p95 > 10s olunca otomatik duracak');
    console.log('  📊 Sunucunuzun MAX kapasitesi bulunacak\n');
}

export default function () {
    getPage(randomEndpoint());
    // Arrival-rate executor'da sleep yok — hedef req/s otomatik yönetilir
}

export function teardown() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Test bitti. Reports klasöründeki HTML raporu inceleyin.');
    console.log('  Grafiklerdeki "kırılma anını" arayın (error rate patlaması).');
    console.log('═══════════════════════════════════════════════════════');
}

export const handleSummary = generateSummary('05-breakpoint');