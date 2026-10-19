"""Guarded upload: explicit motor isolation, exact USB serial, ROM identity, backup."""
import argparse,datetime,hashlib,json,re,subprocess,sys
from pathlib import Path
from serial.tools import list_ports
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--port',required=True);p.add_argument('--expected-mac',required=True)
p.add_argument('--confirm-vm-disconnected',action='store_true')
a=p.parse_args()
if not a.confirm_vm_disconnected:p.error('Confirm motor VM is physically disconnected before probing/reset/upload')
ports=[x for x in list_ports.comports() if x.device==a.port]
if len(ports)!=1 or (ports[0].vid,ports[0].pid)!=(0x303A,0x1001):p.error('Target is not an enumerated Espressif USB device')
if (ports[0].serial_number or '').lower()!=a.expected_mac.lower():p.error('USB serial does not match explicitly selected target')
# Verify artifact checksums before touching the device.
for line in (ROOT/'dist/SHA256SUMS').read_text().splitlines():
    digest,name=line.split();assert hashlib.sha256((ROOT/'dist'/name).read_bytes()).hexdigest()==digest,'Artifact hash mismatch'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
folder=ROOT/'verification'/('flash-'+stamp);folder.mkdir(exist_ok=False)
def run(args,name):
    cmd=[sys.executable,'-m','esptool','--chip','esp32s3','--port',a.port]+args
    r=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (folder/(name+'.log')).write_text(r.stdout);print(r.stdout)
    if r.returncode:raise SystemExit('Failed '+name+'; no further steps performed')
    return r.stdout
identity=run(['chip-id'],'identity')
if 'ESP32-S3' not in identity or a.expected_mac.lower() not in identity.lower():raise SystemExit('ROM identity mismatch')
info=run(['flash-id'],'flash-id')
if '8MB' not in info:raise SystemExit('Expected 8MB flash; stopped')
security=run(['get-security-info'],'security')
if 'Secure Boot: Disabled' not in security or 'Flash Encryption: Disabled' not in security:
    raise SystemExit('Security state is not explicitly disabled; stopped without changing security')
run(['read-flash','0','0x800000',str(folder/'backup-8MB.bin')],'backup')
backup=folder/'backup-8MB.bin'
if backup.stat().st_size!=8388608:raise SystemExit('Incomplete backup')
(folder/'backup.sha256').write_text(hashlib.sha256(backup.read_bytes()).hexdigest()+'\n')
images=['0x0',str(ROOT/'dist/bootloader.bin'),'0x8000',str(ROOT/'dist/partitions.bin'),
        '0xe000',str(ROOT/'dist/boot_app0.bin'),'0x10000',str(ROOT/'dist/firmware.bin')]
run(['write-flash','--flash-size','8MB','--flash-mode','dio','--flash-freq','80m']+images,'write')
run(['verify-flash']+images,'verify')
print('Flash verified. Motor VM remains disconnected. Run serial_test.py before applying motor power.')
