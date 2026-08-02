# Mining Proxy Setup

Bu proxy senin local PC'nde çalışır. GitHub Actions bot'ları `music.frostai.com.tr` üzerinden buraya bağlanır ve proxy istekleri SupportXMR'a forward eder.

## 🎯 Mimarı

```
GitHub Actions Bot
    ↓ TCP (via Cloudflare Tunnel)
mining.frostai.com.tr:3333
    ↓
Senin PC (Docker container)
    ↓
pool.supportxmr.com:3333
```

## 🚀 Kurulum

### 1. Docker Container'ı Başlat

```bash
cd mining-proxy
docker-compose up -d
```

Container durumu:
```bash
docker ps
# mining-proxy container'ı "Up" olmalı
```

### 2. Cloudflare Tunnel Config

Cloudflare Tunnel config dosyanı düzenle (`.cloudflared/config.yml`):

```yaml
tunnel: <senin-tunnel-id>
credentials-file: /path/to/creds.json

ingress:
  # Dashboard (var olan)
  - hostname: music.frostai.com.tr
    service: http://localhost:5173

  # YENİ: Mining proxy
  - hostname: mining.frostai.com.tr
    service: tcp://localhost:3333

  # Catch-all
  - service: http_status:404
```

### 3. Cloudflare DNS'e Subdomain Ekle

Cloudflare Dashboard → DNS → `frostai.com.tr` zone:
- **Type**: CNAME
- **Name**: mining
- **Target**: `<tunnel-id>.cfargotunnel.com`
- **Proxy status**: Proxied (turuncu bulut)

### 4. Tunnel'ı Restart Et

```bash
# Windows service olarak çalışıyorsa:
sc stop cloudflared
sc start cloudflared

# Ya da direkt komut satırından:
cloudflared tunnel run
```

### 5. Test Et

Local'den:
```bash
telnet localhost 3333
# Bağlanmalı
```

Cloudflare üzerinden:
```bash
telnet mining.frostai.com.tr 3333
# Bağlanmalı (Cloudflare TCP tunnel)
```

## 📊 Proxy Web UI

Proxy'nin dashboard'ına local erişim:
```
http://localhost:8080
```

Bağlı worker sayısı, hashrate, share'ler burada görünür.

## 🔧 Kontrol Komutları

**Log görüntüle:**
```bash
docker logs -f mining-proxy
```

**Restart:**
```bash
docker-compose restart
```

**Durdur:**
```bash
docker-compose down
```

**Config değiştirmek:**
- `config.json`'u düzenle
- `docker-compose restart` çalıştır

## ⚠️ Notlar

- **PC 7/24 açık olmalı** — kapatırsan mining durur
- **Firewall**: Port 3333 açık olmalı (Cloudflare Tunnel bağlanabilsin)
- **Bandwidth**: ~200 KH/s için ~50 KB/s upload — çok az