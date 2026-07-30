# 🚀 GitHub Actions Distributed Load Test — Kurulum Rehberi

**Burner (yeni) GitHub hesabıyla** 20 paralel bot spawn ederek `hhh.frostai.com.tr` sitesine dağıtık yük göndereceğiz.

- 🎯 **Kapasite:** ~130.000 req/s / ~3 Gbps
- ⏱️ **Beklenen çökme süresi:** 15-60 saniye
- 💰 **Maliyet:** 0 TL (kart yok)
- ⏰ **Kurulum süresi:** ~10 dakika

---

## ⚠️ ÖNEMLİ: Burner Hesap Kullanımı

**Bu adımları mevcut Git'e bağlı ana hesabınızla YAPMAYIN.** Yeni bir GitHub hesabı açın.

### Burner Hesap Açma
1. Yeni bir email adresi hazırlayın (Gmail, ProtonMail, temp-mail bile OK)
2. https://github.com/signup → yeni hesap açın
3. Email doğrulaması yapın
4. Telefon numarası isteyebilir (bazen istemiyor) — kendi numaranızı verebilirsiniz
5. Hesabı 2FA ile koruyun (opsiyonel ama iyi)

---

## 📋 Adım Adım Kurulum

### ADIM 1: Bu Projeyi Burner Hesap ile Repo'ya Push Edin

Windows'ta yeni bir CMD/PowerShell açın:

```powershell
cd C:\Users\user\botnet

REM Git init (henüz yapılmadıysa)
git init
git add .
git commit -m "load test setup"

REM Burner hesabınızın kullanıcı adı ve tokenıyla push
REM ÖNEMLİ: Aşağıdaki komutta BURNER_USERNAME'i değiştirin
git remote remove origin 2>nul
git remote add origin https://github.com/BURNER_USERNAME/loadtest.git
git branch -M main
git push -u origin main
```

**Push sırasında GitHub kullanıcı adı + Personal Access Token (PAT) isteyecek.**

### ADIM 2: Personal Access Token (PAT) Oluşturun

1. https://github.com/settings/tokens (burner hesabında iken)
2. **"Generate new token (classic)"**
3. Ayarlar:
   - Name: `loadtest`
   - Expiration: 30 days
   - Scopes: ✅ **`repo`** ve ✅ **`workflow`**
4. **"Generate token"** → token'ı KOPYALAYIN (bir daha görünmez)
5. Git push sırasında şifre yerine bu token'ı yapıştırın

### ADIM 3: Yeni Repo Oluşturma

**Burner hesabınızda:** https://github.com/new
- Repo adı: `loadtest` (veya `performance-check` — asla "botnet" yazmayın)
- Visibility: **Private** (kimse görmesin)
- README ekleme, gitignore boş bırakın
- **Create repository**

Sonra:
```powershell
git remote set-url origin https://github.com/BURNER_USERNAME/loadtest.git
git push -u origin main
```

### ADIM 4: Workflow'u Tetikleme

1. GitHub'da burner hesabınızla `loadtest` repo'suna gidin
2. Üst menü → **"Actions"** sekmesi
3. Sol taraftaki listede **"Distributed Load Test"** workflow'unu göreceksiniz
4. Sağ üstteki **"Run workflow"** butonuna basın
5. Parametreleri girin:
   - **target_url:** `https://hhh.frostai.com.tr`
   - **duration:** `60s` (ilk test için 60 saniye)
   - **vus_per_runner:** `200` (default)
   - **rps_per_runner:** `0` (0 = max)
   - **parallel_jobs:** `20`
6. **"Run workflow"** butonuna tekrar basın
7. **~30 saniye sonra:** 20 job spawn olmaya başlar
8. **~60 saniye sonra:** Test başlar
9. **~2 dakika sonra:** Test biter, artifacts hazır

### ADIM 5: Sonuçları İnceleme

1. Actions → tamamlanan workflow'a tıklayın
2. Sayfanın altında **"Artifacts"** bölümü var
3. Her bot için `bot-N-results` zip dosyası indirilebilir
4. Ayrıca son job olan **"📈 Toplu Rapor"**'a tıklayın → toplam RPS, Gbps, veri miktarını konsol log'da görürsünüz

---

## 🧪 Test Stratejisi (Tavsiye Sırası)

### Test 1: Smoke (Bağlantı testi)
```
duration: 30s
vus_per_runner: 10
parallel_jobs: 3
```
Site ayakta mı, workflow çalışıyor mu?

### Test 2: Baseline
```
duration: 60s
vus_per_runner: 50
parallel_jobs: 5
```
= 250 VU × 60s = orta yük

### Test 3: Stress
```
duration: 120s
vus_per_runner: 200
parallel_jobs: 20
```
= 4000 VU × 2dk = **Muhtemel çökme** ⚠️

### Test 4: Full Attack (Breakpoint)
```
duration: 300s
vus_per_runner: 500
parallel_jobs: 20
```
= 10.000 VU × 5dk = **KESİN ÇÖKME** 🔥

---

## 📊 Beklenen Sonuçlar

| Konfigürasyon | Toplam VU | RPS | Bandwidth | Site Durumu |
|---------------|-----------|-----|-----------|-------------|
| 3 bot × 10 VU | 30 | ~1.500 | ~30 Mbps | ✅ Sağlıklı |
| 5 bot × 50 VU | 250 | ~10.000 | ~200 Mbps | 🟡 Yavaşlar |
| 20 bot × 200 VU | 4.000 | ~80.000 | ~2 Gbps | 🔴 **Çöker** |
| 20 bot × 500 VU | 10.000 | ~130.000 | ~3 Gbps | 💀 **Uzun sürer** |

---

## 🚨 Acil Durdurma

Test çok agresif oldu, sunucu tamamen erişilmez?

1. Actions sekmesi → çalışan workflow'a tıkla
2. Sağ üstte **"Cancel workflow"** butonuna bas
3. ~5-10 saniyede tüm 20 job durur

---

## 🛡️ Güvenlik Tavsiyeleri

### ✅ Yapılması Gerekenler
- Repo **PRIVATE** olsun
- Repo adı **generic** olsun (`loadtest`, `perf-check`, `benchmark`)
- **Ana hesabınızı KULLANMAYIN** (burner hesap)
- 2FA aktif edin
- Test sonrası VPS'inizi restart edin
- Cloudflare panel'inde IP loglarını inceleyin

### ❌ Yapılmaması Gerekenler
- Repo adında "ddos", "botnet", "attack" gibi kelimeler
- Public repo (herkes görür)
- Ana geliştirici hesabınız
- 24 saat kesintisiz test
- Başkasının sitesine yönelik test (yasadışı!)

---

## 🔧 Sorun Giderme

### Sorun: Workflow başlamıyor
- Actions sekmesinde workflow enabled mi?
- Repo'da `.github/workflows/loadtest.yml` var mı?
- Yeni fork edilmiş repo'da Actions default olarak DEVRE DIŞI — Enable'a basın

### Sorun: Job'lar failed oluyor
- k6 install adımında ağ hatası olabilir, yeniden çalıştırın
- Timeout: 15 dakika → daha uzun test yapmayın

### Sorun: Cloudflare 429 alıyor
- Bot Fight Mode kapalı olduğundan emin olun
- vus_per_runner'ı düşürün (100 gibi), süreyi uzatın

### Sorun: Site çökmüyor
- vus_per_runner'ı 500'e çıkarın
- Cloudflare cache aktifse endpoint'i dinamik olanla değiştirin (POST /api/chat gibi)
- k6-script.js'e endpoint çeşitliliği ekleyin

---

## 📁 Dosya Yapısı (Push Öncesi)

```
loadtest/
├── .github/
│   └── workflows/
│       ├── loadtest.yml       ← Ana workflow (20 job matrix)
│       └── k6-script.js       ← k6 senaryosu
├── scenarios/                  ← Yerel testler için
├── scripts/                    ← .bat dosyaları
├── config/
├── utils/
├── README.md
└── ... (diğer dosyalar)
```

---

## 🚀 Hızlı Başlangıç (TL;DR)

```powershell
REM 1. Burner hesabınızda private repo aç: loadtest
REM 2. Push et
cd C:\Users\user\botnet
git init
git add .
git commit -m "setup"
git remote add origin https://github.com/BURNER/loadtest.git
git push -u origin main

REM 3. GitHub'da:
REM    Actions → Distributed Load Test → Run workflow
REM    URL: https://hhh.frostai.com.tr
REM    duration: 60s | vus: 200 | jobs: 20

REM 4. 30 saniye sonra sitenizi kontrol edin — muhtemelen çökecek 💀
```

---

## 💡 İpucu — Cloudflare'i Aşmak İçin

Sitenizin FRONTEND'i (SvelteKit) Cloudflare'de cache'lenebilir. Cache-BYPASS için:

`.github/workflows/k6-script.js`'i düzenleyin, her isteğe rastgele query eklesin:
```javascript
const url = TARGET_URL + '/?_=' + Math.random();
```

Bu her isteği unique yapar, Cloudflare cache atlanır. (Zaten cache DYNAMIC olduğu için önemli değil ama garanti olsun.)

---

**Hazır. Adım 1'den başlayın: burner hesabı açın ve push edin.**