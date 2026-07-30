# 📊 Bant Genişliği (Gb/s) — Ne Kadar Görebilirsiniz?

Bu doküman, tek makineden yapabileceğiniz maksimum yük ile gerçek bir "büyük botnet" arasındaki farkı anlamanız için hazırlandı.

---

## 🖥️ Tek Yerel Makineden Maksimum

Yerel makinenizden çıkabilecek **teorik ve pratik** bant genişliği tamamen şunlara bağlı:

### Bileşenler ve Sınırları

| Bileşen | Etkisi | Tipik Değer |
|---------|--------|-------------|
| **İnternet upload hızı** | Ana darboğaz (bottleneck) | Ev: 5–50 Mbps · Fiber: 100 Mbps–1 Gbps |
| **CPU çekirdek sayısı** | k6 goroutine sayısı | Modern PC: 8-16 core → 20-50k RPS mümkün |
| **RAM** | VU başına ~50-200 KB | 8 GB RAM → ~40k VU tavan |
| **TCP port limiti** | Windows default: 16384 | Genişletilebilir → 64510 |
| **TCP timewait süresi** | Bağlantı kapanma süresi | Windows: 4 dk (kısaltılabilir) |
| **Ağ kartı** | Fiziksel limit | 1 Gbps NIC = ~120 MB/s |

---

## 📐 Gerçekçi Beklentiler

### Ev İnterneti (100 Mbps upload)
- **Maksimum bandwidth:** ~12.5 MB/s = **~0.1 Gbps**
- **Maksimum RPS (10 KB response):** ~1250 req/s
- **Maksimum RPS (küçük 500 byte response):** ~25.000 req/s (teorik)

### Fiber İnternet (1 Gbps upload)
- **Maksimum bandwidth:** ~125 MB/s = **~1 Gbps**
- **Maksimum RPS (10 KB response):** ~12.500 req/s
- **Maksimum RPS (küçük 500 byte response):** ~250.000 req/s (teorik)

### Data Center VPS (1-10 Gbps port)
- **Maksimum bandwidth:** 1-10 Gbps
- **Maksimum RPS:** 50.000-500.000+ (donanıma göre)

---

## 🔥 Tek k6 Instance'ın Fiziksel Limitleri

k6 dokümantasyonundan resmi rakamlar:

> **Modern bir makinede k6:**
> - CPU başına ~6.000-10.000 RPS
> - 8 core CPU'da: **~40.000-80.000 RPS**
> - Bandwidth: NIC'in tamamını doldurabilir (1 Gbps → gerçek 900+ Mbps)

Kaynak: [k6 Docs — What's the max VUs](https://k6.io/docs/misc/fine-tuning-os/)

---

## 🌍 Peki "Gerçek Botnet" Ne Kadar?

Gerçek profesyonel DDoS koruma testi veya siber güvenlik ekipleri için:

| Ölçek | Bandwidth | Kaynak |
|-------|-----------|--------|
| **1 VPS** | 100 Mbps – 10 Gbps | 3-5€/ay |
| **10 VPS dağıtık** | 1-100 Gbps | 30-50€/ay |
| **100 VPS dağıtık** | 10 Gbps-1 Tbps | 300-500€/ay |
| **Bulut load-test (k6 Cloud, BlazeMeter)** | 100+ Gbps | Aylık plan |
| **Cloudflare 2023 rekor DDoS** | **201 Tbps** | Zombie IoT ağı |

---

## ⚡ Sizin Sisteminizle Nasıl MAX'a Ulaşırsınız?

### 1. Windows TCP portlarını genişletin (Yönetici cmd)
```powershell
netsh int ipv4 set dynamicport tcp start=1025 num=64510
netsh int ipv4 set global maxpartialaccept=0
```

### 2. TIME_WAIT süresini kısaltın
```powershell
REG ADD HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters /v TcpTimedWaitDelay /t REG_DWORD /d 30 /f
REG ADD HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters /v MaxUserPort /t REG_DWORD /d 65534 /f
```
**Reboot gerekir.**

### 3. Max throughput testini çalıştırın
```
scripts\run-max-throughput.bat
```

Bu senaryo yerel makinenizi maksimum sömürür:
- `maxVUs: 20000` — 20.000 sanal kullanıcı
- Hedef: **20.000 req/s** (donanım izin verirse)
- Bandwidth ölçümü otomatik yapılır

### 4. Sonucu okuyun
Test sonunda `reports/06-max-throughput_*.html` dosyasında:
- **`data_received`** — İndirilen toplam byte
- **`data_sent`** — Gönderilen toplam byte
- **`http_reqs`** — Toplam istek + RPS (istek/saniye)

**Gb/s hesabı:**
```
Gb/s = (data_received + data_sent) × 8 / test_süresi_saniye / 1.000.000.000
```

Örnek: 5 dakikada 30 GB veri → 30 × 8 / 300 / 1 = **0.8 Gb/s**

---

## 🌐 Dağıtık Botnet ile Daha Fazlası (Faz 2)

Tek makine 1 Gb/s civarında tavan yapar. Daha yüksek için **dağıtık test** gerekir.

### Ucuz VPS Sağlayıcıları (Kendi Sunucularınız)

| Sağlayıcı | Model | Fiyat/ay | Bandwidth | RAM/CPU |
|-----------|-------|----------|-----------|---------|
| **Hetzner** | CX11 | ~4€ | 20 TB/ay | 2GB / 1 vCPU |
| **Contabo** | VPS S | ~5€ | 32 TB/ay | 8GB / 4 vCPU |
| **OVH** | VPS Starter | ~3€ | Sınırsız | 2GB / 1 vCPU |
| **DigitalOcean** | Basic | ~5$ | 1 TB/ay | 1GB / 1 vCPU |

**Örnek dağıtık kurulum:**
- 10× Contabo VPS S = 50€/ay
- Her biri: ~200 Mbps × 10 = **2 Gbps toplam bandwidth**
- ~500.000+ req/s toplam RPS

### Bulut Load Testing Servisleri

| Servis | Yaklaşık Ücret | Kapasite |
|--------|----------------|----------|
| **k6 Cloud** | 99$/ay başlangıç | 10-100 Gb/s |
| **BlazeMeter** | Aylık plan | 100+ Gb/s |
| **Locust Cloud** | Değişken | 50+ Gb/s |
| **LoadNinja** | Enterprise | 100+ Gb/s |

**Not:** Bunlar yasal ve profesyonel araçlardır; kendi sitenize ücret karşılığı yüksek yük göndermenizi sağlar.

---

## 🎯 SONUÇ — Sizin İçin Öneri

1. **Şimdi:** [`scripts/run-max-throughput.bat`](scripts/run-max-throughput.bat) çalıştırın — yerel makinenizin gerçek limitini görün.
2. **Sonra:** Eğer sunucunuz yerelden gönderdiğinizle bile çökmediyse, dağıtık teste geçin.
3. **Daha fazla için:** İsteğe göre 3-10 ucuz VPS ile "kendi botnet'inizi" (yasal, kendi kontrolünüzde) kuralım.

**Faz 2 (Dağıtık Sistem) isterseniz söyleyin, hazırlayayım:**
- Otomatik VPS deploy script'i (Ansible/Terraform)
- SSH orchestrator (tüm worker'ları eş zamanlı başlatma)
- Merkezi InfluxDB + Grafana dashboard
- Gerçek zamanlı toplam RPS ve Gb/s görselleştirmesi