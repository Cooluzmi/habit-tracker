// ================================================================
// Yardımcı fonksiyonlar — tüm senaryolarda kullanılır
// ================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import {
    BASE_URL,
    ENDPOINTS,
    DEFAULT_HEADERS,
    HTTP_TIMEOUT,
    THINK_TIME_MIN,
    THINK_TIME_MAX
} from '../config/config.js';

// Özel metrikler
export const pageLoadTrend = new Trend('page_load_duration', true);
export const successRate = new Rate('page_success_rate');
export const errorCounter = new Counter('page_errors');

/**
 * Rastgele bir endpoint seç
 */
export function randomEndpoint() {
    return ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
}

/**
 * Rastgele "think time" (gerçek kullanıcı davranışı)
 */
export function thinkTime() {
    const t = THINK_TIME_MIN + Math.random() * (THINK_TIME_MAX - THINK_TIME_MIN);
    sleep(t);
}

/**
 * GET isteği + ortak kontroller
 * @param {string} path - '/' veya '/api/xxx'
 * @param {object} extraParams - k6 http params override
 */
export function getPage(path = '/', extraParams = {}) {
    const url = `${BASE_URL}${path}`;

    const params = {
        headers: DEFAULT_HEADERS,
        timeout: HTTP_TIMEOUT,
        tags: { endpoint: path },
        ...extraParams
    };

    const res = http.get(url, params);

    const ok = check(res, {
        'status is 2xx or 3xx': (r) => r.status >= 200 && r.status < 400,
        'response time < 5s': (r) => r.timings.duration < 5000,
        'body is not empty': (r) => r.body && r.body.length > 0
    });

    // Özel metriklere kaydet
    pageLoadTrend.add(res.timings.duration);
    successRate.add(ok);
    if (!ok) errorCounter.add(1);

    return res;
}

/**
 * Test başlangıcında bilgi yazdır
 */
export function printBanner(scenarioName) {
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  🚀 ${scenarioName}`);
    console.log(`  🎯 Hedef: ${BASE_URL}`);
    console.log(`  📍 Endpoint sayısı: ${ENDPOINTS.length}`);
    console.log('═══════════════════════════════════════════════════════');
}