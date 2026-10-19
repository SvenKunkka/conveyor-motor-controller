// Project-specific mapping: raw forward was observed CCW on 2026-10-19.
// Both CW/CCW directions were observed from the output-shaft end on 2026-10-19.
// Firmware directions remain unchanged; only this UI translates the physical convention.
const displayToRaw=Object.freeze({forward:'reverse',reverse:'forward'});
const rawToDisplay=Object.freeze(Object.fromEntries(Object.entries(displayToRaw).map(([display,raw])=>[raw,display])));

export const HARDWARE_PROFILE=Object.freeze({
  id:'atoms3-lite-n20-6v-150rpm-20261019',
  displayToRaw,
  directionNote:'按当前输出轴端视角约定：正转为顺时针、反转为逆时针。更换电机线序后需重新校准。',
  // A record of the confirmed bench configuration, never automatically written to the device.
  verifiedSettings:Object.freeze({frequency:1000,defaultDuty:30,maxDuty:30}),
});

export const DISPLAY_MODES=Object.freeze({stopped:'停止',forward:'正转 · 顺时针',reverse:'反转 · 逆时针',direction_delay:'换向等待'});
export const rawActionForDisplay=action=>Object.hasOwn(displayToRaw,action)?displayToRaw[action]:action;
export const displayDirection=raw=>Object.hasOwn(rawToDisplay,raw)?rawToDisplay[raw]:raw;

export function displayState(rawState) {
  if(!rawState)return rawState;
  return {...rawState,mode:displayDirection(rawState.mode),targetDirection:displayDirection(rawState.targetDirection)};
}

export function directionLog(raw) {
  const display=displayDirection(raw);
  return `${DISPLAY_MODES[display]||display} [raw=${raw}]`;
}
