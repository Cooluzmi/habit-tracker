// ================================================================
// 6️⃣ MAX THROUGHPUT — MAKSIMUM BANT GENİŞLİĞİ TESTİ 🔥
// Amaç: Tek makineden fiziksel olarak mümkün olan MAX yükü göndermek
// Bandwidth (Gb/s) ve request-per-second (RPS) ölçümü
//
// UYARI: Bu senaryo:
//   - Tüm CPU çekirdeklerini kullanır
//   - Ağ bağlantınızı doldurur
//   - Yerel makinenizin bağlantı limitine ulaşır
// ================================================================

import http from 'k6/http';
import { Counter, Trend, Rate } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS } from '../config/config.js';
import { generateSummary } from '../utils/summary.js';

// Bandwidth metrikleri
const bytesReceived = new Counter('bytes_received_total');
const bytesSent = new Counter('bytes_sent_total');
const throughputMbps = new Trend('throughput_mbps', false);
const successRate = new Rate('req_success_rate');

export const options = {
    scenarios: {
        max_throughput: {
            executor: 'ramping-arrival-rate',
            startRate: 500,
            timeUnit: '1s',
            preAllocatedVUs: 2000,
            maxVUs: 20000,               // ⚡ MAX VU: 20.000
            stages: [
                { duration: '30s', target: 1000 },
                { duration: '30s', target: 3000 },
                { duration: '30s', target: 6000 },
                { duration: '30s', target: 10000 },
                { duration: '30s', target: 15000 },
                { duration: '1m', target: 20000 },   // 🔥 20.000 req/s hedef
                { duration: '2m', target: 20000 }    // tavanda tut
            ]
        }
    },

    // Performans optimizasyonları — tek makineden max verim
    discardResponseBodies: false,       // Bandwidth ölçmek için body lazım
    noConnectionReuse: false,           // Keep-alive AKTIF (daha hızlı)
    noVUConnectionReuse: false,
    batch: 20,                          // 20 paralel connection per VU
    batchPerHost: 20,
    userAgent: 'k6-maxthroughput/1.0',

    // Threshold yok — sadece ölçüm

    tags: { test_type: 'max_throughput' },

    // Sistem limitleri
    systemTags: ['status', 'method', 'error', 'error_code']
};

const testStartTime = Date.now();

export function setup() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🔥 MAX THROUGHPUT TEST — MAKSIMUM BANT GENİŞLİĞİ');
    console.log(`  🎯 Hedef URL: ${BASE_URL}`);
    console.log('  ⚡ Hedef: 20.000 req/s (yerel makine limitine kadar)');
    console.log('  📊 Ölçüm: RPS + Gbit/s + toplam MB transfer');
    console.log('  ⏱️  Toplam süre: ~5 dakika');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  UYARI: Makineniz ısınacak, CPU %100 gidecek.');
    console.log('  UYARI: Ağ bağlantınız satüre olacak.');
    console.log('═══════════════════════════════════════════════════════════\n');
    return { startTime: Date.now() };
}

export default function () {
    const res = http.get(BASE_URL + '/', {
        headers: DEFAULT_HEADERS,
        timeout: '15s',
        tags: { endpoint: '/' }
    });

    // Byte sayaçları
    const respSize = res.body ? res.body.length : 0;
    const reqSize = 500; // yaklaşık HTTP request boyutu (headers)

    bytesReceived.add(respSize);
    bytesSent.add(reqSize);

    // Anlık throughput (Mbps) — bir requestin boyutu * 8 / süre
    if (res.timings.duration > 0) {
        const mbps = ((respSize + reqSize) * 8) / (res.timings.duration * 1000);
        throughputMbps.add(mbps);
    }

    successRate.add(res.status >= 200 && res.status < 400);
}

export function teardown(data) {
    const elapsedSec = (Date.now() - data.startTime) / 1000;
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✅ MAX THROUGHPUT TEST TAMAMLANDI');
    console.log(`  ⏱️  Toplam süre: ${elapsedSec.toFixed(1)} saniye`);
    console.log('  📊 Rapor: reports/06-max-throughput_*.html');
    console.log('  🔍 Rapordaki metrikler:');
    console.log('       - http_reqs           → Toplam istek + RPS');
    console.log('       - data_received       → İndirilen toplam byte');
    console.log('       - data_sent           → Gönderilen toplam byte');
    console.log('       - bytes_received/sent → Byte sayaçları');
    console.log('       - throughput_mbps     → Anlık Mbps ortalaması');
    console.log('');
    console.log('  💡 Gb/s hesaplama:');
    console.log('     (data_received + data_sent) * 8 / test_süresi(sn) / 1e9');
    console.log('═══════════════════════════════════════════════════════════');
}

export const handleSummary = generateSummary('06-max-throughput');