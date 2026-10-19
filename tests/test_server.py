import asyncio,importlib.util,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
from aiohttp.test_utils import TestClient,TestServer
spec=importlib.util.spec_from_file_location('relay',Path(__file__).resolve().parents[1]/'tools/server.py')
relay=importlib.util.module_from_spec(spec);spec.loader.exec_module(relay)
class FakeSerial:
    instances=[]
    def __init__(self,**kwargs):self.writes=[];self.is_open=False;self.instances.append(self)
    def open(self):self.is_open=True
    def close(self):self.is_open=False
    def read(self,n):return b''
    def write(self,b):self.writes.append(b);return len(b)
class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        FakeSerial.instances=[]
        self.app=relay.make_app();self.client=TestClient(TestServer(self.app));await self.client.start_server()
        host=f'127.0.0.1:{self.client.port}';self.origin='http://'+host
        self.app[relay.STATE]['allowed_hosts']={host};self.app[relay.STATE]['allowed_origins']={self.origin}
    async def asyncTearDown(self):await self.client.close()
    async def test_cross_origin_and_bad_host_rejected(self):
        r=await self.client.get('/api/ports',headers={'Origin':'https://untrusted.example'});self.assertEqual(r.status,403)
        r=await self.client.get('/api/ports',headers={'Host':'untrusted.example'});self.assertEqual(r.status,403)
    async def test_unknown_serial_rejected_before_open(self):
        with patch.object(relay,'ports',return_value=[]),patch.object(relay.serial,'Serial',FakeSerial):
            r=await self.client.get('/ws?port=/dev/cu.wrong',headers={'Origin':self.origin});self.assertEqual(r.status,400)
            self.assertEqual(FakeSerial.instances,[])
    async def test_single_owner_no_synthetic_heartbeat_and_close(self):
        with patch.object(relay,'ports',return_value=[{'path':'fake'}]),patch.object(relay.serial,'Serial',FakeSerial):
            ws=await self.client.ws_connect('/ws?port=fake',origin=self.origin)
            d=FakeSerial.instances[0];await asyncio.sleep(.05);self.assertEqual(d.writes,[])
            r=await self.client.get('/ws?port=fake',headers={'Origin':self.origin});self.assertEqual(r.status,409)
            await ws.send_str('{"cmd":"get_status","id":1}')
            await asyncio.sleep(.05);self.assertEqual(d.writes,[b'{"cmd":"get_status","id":1}\n'])
            await ws.close();await asyncio.sleep(.05);self.assertFalse(d.is_open)
            self.assertEqual(len(d.writes),1)
    async def test_multiline_rejected(self):
        with patch.object(relay,'ports',return_value=[{'path':'fake'}]),patch.object(relay.serial,'Serial',FakeSerial):
            ws=await self.client.ws_connect('/ws?port=fake',origin=self.origin)
            await ws.send_str('{}\n{}');await ws.receive();self.assertEqual(FakeSerial.instances[0].writes,[])
