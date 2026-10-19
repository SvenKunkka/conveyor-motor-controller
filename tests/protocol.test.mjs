import test from 'node:test';
import assert from 'node:assert/strict';
import {Protocol} from '../web/src/protocol.js';
const ack=(id,extra={})=>({type:'ack',id,protocol:1,ok:true,code:'OK',firmware:'conveyor-1.0.0',chip:'ESP32-S3',flashBytes:8388608,boot:50,session:60,state:{duty:0},settings:{},...extra});
test('no optimistic state; hello validates identity',async()=>{
 const states=[],sent=[];const p=new Protocol(x=>sent.push(x),s=>states.push(s),()=>{});
 const hello=p.command({cmd:'hello'});assert.equal(states.length,0);
 p.receive(JSON.stringify(ack(1,{firmware:'old-firmware'})));assert.equal(p.valid,false);
 p.receive(JSON.stringify(ack(1)));await hello;assert.equal(p.valid,true);assert.equal(states.length,1);p.close();
});
test('wrong id does not acknowledge command; errors reject',async()=>{
 const p=new Protocol(()=>{},()=>{},()=>{});const h=p.command({cmd:'hello'});p.receive(JSON.stringify(ack(1)));await h;
 const move=p.command({cmd:'motor',action:'forward',speed:20});
 p.receive(JSON.stringify(ack(999)));assert.equal(p.pending.size,1);
 p.receive(JSON.stringify(ack(2,{ok:false,code:'E_NOT_ARMED'})));await assert.rejects(move,/E_NOT_ARMED/);p.close();
});
test('reset invalidates session, forbids further moves',async()=>{
 const faults=[];const p=new Protocol(()=>{},()=>{},e=>faults.push(e));const h=p.command({cmd:'hello'});p.receive(JSON.stringify(ack(1)));await h;
 p.receive(JSON.stringify(ack(0,{type:'status',boot:51})));assert.equal(p.valid,false);assert.equal(faults.length,1);
 await assert.rejects(p.command({cmd:'motor'}));
});
test('missing acknowledgement fails closed',async()=>{
 const faults=[];const p=new Protocol(()=>{},()=>{},e=>faults.push(e),20);
 await assert.rejects(p.command({cmd:'hello'}),/应答超时/);assert.equal(p.closed,true);assert.equal(faults.length,1);
});
test('transport failure cancels pending work',async()=>{
 const p=new Protocol(()=>{throw new Error('USB lost')},()=>{},()=>{});
 await assert.rejects(p.command({cmd:'hello'}),/USB lost/);assert.equal(p.closed,true);assert.equal(p.pending.size,0);
});
