"""Same-origin, single-owner serial relay. Never manufactures device heartbeats."""
import argparse
import asyncio
import contextlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web, WSMsgType
import serial
from serial.tools import list_ports

ROOT=Path(__file__).resolve().parents[1]
STATE=web.AppKey('relay_state',dict)

def ports():
    return [{"path":p.device,"description":p.description,"serial":p.serial_number,
             "vid":p.vid,"pid":p.pid} for p in list_ports.comports()
            if p.vid==0x303A and p.pid==0x1001]

@web.middleware
async def origin_guard(request, handler):
    if request.host not in request.app[STATE]['allowed_hosts']:
        raise web.HTTPForbidden(text='Unrecognized Host')
    origin=request.headers.get('Origin')
    if origin and origin not in request.app[STATE]['allowed_origins']:
        raise web.HTTPForbidden(text='Cross-origin control is forbidden')
    if request.path=='/ws' and not origin:
        raise web.HTTPForbidden(text='Origin required')
    response=await handler(request)
    if not isinstance(response,web.WebSocketResponse):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Content-Security-Policy']="default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
    return response

async def index(request):return web.FileResponse(ROOT/'web/index.html')
async def port_list(request):return web.json_response({'ports':ports()})
async def health(request):return web.json_response({'service':'conveyor-motor-controller','version':'1.0.0'})

async def websocket(request):
    if request.app[STATE]['owner'] is not None:
        raise web.HTTPConflict(text='Serial controller already in use')
    target=request.query.get('port','')
    if target not in {p['path'] for p in ports()}:
        raise web.HTTPBadRequest(text='Select a currently enumerated Espressif device')
    # Reserve BEFORE opening or awaiting, so two browsers cannot own one motor.
    request.app[STATE]['owner']=object()
    dev=None; task=None; ws=web.WebSocketResponse(max_msg_size=1024,heartbeat=10)
    try:
        dev=serial.Serial(port=None,baudrate=115200,timeout=0,write_timeout=.15,exclusive=True)
        dev.dtr=False;dev.rts=False;dev.port=target;dev.open()
        await ws.prepare(request)
        async def receive_serial():
            buf=b''
            while not ws.closed:
                chunk=dev.read(4096)
                if chunk:
                    buf+=chunk
                    if len(buf)>16384:raise RuntimeError('Serial frame too long')
                    while b'\n' in buf:
                        line,buf=buf.split(b'\n',1)
                        if line:await ws.send_str(line.decode('utf-8',errors='replace'))
                await asyncio.sleep(.01)
        async def pump():
            try:await receive_serial()
            except (serial.SerialException,OSError,RuntimeError) as e:
                await ws.close(code=1011,message=str(e).encode()[:120])
        task=asyncio.create_task(pump())
        async for msg in ws:
            if msg.type==WSMsgType.TEXT:
                text=msg.data
                if len(text.encode())>768 or '\n' in text or '\r' in text or '\0' in text:
                    await ws.close(code=1008,message=b'Invalid command frame');break
                try:
                    obj=json.loads(text)
                    if not isinstance(obj,dict):raise ValueError('Object required')
                    if dev.write((text+'\n').encode())!=len((text+'\n').encode()):raise OSError('Partial serial write')
                except (ValueError,serial.SerialException,OSError):
                    await ws.close(code=1011,message=b'Serial write failed');break
            elif msg.type==WSMsgType.ERROR:break
    except (serial.SerialException,OSError) as e:
        if ws.prepared:await ws.close(code=1011,message=str(e).encode()[:120])
        else:raise web.HTTPConflict(text='Serial unavailable: '+str(e))
    finally:
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):await task
        if dev:
            # No generated heartbeat: a closed/frozen page always expires the MCU lease.
            # Immediate stop policy is implemented by page disconnect; the MCU timeout
            # remains active even when stopOnDisconnect is false.
            with contextlib.suppress(Exception):dev.close()
        request.app[STATE]['owner']=None
    return ws

def make_app(port=8766):
    app=web.Application(middlewares=[origin_guard],client_max_size=2048)
    hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
    app[STATE]={'owner':None,'allowed_hosts':hosts,'allowed_origins':{f'http://{h}' for h in hosts}}
    app.router.add_get('/',index);app.router.add_get('/api/ports',port_list);app.router.add_get('/api/health',health)
    app.router.add_get('/ws',websocket)
    app.router.add_static('/src/',ROOT/'web/src',show_index=False)
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8766)
    args=parser.parse_args()
    web.run_app(make_app(args.port),host='127.0.0.1',port=args.port,print=print)
