import test from 'node:test';
import assert from 'node:assert/strict';
import {HARDWARE_PROFILE,rawActionForDisplay,displayDirection,displayState,directionLog} from '../web/src/hardware-profile.js';
import {controlNotice} from '../web/src/ui-state.js';

test('calibrated clockwise and counterclockwise commands round trip to the displayed direction',()=>{
  assert.equal(rawActionForDisplay('forward'),'reverse');
  assert.equal(rawActionForDisplay('reverse'),'forward');
  for(const direction of ['forward','reverse'])assert.equal(displayDirection(rawActionForDisplay(direction)),direction);
});

test('state and target use the calibration without changing raw safety fields',()=>{
  const raw=Object.freeze({mode:'reverse',targetDirection:'forward',armed:true,locked:false,ready:true,duty:30,reason:'running'});
  const display=displayState(raw);
  assert.equal(display.mode,'forward');
  assert.equal(display.targetDirection,'reverse');
  assert.equal(raw.mode,'reverse');
  for(const field of ['armed','locked','ready','duty','reason'])assert.equal(display[field],raw[field]);
});

test('stops, emergency commands, and pending modes are never converted into movement',()=>{
  for(const value of ['stop','stopped','emergency_stop','direction_delay','pending',null,undefined]) {
    assert.equal(rawActionForDisplay(value),value);
    assert.equal(displayDirection(value),value);
  }
  const display=displayState({mode:'direction_delay',targetDirection:'reverse',duty:0,locked:false});
  assert.equal(display.mode,'direction_delay');
  assert.equal(display.targetDirection,'forward');
  assert.equal(display.duty,0);
  assert.equal(displayState(null),null);
});

test('live banner reports the same calibrated direction as buttons and target',()=>{
  const raw={mode:'reverse',targetDirection:'reverse',ready:true,armed:true,locked:false,duty:30,reason:'running'};
  const displayed=displayState(raw);
  assert.equal(displayed.mode,displayed.targetDirection);
  const banner=controlNotice({live:true,state:displayed});
  assert.match(banner.text,/正转输出，PWM 30%/);
  assert.doesNotMatch(banner.text,/反转输出/);
  assert.match(controlNotice({live:true,state:displayState({...raw,locked:true,duty:0})}).text,/^急停已锁定/);
});

test('diagnostic logs retain both the calibrated label and unmodified raw direction',()=>{
  assert.equal(directionLog('reverse'),'正转 · 顺时针 [raw=reverse]');
  assert.equal(directionLog('forward'),'反转 · 逆时针 [raw=forward]');
  assert.equal(directionLog('stopped'),'停止 [raw=stopped]');
});

test('bench settings are a frozen record and do not supply automatic device commands',()=>{
  assert.deepEqual(HARDWARE_PROFILE.verifiedSettings,{frequency:1000,defaultDuty:30,maxDuty:30});
  assert.equal(Object.isFrozen(HARDWARE_PROFILE),true);
  assert.equal(Object.isFrozen(HARDWARE_PROFILE.verifiedSettings),true);
  assert.match(HARDWARE_PROFILE.directionNote,/输出轴端/);
});
