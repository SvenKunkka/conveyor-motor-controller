// Rebuild the banner from each firmware report; action feedback never becomes state.
export function controlStateChanged(previous,current) {
  return !previous || ['mode','duty','targetDirection','armed','locked','ready','reason'].some(key=>previous[key]!==current[key]);
}

export function controlNotice({live,state,localLock=false,feedback=null}) {
  let text,error=false;
  if(!live || !state)text='设备离线，输出状态未知。';
  else if(state.locked){text='急停已锁定，固件回报输出已停止。解除锁定不会自动运行。';error=true;}
  else if(localLock){text='急停已请求，正在等待设备确认；以实时输出回报为准。';error=true;}
  else if(!state.ready){text=`固件未就绪，无法启用控制；原因：${state.reason}。`;error=true;}
  else if(state.reason==='command_timeout'){text='通信超时保护已触发，固件回报输出已停止、控制已停用。恢复通信后仍需手动启用。';error=true;}
  else if(state.mode==='direction_delay')text='固件正在换向缓冲，当前 PWM 为 0%。';
  else if(state.mode==='forward' || state.mode==='reverse')
    text=`固件回报${state.mode==='forward'?'正转':'反转'}输出，PWM ${state.duty}%。无传感器反馈，实际转动需现场观察。`;
  else if(state.armed)text='控制已启用，当前输出已停止；正转或反转按钮会启动输出。';
  else text='固件回报输出已停止，控制未启用。';
  if(feedback?.text){text+=` ${feedback.text}`;error ||= !!feedback.error;}
  return {text,error};
}
