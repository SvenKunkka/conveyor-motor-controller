"""Real serial no-motion acceptance test. Explicit isolation acknowledgement required."""
import argparse,json,time,sys
import serial
from serial.tools import list_ports
p=argparse.ArgumentParser();p.add_argument('--port',required=True);p.add_argument('--confirm-vm-disconnected',action='store_true')
a=p.parse_args()
if not a.confirm_vm_disconnected:p.error('Confirm VM isolated: opening a serial device may affect reset state')
if not any(x.device==a.port and (x.vid,x.pid)==(0x303A,0x1001) for x in list_ports.comports()):p.error('Espressif device not found')
s=serial.Serial(port=None,baudrate=115200,timeout=.1,write_timeout=.2,exclusive=True)
s.dtr=False;s.rts=False;s.port=a.port;s.open();session=0;seq=0
try:
    for cmd in ['hello','get_status','motor','get_settings']:
        seq+=1;obj={'id':seq,'cmd':cmd,'session':session}
        if cmd=='motor':obj['action']='stop'
        s.write((json.dumps(obj)+'\n').encode());deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            try:r=json.loads(s.readline())
            except (ValueError,UnicodeDecodeError):continue
            if r.get('type')=='ack' and r.get('id')==seq:
                print(json.dumps(r,ensure_ascii=False))
                assert r.get('ok') and r.get('firmware')=='conveyor-1.0.0' and r.get('chip')=='ESP32-S3'
                assert r['state']['ready'] and r['flashBytes']==8388608
                assert r['state']['duty']==0 and r['state']['mode']=='stopped' and not r['state']['armed']
                session=r['session'];break
        else:raise RuntimeError('No matching firmware acknowledgement')
    print('PASS: firmware handshake, stopped state, stop command and settings read; no motor run issued.')
finally:s.close()
