// ================================================================
// Merkezi Konfigürasyon
// Tüm test senaryoları bu dosyadan URL ve ortak ayarları okur
// ================================================================

// Ortam değişkeniyle override edilebilir:
//   k6 run -e TARGET_URL=https://baska-site.com scenarios/01-smoke.js
export const BASE_URL = __ENV.TARGET_URL || 'https://hhh.frostai.com.tr';

// Test edilecek endpoint'ler (şimdilik sadece anasayfa)
// İleride buraya path eklenebilir: '/', '/api/health', '/login' vb.
export const ENDPOINTS = [
    '/'];

// Ortak HTTP başlıkları — gerçek tarayıcı taklidi
export const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) k6-loadtest/1.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive'
};

// Global thresholds — her senaryoda temel kabul kriterleri
export const COMMON_THRESHOLDS = {
    // İstek başına genel yanıt süresi
    'http_req_duration': ['p(95)<3000', 'p(99)<5000'],
    // Başarısız istek oranı %5'i geçmesin (stress/breakpoint için farklı)
    'http_req_failed': ['rate<0.05'],
    // Bağlantı hataları
    'http_req_blocked': ['p(95)<1000']
};

// Timing ayarları
export const HTTP_TIMEOUT = '30s';

// Sleep süresi (gerçek kullanıcı davranışı simülasyonu — saniye)
export const THINK_TIME_MIN = 0.5;
export const THINK_TIME_MAX = 2.0;

// Rapor çıktı klasörü
export const REPORTS_DIR = 'reports';