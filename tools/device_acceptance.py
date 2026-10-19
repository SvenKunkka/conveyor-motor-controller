"""Real-device acceptance with zero PWM only. Does not energize the motor.
Keep VM physically isolated. --reset-test uses the ROM identity command to reset.
"""
import argparse,datetime,json,subprocess,sys,time
from pathlib import Path
import serial
from serial.tools import list_ports
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--port',required=True)
parser.add_argument('--expected-mac',required=True)
parser.add_argument('--confirm-vm-disconnected',action='store_true')
parser.add_argument('--reset-test',action='store_true')
parser.add_argument('--pio-python',default=str(Path.home()/'.platformio/penv/bin/python'))
a=parser.parse_args()
if not a.confirm_vm_disconnected:parser.error('VM isolation must be confirmed')
def verify_target():
    ports=[p for p in list_ports.comports() if p.device==a.port]
    if len(ports)!=1 or (ports[0].vid,ports[0].pid)!=(0x303A,0x1001):
        parser.error('Target is not one enumerated Espressif USB device at --port')
    if not a.expected_mac or (ports[0].serial_number or '').casefold()!=a.expected_mac.casefold():
        parser.error('USB serial does not match --expected-mac')
verify_target()
logfile=ROOT/'verification/device-acceptance.jsonl'
log=logfile.open('w');dev=None;seq=0;session=0

def record(data):
    log.write(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),**data},ensure_ascii=False)+'\n');log.flush()
def open_device():
    global dev,seq,session
    verify_target()
    dev=serial.Serial(port=None,baudrate=115200,timeout=.1,write_timeout=.3,exclusive=True)
    dev.dtr=False;dev.rts=False;dev.port=a.port;dev.open();seq=0;session=0
    reply=command('hello');session=reply['session'];return reply

def command(cmd,expect='OK',**kwargs):
    global seq
    seq+=1;request={'id':seq,'session':session,'cmd':cmd,**kwargs}
    # This tool never sends a positive motor PWM, including negative test cases.
    if cmd=='motor' and kwargs.get('action') in ('forward','reverse'):
        assert kwargs.get('speed')==0
    wire=json.dumps(request)+'\n';record({'tx':request});dev.write(wire.encode())
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
        try:reply=json.loads(dev.readline())
        except (ValueError,UnicodeDecodeError):continue
        if reply.get('type')!='ack' or reply.get('id')!=seq:continue
        record({'rx':reply})
        assert reply.get('firmware')=='conveyor-1.0.0' and reply.get('chip')=='ESP32-S3',reply
        assert reply.get('code')==expect,reply
        assert reply['state']['duty']==0 and reply['state']['mode']=='stopped',reply
        return reply
    raise RuntimeError('No ACK for '+cmd)

def reset_board():
    global dev
    dev.close();dev=None
    verify_target()
    r=subprocess.run([a.pio_python,'-m','esptool','--chip','esp32s3','--port',a.port,'chip-id'],text=True,capture_output=True,timeout=30)
    record({'reset_log':r.stdout,'reset_error':r.stderr,'returncode':r.returncode})
    assert r.returncode==0
    time.sleep(.8)
    return open_device()

original=None
try:
    first=open_device();original=first['settings'].copy()
    assert first['state']['ready'] and first['state']['watchdogReady'] and first['state']['nvsReady']
    assert not first['state']['armed']
    command('motor',action='stop')
    command('motor',expect='E_NOT_ARMED',action='forward',speed=0)
    command('heartbeat');command('arm')
    command('motor',action='forward',speed=0)
    command('set_settings',expect='E_BUSY',settings={'maxDuty':30})
    command('motor',action='emergency_stop')
    locked=command('arm',expect='E_LOCKED');assert locked['state']['locked'] and not locked['state']['armed']
    command('clear_emergency');assert not command('get_status')['state']['armed']
    command('set_settings',expect='E_RANGE',settings={'frequency':0})
    assert command('get_settings')['settings']==original
    command('set_settings',expect='E_UNKNOWN_SETTING',settings={'nonsense':1})
    command('heartbeat');command('arm')
    time.sleep(original['timeoutMs']/1000+.2)
    timed=command('get_status');assert not timed['state']['armed'] and timed['state']['reason']=='command_timeout'
    command('heartbeat');assert not command('get_status')['state']['armed']
    # NVS reset persistence: change a harmless stopped-state delay then restore.
    if a.reset_test:
        changed=original.copy();changed['reverseDelayMs']=301 if original['reverseDelayMs']!=301 else 302
        command('set_settings',settings=changed);command('save_settings')
        after=reset_board();assert after['boot']!=first['boot'] and after['settings']==changed and not after['state']['armed']
        command('set_settings',settings=original);command('save_settings')
        restored=reset_board();assert restored['settings']==original and not restored['state']['armed']
    final=command('disarm');assert not final['state']['armed'] and not final['state']['locked']
    record({'result':'PASS','zero_pwm_only':True,'nvs_reset_test':a.reset_test,'power_cycle_test':False})
    print('PASS: real firmware handshake, stop, interlock, emergency lock, invalid settings, zero-output timeout'+(', NVS across two resets and restored defaults' if a.reset_test else ''))
except Exception as e:
    record({'result':'FAIL','error':str(e)});raise
finally:
    if dev:
        try:command('disarm')
        except Exception:pass
        dev.close()
    log.close()
