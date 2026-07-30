// ================================================================
// Test bitiminde HTML + JSON + konsol raporu üretir
// Her senaryonun sonunda handleSummary() bunu çağırır
// ================================================================

import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

/**
 * Standart handleSummary üretici
 * @param {string} scenarioName - Rapor dosyası için isim (örn: "stress")
 */
export function generateSummary(scenarioName) {
    return function handleSummary(data) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const baseName = `reports/${scenarioName}_${timestamp}`;

        return {
            // Konsola özet
            'stdout': textSummary(data, { indent: '  ', enableColors: true }),
            // HTML rapor
            [`${baseName}.html`]: htmlReport(data, {
                title: `k6 Load Test — ${scenarioName.toUpperCase()}`
            }),
            // Ham JSON (post-processing için)
            [`${baseName}.json`]: JSON.stringify(data, null, 2)
        };
    };
}