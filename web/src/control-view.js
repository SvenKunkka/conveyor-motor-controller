import {HARDWARE_PROFILE} from './hardware-profile.js';

// Preview the requested duty separately from the device-reported output.
export function dutyPlan(value,deviceLimit=null) {
  const requested=typeof value==='string' && value.trim()==='' ? NaN : Number(value);
  const valid=Number.isInteger(requested) && requested>=0 && requested<=100;
  const knownLimit=Number.isInteger(deviceLimit) && deviceLimit>=1 && deviceLimit<=100;
  const limit=knownLimit?deviceLimit:HARDWARE_PROFILE.verifiedSettings.maxDuty;
  return {valid,requested:valid?requested:null,limit,effective:valid?Math.min(requested,limit):null,
    clamped:valid && requested>limit,deviceLimitKnown:knownLimit};
}

export function profileState(settings,live) {
  if(!live || !settings)return {state:'offline',label:'实测配置 · 等待读取设备'};
  const match=Object.entries(HARDWARE_PROFILE.verifiedSettings).every(([key,value])=>settings[key]===value);
  return match?{state:'match',label:'设备参数与实测配置一致'}:{state:'different',label:'设备参数与实测配置不同'};
}

export function describeReason(state,live) {
  if(!live || !state)return '连接设备后读取输出状态';
  if(state.locked)return '急停锁定 · 解除后仍需手动启用';
  if(!state.ready)return '设备未就绪 · 请查看连接详情';
  if(state.reason==='command_timeout')return '通信超时已停止 · 重新启用后才能运行';
  if(state.mode==='direction_delay')return '换向缓冲中 · 当前输出为 0%';
  if(state.mode==='forward' || state.mode==='reverse')return '设备正在输出 PWM · 实际转动以现场为准';
  return state.armed?'已启用 · 选择一个方向启动':'已停止 · 先启用，再选择方向';
}

// This only creates form values; applying the profile never sends a command.
export function benchFormValues(current={}) {
  return {...current,...HARDWARE_PROFILE.verifiedSettings};
}
