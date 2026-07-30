#!/usr/bin/env python3
"""
🔍 Origin IP Finder — Cloudflare arkasındaki gerçek IP'yi bulur

KULLANIM:
    python origin-finder.py --domain hhh.frostai.com.tr

YASAL UYARI:
    Bu araç YALNIZCA kendi domain'inize veya yazılı izin aldığınız
    hedeflere yönelik kullanılmalıdır. Başkasının sitesine yönelik
    reconnaissance TCK 243 kapsamında suçtur.
"""

import argparse
import socket
import ssl
import sys
import re
import ipaddress
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import json
import concurrent.futures

# ===========================================================================
# Cloudflare IP Range'leri (kamuya açık liste)
# ===========================================================================
CLOUDFLARE_RANGES = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
    "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
    "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
    "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"]

CF_NETWORKS = [ipaddress.ip_network(cidr) for cidr in CLOUDFLARE_RANGES]

# Ortak subdomain'ler (leak olma ihtimali yüksek)
COMMON_SUBDOMAINS = [
    "mail", "webmail", "smtp", "pop", "pop3", "imap", "email",
    "ftp", "sftp", "cpanel", "whm", "webdisk",
    "direct", "origin", "backend", "api-direct", "api-origin",
    "dev", "test", "staging", "beta", "alpha", "old",
    "admin", "administrator", "panel", "portal",
    "ns1", "ns2", "dns", "dns1", "dns2",
    "www", "api", "app", "static", "assets", "cdn",
    "blog", "shop", "store", "forum", "wiki",
    "vpn", "remote", "ssh", "backup",
    "mx", "mx1", "mx2", "relay",
    "server", "srv", "host",
    "beta", "sandbox", "demo",
    "dashboard", "controlpanel"]


def is_cloudflare_ip(ip):
    """IP Cloudflare range'inde mi?"""
    try:
        ip_obj = ipaddress.ip_address(ip)
        for network in CF_NETWORKS:
            if ip_obj in network:
                return True
        return False
    except ValueError:
        return False


def color(text, c):
    """Terminal renk"""
    colors = {'r':'\033[91m','g':'\033[92m','y':'\033[93m',
              'b':'\033[94m','m':'\033[95m','c':'\033[96m','n':'\033[0m'}
    return f"{colors.get(c, '')}{text}{colors['n']}"


def banner(domain):
    print(color("═══════════════════════════════════════════════════════════════", 'c'))
    print(color(f"  🔍 ORIGIN IP FINDER — {domain}", 'y'))
    print(color("═══════════════════════════════════════════════════════════════", 'c'))
    print()


def resolve_domain(domain):
    """Domain'i DNS ile çöz"""
    try:
        ip = socket.gethostbyname(domain)
        return ip
    except socket.gaierror:
        return None


def check_direct_dns(domain):
    """1. Yöntem: Ana domain zaten Cloudflare arkasında değil mi?"""
    print(color("[1/6] 🔍 Direct DNS Check", 'b'))
    ip = resolve_domain(domain)
    if not ip:
        print(f"    ❌ Domain resolve edilemedi")
        return []

    if is_cloudflare_ip(ip):
        print(f"    ✅ Cloudflare arkasında ({ip})")
        return []
    else:
        print(color(f"    ⚠️  ORIGIN IP DOĞRUDAN GÖRÜNÜYOR: {ip}", 'r'))
        return [(ip, "direct-dns")]


def check_subdomains(domain):
    """2. Yöntem: Subdomain'lerde Cloudflare proxy olmayan var mı?"""
    print(color("[2/6] 🔍 Subdomain Enumeration (ortak subdomain'ler)", 'b'))

    parts = domain.split('.')
    if len(parts) > 2:
        # zaten subdomain — root domain'i al
        root = '.'.join(parts[-2:])
    else:
        root = domain

    print(f"    Root domain: {root}")

    found = []
    def check_sub(sub):
        full = f"{sub}.{root}"
        try:
            ip = socket.gethostbyname(full)
            if not is_cloudflare_ip(ip):
                return (full, ip)
        except socket.gaierror:
            pass
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        results = list(ex.map(check_sub, COMMON_SUBDOMAINS))

    leaks = [r for r in results if r]
    if leaks:
        print(color(f"    ⚠️  {len(leaks)} adet subdomain leak bulundu:", 'r'))
        for sub, ip in leaks:
            print(f"       → {sub} → {ip}")
            found.append((ip, f"subdomain: {sub}"))
    else:
        print("    ✅ Ortak subdomain'ler hep Cloudflare arkasında")

    return found


def check_crt_sh(domain):
    """3. Yöntem: crt.sh üzerinden SSL cert taraması ile subdomain enum"""
    print(color("[3/6] 🔍 Certificate Transparency (crt.sh)", 'b'))

    parts = domain.split('.')
    root = '.'.join(parts[-2:]) if len(parts) > 2 else domain

    url = f"https://crt.sh/?q=%25.{root}&output=json"
    try:
        req = Request(url, headers={'User-Agent': 'origin-finder/1.0'})
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

        # Unique domain'leri çıkar
        subdomains = set()
        for entry in data:
            name = entry.get('name_value', '').lower()
            for line in name.split('\n'):
                line = line.strip().replace('*.', '')
                if line and line.endswith(root):
                    subdomains.add(line)

        print(f"    {len(subdomains)} unique subdomain bulundu")

        # Her birini kontrol et
        found = []
        def check(sub):
            try:
                ip = socket.gethostbyname(sub)
                if not is_cloudflare_ip(ip):
                    return (sub, ip)
            except socket.gaierror:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
            results = list(ex.map(check, subdomains))

        leaks = [r for r in results if r]
        if leaks:
            print(color(f"    ⚠️  {len(leaks)} adet leak:", 'r'))
            for sub, ip in leaks[:20]:
                print(f"       → {sub} → {ip}")
                found.append((ip, f"crt.sh: {sub}"))
        else:
            print("    ✅ crt.sh subdomain'leri hep Cloudflare")

        return found
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        print(f"    ❌ crt.sh erişim hatası: {e}")
        return []


def check_hackertarget_dns_history(domain):
    """4. Yöntem: DNS history — HackerTarget API"""
    print(color("[4/6] 🔍 DNS History (hackertarget.com)", 'b'))
    url = f"https://api.hackertarget.com/hostsearch/?q={domain}"
    try:
        req = Request(url, headers={'User-Agent': 'origin-finder/1.0'})
        with urlopen(req, timeout=10) as resp:
            data = resp.read().decode()

        found = []
        for line in data.splitlines():
            parts = line.strip().split(',')
            if len(parts) == 2:
                host, ip = parts
                if not is_cloudflare_ip(ip):
                    print(color(f"    ⚠️  {host} → {ip}", 'r'))
                    found.append((ip, f"hackertarget: {host}"))
        if not found:
            print("    ✅ HackerTarget'ta leak yok")
        return found
    except (URLError, HTTPError) as e:
        print(f"    ❌ HackerTarget erişim hatası: {e}")
        return []


def check_dnsdumpster(domain):
    """5. Yöntem: DNSDumpster (basit tarama)"""
    print(color("[5/6] 🔍 DNSDumpster benzeri lookup", 'b'))
    # DNSDumpster requires session, use rapid7 or similar
    # Basit MX record kontrolü:
    try:
        import subprocess
        result = subprocess.run(
            ['nslookup', '-type=MX', domain],
            capture_output=True, text=True, timeout=10)
        output = result.stdout

        # MX record'daki mail server'ları bul
        mx_pattern = re.findall(r'mail exchanger = \d+ (\S+)', output)
        found = []
        for mx in mx_pattern:
            mx = mx.rstrip('.')
            try:
                ip = socket.gethostbyname(mx)
                if not is_cloudflare_ip(ip):
                    print(color(f"    ⚠️  MX record leak: {mx} → {ip}", 'r'))
                    found.append((ip, f"mx: {mx}"))
            except socket.gaierror:
                pass

        if not found:
            print("    ✅ MX record leak yok")
        return found
    except Exception as e:
        print(f"    ❌ MX check hatası: {e}")
        return []


def verify_origin(candidate_ip, domain):
    """6. Yöntem: Muhtemel origin'i doğrula"""
    try:
        # HTTPS ile Host header spoofing
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        sock = socket.create_connection((candidate_ip, 443), timeout=5)
        ssock = ctx.wrap_socket(sock, server_hostname=domain)

        request = (f"GET / HTTP/1.1\r\n"
                   f"Host: {domain}\r\n"
                   f"User-Agent: Mozilla/5.0\r\n"
                   f"Connection: close\r\n\r\n")
        ssock.send(request.encode())
        resp = ssock.recv(4096).decode('utf-8', errors='ignore')
        ssock.close()

        status_line = resp.split('\r\n')[0]
        return status_line
    except Exception as e:
        return f"HATA: {e}"


def main():
    parser = argparse.ArgumentParser(description="Origin IP Finder")
    parser.add_argument("--domain", "-d", required=True, help="Hedef domain")
    parser.add_argument("--verify", "-v", action="store_true",
                        help="Bulunan IP'leri doğrula (Host header ile)")
    args = parser.parse_args()

    domain = args.domain.strip()
    banner(domain)

    # Tüm yöntemleri çalıştır
    all_findings = []
    all_findings += check_direct_dns(domain)
    print()
    all_findings += check_subdomains(domain)
    print()
    all_findings += check_crt_sh(domain)
    print()
    all_findings += check_hackertarget_dns_history(domain)
    print()
    all_findings += check_dnsdumpster(domain)
    print()

    # Unique IP listesi
    unique_ips = {}
    for ip, source in all_findings:
        if ip not in unique_ips:
            unique_ips[ip] = []
        unique_ips[ip].append(source)

    # Sonuç
    print(color("═══════════════════════════════════════════════════════════════", 'c'))
    print(color(f"[6/6] 📊 SONUÇ — {len(unique_ips)} unique origin IP adayı", 'y'))
    print(color("═══════════════════════════════════════════════════════════════", 'c'))

    if not unique_ips:
        print(color("\n✅ HİÇBİR LEAK BULUNAMADI!", 'g'))
        print("   Cloudflare koruması güçlü, origin gizli.")
        return

    print()
    for ip, sources in unique_ips.items():
        print(color(f"🎯 {ip}", 'r'))
        for src in sources:
            print(f"   ↳ Kaynak: {src}")
        if args.verify:
            status = verify_origin(ip, domain)
            print(f"   ↳ HTTPS Test: {status}")
        print()

    # Saldırı için k6 komutu üret
    print(color("─────────────────────────────────────────────────────────────", 'c'))
    print(color("💥 DIRECT ORIGIN ATTACK KOMUTU (Cloudflare bypass):", 'y'))
    print(color("─────────────────────────────────────────────────────────────", 'c'))
    for ip in unique_ips.keys():
        print(f"\n  # {ip} için doğrudan test:")
        print(f'  k6 run --vus 100 --duration 30s \\')
        print(f'    -e TARGET_URL="https://{ip}" \\')
        print(f'    -e HOST_HEADER="{domain}" \\')
        print(f'    scenarios/01-smoke.js')

    print()
    print(color("⚠️  UYARILAR:", 'r'))
    print("  • VPS sağlayıcınıza test yapmadan önce bildirin")
    print("  • Cloudflare koruma bypass'ı VPS'ye tam yük demektir")
    print("  • Bandwidth kotanız tükenebilir")
    print("  • Kendi IP'niz olduğundan emin olun!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nİptal edildi.")
        sys.exit(1)