"""Nonzero PWM firmware test; requires physically isolated driver VM. No motor test."""
import argparse,json,time,datetime
from pathlib import Path
import serial
from serial.tools import list_ports
p=argparse.ArgumentParser();p.add_argument('--port',required=True);p.add_argument('--expected-mac',required=True);p.add_argument('--confirm-vm-disconnected',action='store_true');a=p.parse_args()
if not a.confirm_vm_disconnected:p.error('Keep driver VM physically disconnected')
ports=[x for x in list_ports.comports() if x.device==a.port]
if len(ports)!=1 or (ports[0].vid,ports[0].pid)!=(0x303A,0x1001):p.error('Target is not one enumerated Espressif USB device at --port')
if not a.expected_mac or (ports[0].serial_number or '').casefold()!=a.expected_mac.casefold():p.error('USB serial does not match --expected-mac')
root=Path(__file__).resolve().parents[1];log=(root/'verification/output-acceptance.jsonl').open('w')
d=serial.Serial(port=None,baudrate=115200,timeout=.05,write_timeout=.2,exclusive=True);d.dtr=False;d.rts=False;d.port=a.port;d.open();seq=0;session=0

def record(x):
 log.write(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),**x})+'\n');log.flush()
def cmd(c,**kw):
 global seq,session
 seq+=1;q={'id':seq,'session':session,'cmd':c,**kw};record({'tx':q});d.write((json.dumps(q)+'\n').encode());end=time.monotonic()+1
 while time.monotonic()<end:
  try:r=json.loads(d.readline())
  except ValueError:continue
  if r.get('type')!='ack' or r.get('id')!=seq:continue
  record({'rx':r});assert r.get('ok'),r
  assert r.get('firmware')=='conveyor-1.0.0' and r.get('chip')=='ESP32-S3',r
  if c=='hello':session=r['session']
  return r
 raise RuntimeError('ACK timeout '+c)
def state(r,mode,duty):
 assert r['state']['mode']==mode and r['state']['duty']==duty,r
 print(mode,duty,r['state']['reason'],flush=True)
try:
 h=cmd('hello');assert h['settings']['timeoutMs']==1500 and h['settings']['reverseDelayMs']==300 and h['settings']['maxDuty']==30
 cmd('motor',action='stop');cmd('clear_emergency');cmd('heartbeat');cmd('arm')
 state(cmd('motor',action='forward',speed=20),'forward',20);time.sleep(.15)
 state(cmd('set_speed',value=25),'forward',25);time.sleep(.10)
 state(cmd('set_speed',value=100),'forward',30)
 state(cmd('motor',action='stop'),'stopped',0)
 cmd('heartbeat')
 state(cmd('motor',action='reverse',speed=20),'direction_delay',0)
 time.sleep(.15);state(cmd('get_status'),'direction_delay',0)
 time.sleep(.18);state(cmd('get_status'),'reverse',20)
 time.sleep(.15);state(cmd('motor',action='stop'),'stopped',0)
 cmd('heartbeat');state(cmd('motor',action='reverse',speed=20),'reverse',20)
 r=cmd('motor',action='emergency_stop');state(r,'stopped',0);assert r['state']['locked'] and not r['state']['armed']
 cmd('clear_emergency');cmd('heartbeat');cmd('arm');state(cmd('motor',action='reverse',speed=20),'reverse',20)
 # Stop sending heartbeats, keep receiving/querying: must stop at lease timeout.
 time.sleep(1.65);r=cmd('get_status');state(r,'stopped',0);assert not r['state']['armed'] and r['state']['reason']=='command_timeout'
 cmd('heartbeat');r=cmd('get_status');state(r,'stopped',0);assert not r['state']['armed']
 cmd('disarm');record({'result':'PASS','vm_isolated':True,'physical_motor_test':False,'physical_gpio_measurement':False})
 print('PASS: forward, speed adjustment, cap, stop, 300ms reversal delay, reverse, emergency, running-state heartbeat timeout; VM isolated.',flush=True)
except Exception as e:
 record({'result':'FAIL','error':str(e)});raise
finally:
 try:cmd('motor',action='stop');cmd('disarm')
 finally:d.close();log.close()
