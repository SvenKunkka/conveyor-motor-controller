import json,subprocess,sys,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8766'
def ready():
    try:
        with urllib.request.urlopen(URL+'/api/health',timeout=.5) as response:
            return json.load(response).get('service')=='conveyor-motor-controller'
    except Exception:return False
if ready():
    subprocess.run(['open',URL],check=True)
else:
    proc=subprocess.Popen([sys.executable,str(ROOT/'tools/server.py')])
    for _ in range(50):
        if proc.poll() is not None:raise SystemExit('Server could not start; check port 8766')
        if ready():break
        time.sleep(.1)
    else:
        proc.terminate();raise SystemExit('Server startup timed out')
    subprocess.run(['open',URL],check=True)
    try:proc.wait()
    except KeyboardInterrupt:proc.terminate();proc.wait()
