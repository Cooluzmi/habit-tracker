// ================================================================
// 1️⃣ SMOKE TEST
// Amaç: Site ayakta mı? k6 doğru çalışıyor mu?
// 1 sanal kullanıcı, 30 saniye — minimal yük
// ================================================================

import { getPage, randomEndpoint, thinkTime, printBanner } from '../utils/helpers.js';
import { generateSummary } from '../utils/summary.js';

export const options = {
    vus: 1,
    duration: '30s',

    thresholds: {
        // Smoke testte hiç hata olmamalı
        'http_req_failed': ['rate<0.01'],     // < %1 hata
        'http_req_duration': ['p(95)<2000'],    // p95 < 2s
        'checks': ['rate>0.99']      // %99+ check başarılı
    },

    // Tag'ler
    tags: { test_type: 'smoke' }
};

export function setup() {
    printBanner('SMOKE TEST — Bağlantı Kontrolü');
}

export default function () {
    getPage(randomEndpoint());
    thinkTime();
}

export const handleSummary = generateSummary('01-smoke');