"""Single bounded physical motor test. Exact board only; does not save NVS."""
import argparse,datetime,json,time
from pathlib import Path
import serial
from serial.tools import list_ports
p=argparse.ArgumentParser();p.add_argument('--port',required=True);p.add_argument('--expected-mac',required=True);p.add_argument('--empty-fixed-motor',action='store_true');p.add_argument('--duty',type=int,default=30);p.add_argument('--duration-ms',type=int,default=200);p.add_argument('--frequency',type=int,default=1000);p.add_argument('--direction',choices=('forward','reverse'),default='forward',help='Raw firmware electrical polarity; forward is observed CCW on this motor');a=p.parse_args()
if not a.empty_fixed_motor:p.error('Motor must be empty and secured; observe locally')
if not (1<=a.duty<=30 and 10<=a.duration_ms<=200 and a.frequency in (1000,20000)):p.error('Restricted diagnostic envelope: <=30%, <=200ms, 1k/20kHz')
ports=[x for x in list_ports.comports() if x.device==a.port]
if len(ports)!=1 or (ports[0].vid,ports[0].pid)!=(0x303A,0x1001):p.error('Target is not one enumerated Espressif USB device at --port')
if not a.expected_mac or (ports[0].serial_number or '').casefold()!=a.expected_mac.casefold():p.error('USB serial does not match --expected-mac')
root=Path(__file__).resolve().parents[1];stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');f=(root/'verification'/('physical-pulse-'+stamp+'.jsonl')).open('w');dev=None;seq=0;session=0;boot=None;original=None

def record(obj):
 f.write(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),**obj})+'\n');f.flush()
def cmd(name,**args):
 global seq,session,boot
 seq+=1;q={'id':seq,'session':session,'cmd':name,**args};record({'tx':q});dev.write((json.dumps(q)+'\n').encode());end=time.monotonic()+.4
 while time.monotonic()<end:
  try:r=json.loads(dev.readline())
  except (ValueError,UnicodeDecodeError):continue
  if r.get('type')!='ack' or r.get('id')!=seq:continue
  record({'rx':r})
  if r.get('firmware')!='conveyor-1.0.0' or r.get('chip')!='ESP32-S3' or r.get('flashBytes')!=8388608:raise RuntimeError('Unexpected firmware')
  if name=='hello':session=r['session'];boot=r['boot']
  if r['boot']!=boot or r['session']!=session:raise RuntimeError('Device restarted/session changed')
  if not r.get('ok'):raise RuntimeError(r.get('code'))
  return r
 raise TimeoutError('No ACK '+name)
try:
 dev=serial.Serial(port=None,baudrate=115200,timeout=.02,write_timeout=.1,exclusive=True);dev.dtr=False;dev.rts=False;dev.port=a.port;dev.open()
 h=cmd('hello');original=h['settings'].copy();assert h['state']['ready'] and h['state']['nvsReady'] and h['state']['watchdogReady']
 cmd('motor',action='stop');cmd('disarm')
 temporary=original.copy();temporary['timeoutMs']=500;temporary['frequency']=a.frequency
 assert a.duty<=temporary['maxDuty']
 cmd('set_settings',settings=temporary);cmd('clear_emergency');cmd('heartbeat');cmd('arm')
 start=time.monotonic()
 try:
  r=cmd('motor',action=a.direction,speed=a.duty)
  assert r['state']['mode']==a.direction and r['state']['duty']==a.duty
  # Deadline is measured from transmit, not from the ACK. No keepalive during pulse.
  wait=start+a.duration_ms/1000-time.monotonic()
  if wait>0:time.sleep(wait)
 finally:
  stopped=cmd('motor',action='stop')
 record({'measured_host_pulse_ms':round((time.monotonic()-start)*1000,2),'stop_state':stopped['state'],'physical_observation':'awaiting user','vm_connected':True})
 assert stopped['state']['duty']==0 and stopped['state']['mode']=='stopped'
 cmd('disarm');cmd('set_settings',settings=original);cmd('motor',action='emergency_stop')
 record({'result':'COMMAND_SEQUENCE_PASS','physical_motion':'not determined by firmware','settings_restored':True})
 print('Pulse completed and STOP confirmed; original settings restored; emergency locked. Physical movement requires user observation.')
 print('Evidence:',f.name)
except Exception as e:
 record({'result':'FAIL','error':str(e)});raise
finally:
 if dev:
  try:
   cmd('motor',action='emergency_stop')
   if original:cmd('set_settings',settings=original)
  except Exception as e:record({'cleanup_error':str(e)})
  dev.close()
 f.close()
