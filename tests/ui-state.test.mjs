import test from 'node:test';
import assert from 'node:assert/strict';
import {controlNotice,controlStateChanged} from '../web/src/ui-state.js';

const stopped={ready:true,locked:false,armed:false,mode:'stopped',duty:0,reason:'stopped'};
const view=(state,other={})=>controlNotice({live:true,state:{...stopped,...state},...other});

test('a new report replaces an enabled banner after disarm or timeout',()=>{
  assert.match(view({armed:true}).text,/控制已启用/);
  assert.match(view({}).text,/控制未启用/);
  const timeout=view({reason:'command_timeout'});
  assert.match(timeout.text,/通信超时保护已触发/);
  assert.doesNotMatch(timeout.text,/控制已启用/);
  assert.equal(timeout.error,true);
});

test('device lock always overrides enabled, running, and feedback messages',()=>{
  const notice=view({locked:true,armed:true,mode:'forward',duty:20},{feedback:{text:'已读取设备当前参数。',error:false}});
  assert.match(notice.text,/^急停已锁定/);
  assert.doesNotMatch(notice.text,/控制已启用|正转输出/);
  assert.match(notice.text,/已读取设备当前参数/);
  assert.equal(notice.error,true);
});

test('clearing the local request lock clears waiting text immediately',()=>{
  assert.match(view({}, {localLock:true}).text,/正在等待设备确认/);
  const cleared=view({}, {localLock:false});
  assert.doesNotMatch(cleared.text,/等待设备确认/);
  assert.match(cleared.text,/控制未启用/);
  assert.equal(cleared.error,false);
});

test('a newly connected locked session shows the device lock',()=>{
  const notice=view({locked:true,reason:'emergency_stop'},{localLock:false});
  assert.match(notice.text,/^急停已锁定/);
  assert.doesNotMatch(notice.text,/点击.*使能|控制已启用/);
});

test('running facts remain visible together with command errors and saved settings',()=>{
  const running={armed:true,mode:'reverse',duty:22,reason:'running'};
  const failure=view(running,{feedback:{text:'E_RANGE',error:true}});
  assert.match(failure.text,/^固件回报反转输出，PWM 22%/);
  assert.match(failure.text,/E_RANGE/);
  assert.equal(failure.error,true);
  assert.match(view(running,{feedback:{text:'参数已收到设备保存确认。'}}).text,/PWM 22%.*保存确认/);
});

test('offline reports do not present an old output state as current',()=>{
  const notice=view({armed:true,mode:'forward',duty:20},{live:false,feedback:{text:'设备状态已过期',error:true}});
  assert.match(notice.text,/^设备离线，输出状态未知/);
  assert.doesNotMatch(notice.text,/正转输出|控制已启用/);
});

test('heartbeat reports and runtime updates do not bury command logs',()=>{
  assert.equal(controlStateChanged(null,stopped),true);
  for(let runMs=0;runMs<240000;runMs+=200)
    assert.equal(controlStateChanged({...stopped,runMs:runMs-200},{...stopped,runMs}),false);
  assert.equal(controlStateChanged(stopped,{...stopped,locked:true}),true);
  assert.equal(controlStateChanged(stopped,{...stopped,reason:'command_timeout'}),true);
  assert.equal(controlStateChanged({...stopped,armed:true,mode:'forward',duty:20},{...stopped,armed:true,mode:'forward',duty:21}),true);
});
