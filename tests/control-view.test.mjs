import test from 'node:test';
import assert from 'node:assert/strict';
import {dutyPlan,profileState,describeReason,benchFormValues} from '../web/src/control-view.js';

test('requested duty is distinct from the firmware limit and actual output',()=>{
  assert.deepEqual(dutyPlan('71',30),{valid:true,requested:71,limit:30,effective:30,clamped:true,deviceLimitKnown:true});
  assert.equal(dutyPlan(0,30).effective,0);
  assert.equal(dutyPlan(30,30).clamped,false);
  assert.equal(dutyPlan(100,75).effective,75);
});

test('invalid inputs cannot produce a runnable duty request',()=>{
  for(const value of ['', ' ', '-1','101','NaN','30.5',Infinity])assert.equal(dutyPlan(value,30).valid,false);
  const preview=dutyPlan(30);assert.equal(preview.limit,30);assert.equal(preview.deviceLimitKnown,false);
});

test('the live profile badge reflects device settings, never the local form',()=>{
  assert.equal(profileState({frequency:1000,defaultDuty:30,maxDuty:30},true).state,'match');
  assert.equal(profileState({frequency:20000,defaultDuty:30,maxDuty:30},true).state,'different');
  assert.equal(profileState({frequency:1000,defaultDuty:30,maxDuty:30},false).state,'offline');
});

test('stale state cannot show running or ready to start',()=>{
  const moving={mode:'forward',armed:true,locked:false,ready:true,reason:'running'};
  assert.match(describeReason(moving,false),/连接设备/);
  assert.match(describeReason({...moving,locked:true},true),/急停锁定/);
  assert.match(describeReason({...moving,mode:'stopped',armed:false},true),/先启用/);
});

test('loading the bench profile preserves other form fields without mutating device settings',()=>{
  const device=Object.freeze({frequency:20000,defaultDuty:20,maxDuty:30,timeoutMs:1800,stopOnDisconnect:false});
  assert.deepEqual(benchFormValues(device),{frequency:1000,defaultDuty:30,maxDuty:30,timeoutMs:1800,stopOnDisconnect:false});
  assert.equal(device.frequency,20000);
});
