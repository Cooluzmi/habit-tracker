# 🚀 k6 Load Testing Sistemi

**Hedef:** `hhh.frostai.com.tr` — kendi VPS'nizde çalışan siteniz için profesyonel yük testi

Bu proje, [k6](https://k6.io/) kullanarak sunucunuzun performansını, kapasitesini ve kırılma noktasını (breakpoint) ölçmenizi sağlar.

---

## ⚠️ Yasal Uyarılar (Önce Bunları Okuyun!)

1. ✅ **Yalnızca sahibi olduğunuz veya yazılı izin aldığınız sistemlere test yapın.** TCK 243/244 ve uluslararası hukukta izinsiz sistemlere yük göndermek suçtur.
2. 📞 **VPS sağlayıcınıza haber verin.** Hetzner/DigitalOcean/AWS gibi sağlayıcılar yüksek trafiği DDoS zannedip hesabınızı askıya alabilir.
3. 🛡️ **Cloudflare / WAF varsa** IP'nizi whitelist'e ekleyin, yoksa bloklanırsınız.
4. ⏰ **Test saatini seçin.** Canlı trafik yoğunken değil, gece/bakım penceresinde yapın.
5. 👁️ **Sunucuyu izleyin.** `htop`, `netstat -an | wc -l`, log takibi mutlaka yapılmalı.

---

## 📦 1. Kurulum

### k6 Yükleme (Windows)

**Yöntem A — Chocolatey:**
```powershell
choco install k6
```

**Yöntem B — Winget:**
```powershell
winget install k6 --source winget
```

**Yöntem C — Manuel MSI:**
1. [k6-latest-amd64.msi](https://dl.k6.io/msi/k6-latest-amd64.msi) indirin
2. Kurulum yapın
3. Yeni bir CMD/PowerShell açın

**Kurulumu doğrulayın:**
```powershell
k6 version
```

---

## 🎯 2. Kullanım

### Hızlı Başlangıç — Test Sırası

```
1. Smoke   → 30 saniye  → Site ayakta mı?
2. Load    → 5 dakika   → Normal yük
3. Stress  → 15 dakika  → Yüksek yük
4. Spike   → 5 dakika   → Ani patlama
5. Breakpoint → ~13 dk  → Kırılma noktası
```

### Tek Test Çalıştırma

```powershell
# Windows CMD üzerinden
scripts\run-smoke.bat
scripts\run-load.bat
scripts\run-stress.bat
scripts\run-spike.bat
scripts\run-breakpoint.bat
```

### Doğrudan k6 komutu

```powershell
k6 run scenarios\01-smoke.js
k6 run scenarios\03-stress.js
```

### Tümünü Sırayla Çalıştır

```powershell
scripts\run-all.bat
```

### Farklı bir URL'yi test etme

```powershell
k6 run -e TARGET_URL=https://baska-site.com scenarios\03-stress.js
```

---

## 📊 3. Raporları İnceleme

Her test bitiminde `reports/` klasörüne 2 dosya oluşur:

- `<test>_YYYY-MM-DD_HH-MM-SS.html` — Grafiksel HTML rapor (tarayıcıda açın)
- `<test>_YYYY-MM-DD_HH-MM-SS.json` — Ham veri (post-processing için)

HTML raporda göreceğiniz metrikler:
- **http_req_duration** — İstek yanıt süresi (p95, p99)
- **http_req_failed** — Hata oranı
- **http_reqs** — Toplam istek sayısı
- **vus** — Anlık aktif kullanıcı
- **iteration_duration** — Bir senaryo döngü süresi

---

## 🧪 4. Test Senaryoları

| # | Senaryo | VU / Yük | Süre | Amaç |
|---|---------|----------|------|------|
| 1 | [`01-smoke.js`](scenarios/01-smoke.js) | 1 VU | 30 sn | Bağlantı testi |
| 2 | [`02-load.js`](scenarios/02-load.js) | 100 VU | 5 dk | Normal yük |
| 3 | [`03-stress.js`](scenarios/03-stress.js) | 100→1000 VU | 15 dk | Yüksek yük |
| 4 | [`04-spike.js`](scenarios/04-spike.js) | 2000 VU (ani) | 5 dk | Trafik patlaması |
| 5 | [`05-breakpoint.js`](scenarios/05-breakpoint.js) | 100→5000 req/s | ~13 dk | **Kırılma noktası** |

### Breakpoint Test — Kırılma Noktası Nasıl Yorumlanır?

Test şu şekilde çalışır:
- Her dakika req/s hedefini artırır (100 → 300 → 500 → ... → 5000)
- Error rate %30'u geçince veya p95 > 10s olunca **otomatik durur**
- Rapordaki grafikte "hata oranı patlaması"nın olduğu yer = **sunucunuzun kırılma noktası**

Örnek yorum: *"Sunucumuz 1700 req/s'e kadar dayandı, sonrasında hatalar başladı."*

---

## ⚙️ 5. Konfigürasyon

Merkezi ayar dosyası: [`config/config.js`](config/config.js:1)

Buradan değiştirebilirsiniz:
- `BASE_URL` — Hedef site
- `ENDPOINTS` — Test edilecek path'ler (şimdilik sadece `/`)
- `DEFAULT_HEADERS` — HTTP başlıkları (User-Agent vb.)
- `THINK_TIME_MIN/MAX` — Kullanıcı bekleme süreleri
- `HTTP_TIMEOUT` — İstek zaman aşımı

**Endpoint eklemek için** [`config/config.js`](config/config.js:12) içindeki `ENDPOINTS` dizisini genişletin:

```javascript
export const ENDPOINTS = [
  '/',
  '/api/health',
  '/about',
  '/products'
];
```

---

## 📁 6. Proje Yapısı

```
botnet/
├── plan.md                    # Detaylı plan dokümanı
├── README.md                  # Bu dosya
├── config/
│   └── config.js              # Merkezi ayarlar
├── utils/
│   ├── helpers.js             # Ortak fonksiyonlar (getPage vb.)
│   └── summary.js             # HTML/JSON rapor üretici
├── scenarios/
│   ├── 01-smoke.js
│   ├── 02-load.js
│   ├── 03-stress.js
│   ├── 04-spike.js
│   └── 05-breakpoint.js
├── scripts/
│   ├── run-smoke.bat
│   ├── run-load.bat
│   ├── run-stress.bat
│   ├── run-spike.bat
│   ├── run-breakpoint.bat
│   └── run-all.bat
└── reports/                   # Test sonuçları buraya
```

---

## 🖥️ 7. Sunucu Tarafı Monitoring (Öneri)

Test sırasında sunucunuza SSH ile bağlanıp şu komutları çalıştırın:

```bash
# CPU + RAM (canlı)
htop

# Aktif bağlantı sayısı
watch -n 1 'netstat -an | grep ESTABLISHED | wc -l'

# Nginx/Apache logları
tail -f /var/log/nginx/access.log

# Sistem yükü
watch -n 1 'uptime'

# Ağ trafiği
sudo iftop -i eth0
```

Bunlar sayesinde k6'nın raporu ile sunucunun gerçek durumunu karşılaştırabilirsiniz.

---

## 🌍 8. Dağıtık Test (Faz 2 — Opsiyonel)

Tek makineden 5000 req/s göndermek zor. Daha büyük yük için:

**Seçenek A: k6 Cloud** (paralı ama kolay)
- https://k6.io adresinden hesap açın
- `k6 cloud scenarios/05-breakpoint.js` ile bulut worker'lar kullanın

**Seçenek B: Kendi Dağıtık Sisteminiz**
- 3-5 ucuz VPS kiralayın (Contabo VPS S ~5€/ay, Hetzner CX11 ~3€/ay)
- Her VPS'e k6 kurun
- Bir orchestrator script (SSH ile) eş zamanlı başlatın
- Sonuçları InfluxDB + Grafana'da toplayın

Bu Faz 2 olarak eklenebilir — istek üzerine hazırlanır.

---

## 🐛 Sık Karşılaşılan Sorunlar

**Sorun:** `k6: command not found`
**Çözüm:** k6 kurulu değil veya PATH'te yok. Yeni terminal açın.

**Sorun:** Testler `dial tcp: i/o timeout` hataları veriyor
**Çözüm:** Yerel makinenin bağlantı limiti yetersiz. Windows'ta:
```powershell
netsh int ipv4 set dynamicport tcp start=1025 num=64510
```

**Sorun:** k6 çok CPU/RAM tüketiyor
**Çözüm:** VU sayısını düşürün veya dağıtık teste geçin.

**Sorun:** Site Cloudflare arkasında ve 429/403 alıyor
**Çözüm:** Cloudflare panelinde IP'nizi whitelist'e ekleyin veya "Under Attack Mode"u kapatın.

**Sorun:** Sunucu erişilmez oldu
**Çözüm:** VPS panelinden yeniden başlatın. Bir dahaki sefere daha düşük yükle başlayın.

---

## 📚 Kaynaklar

- [k6 Documentation](https://k6.io/docs/)
- [k6 Test Types](https://k6.io/docs/test-types/introduction/)
- [k6 Best Practices](https://k6.io/docs/testing-guides/test-types/)
- [k6-reporter (HTML)](https://github.com/benc-uk/k6-reporter)

---

## ⚡ Hızlı Referans

```powershell
# Kurulum kontrolü
k6 version

# Smoke test (önce mutlaka bunu çalıştırın)
scripts\run-smoke.bat

# Kırılma noktası testi (asıl amacınız)
scripts\run-breakpoint.bat

# Farklı URL ile test
k6 run -e TARGET_URL=https://site.com scenarios\03-stress.js
```

---

**Not:** İlk testinizi mutlaka [`scripts/run-smoke.bat`](scripts/run-smoke.bat) ile yapın. Site erişilebilirse ve k6 doğru çalışıyorsa yeşil ışıksınız. Sonrasında sırayla load → stress → spike → breakpoint.