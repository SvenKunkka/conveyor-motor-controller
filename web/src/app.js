import {Protocol} from './protocol.js';
import {controlNotice,controlStateChanged} from './ui-state.js';
import {HARDWARE_PROFILE,DISPLAY_MODES,rawActionForDisplay,displayState,directionLog} from './hardware-profile.js';
import {dutyPlan,profileState,describeReason,benchFormValues} from './control-view.js';
const UI_VERSION='2.0.0';
const $=id=>document.getElementById(id);
let client=null, transport=null, state=null, heartbeat=null, sliderTimer=null, connecting=false;
let eventLog=[],settingsLoaded=false,localLock=false,feedback=null;
const modes=DISPLAY_MODES;
function log(message) {
  eventLog.push({time:new Date().toISOString(),message});if(eventLog.length>1000)eventLog.shift();
  $('log').textContent=eventLog.slice(-50).map(x=>`${new Date(x.time).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}  ${x.message}`).join('\n');
  $('log').scrollTop=$('log').scrollHeight;
}
function renderNotice(){
  const value=controlNotice({live:usable(),state:displayState(state?.state),localLock,feedback});
  $('notice').textContent=value.text;$('notice').classList.toggle('error',value.error);
}
function notice(text,error=false){feedback={text,error};renderNotice();}
function usable(){return client?.valid && Date.now()-client.lastSeen<1200;}
function render() {
  const live=usable(),s=state?.state,display=displayState(s);
  const plan=dutyPlan($('speed').value,live?state.settings.maxDuty:null);
  renderNotice();
  $('connection').textContent=live?'● 已连接':'● 离线 / 状态未知';$('connection').classList.toggle('live',!!live);
  $('connect').disabled=connecting||!!transport;$('reconnect').disabled=connecting;
  $('disconnect').disabled=!transport||connecting;
  $('transport').disabled=!!transport||connecting;$('ports').disabled=!!transport||connecting;
  $('mode').textContent=live?(modes[display.mode]||display.mode):'状态未知';
  $('actual').textContent=live?s.duty:'—';$('armedLabel').textContent=live?(s.locked?'急停已锁定':s.armed?'控制已启用':'未启用'):'未验证';
  $('linkStatus').textContent=live?'固件已确认':'未验证 / 过期';
  $('target').textContent=live?(modes[display.targetDirection]||display.targetDirection):'—';
  $('runtime').textContent=live?`${(s.runMs/1000).toFixed(1)} s`:'—';
  $('freqStatus').textContent=live?`${state.settings.frequency/1000} kHz`:'—';
  $('reason').textContent=live?s.reason:'等待固件状态';
  $('lastSeen').textContent=client?.lastSeen?new Date(client.lastSeen).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
  const canMove=live&&s.ready&&s.armed&&!s.locked&&!localLock&&plan.valid;
  for(const id of ['forward','reverse'])$(id).disabled=!canMove;
  for(const id of ['stop','emergency','disarm','readSettings'])$(id).disabled=!live;
  $('arm').disabled=!live||!s.ready||s.locked||s.armed||localLock;
  $('unlock').disabled=!live||!s.locked;
  $('save').disabled=!live||s.armed||s.mode!=='stopped';
  if($('applyProfile'))$('applyProfile').disabled=!!(live&&(s.armed||s.mode!=='stopped'));
  if($('dutyPreview'))$('dutyPreview').textContent=plan.valid?`${plan.effective}%`:'—';
  if($('dutyHint')){
    $('dutyHint').textContent=!plan.valid?'请输入 0–100 的整数':plan.clamped?
      `请求 ${plan.requested}%，将限制为 ${plan.limit}%。提高滑块不会突破设备上限。`:
      live?`指令最多 ${plan.limit}%。这里是请求值，设备输出见左侧回报。`:
      `按实测上限 ${plan.limit}% 预览，连接后以设备参数为准。`;
    $('dutyHint').classList.toggle('is-limited',plan.clamped||!plan.valid);
  }
  $('slider').style.setProperty('--range-progress',`${plan.valid?plan.requested:0}%`);
  $('slider').style.setProperty('--range-limit',`${plan.limit}%`);
  if($('profileMatch')){
    const profile=profileState(state?.settings,live);
    $('profileMatch').textContent=profile.label;$('profileMatch').dataset.state=profile.state;
  }
  if($('reasonText'))$('reasonText').textContent=live&&s.armed&&!plan.valid?'请输入有效占空比，再选择方向':describeReason(display,live);
  if($('outputBar'))$('outputBar').style.width=`${live?s.duty:0}%`;
  if($('outputVisual')){
    $('outputVisual').dataset.mode=live?display.mode:'offline';
    $('outputVisual').dataset.connected=String(!!live);
    $('outputVisual').dataset.locked=String(!!(live&&s.locked));
  }
}
function loadSettings(){
  if(!state)return;
  for(const [key,val] of Object.entries(state.settings)) {
    const el=$('settings').elements.namedItem(key);if(!el)continue;
    if(el.type==='checkbox')el.checked=val;else el.value=val;
  }
  $('limit').textContent=`固件上限 ${state.settings.maxDuty}%`;settingsLoaded=true;
}
function onState(m){
  const previous=state?.state;
  state=m;$('firmware').textContent=m.firmware;
  if(!settingsLoaded){loadSettings();$('speed').value=$('slider').value=m.settings.defaultDuty;}
  $('limit').textContent=`固件上限 ${m.settings.maxDuty}%`;
  // Heartbeat ACKs do not consume the bounded log unless device state changed.
  if(controlStateChanged(previous,m.state))
    log(`STATE ${directionLog(m.state.mode)} · target=${directionLog(m.state.targetDirection)} · ${m.state.duty}% · armed=${m.state.armed} · locked=${m.state.locked} · ${m.state.reason}`);
  render();
}
async function fault(message){
  clearInterval(heartbeat);heartbeat=null;clearTimeout(sliderTimer);localLock=true;
  notice(message,true);log('FAULT '+message);
  client?.close();const old=transport;transport=null;
  render();if(old)try{await old.close();}catch{}
}
async function webSerial() {
  if(!navigator.serial)throw new Error('此浏览器不支持 Web Serial，请选择本机串口服务');
  const allowed=(await navigator.serial.getPorts()).filter(port=>{
    const info=port.getInfo();return info.usbVendorId===0x303a&&info.usbProductId===0x1001;
  });
  const port=allowed.length===1?allowed[0]:await navigator.serial.requestPort({filters:[{usbVendorId:0x303a,usbProductId:0x1001}]});
  await port.open({baudRate:115200,bufferSize:8192});
  let reader=port.readable.getReader(),writer=port.writable.getWriter(),closing=false;
  const decoder=new TextDecoder();let buffer='';
  const pump=(async()=>{
    try {
      while(!closing){const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});if(buffer.length>16384)throw new Error('串口数据异常');
        let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);client?.receive(line);}
      }
      if(!closing)client?.fail('USB 串口已断开');
    }catch(e){if(!closing)client?.fail(e.message);}finally{reader.releaseLock();}
  })();
  return {name:'Espressif USB · 303A:1001',send:line=>writer.write(new TextEncoder().encode(line)),
    async close(){closing=true;await reader.cancel().catch(()=>{});await pump;writer.releaseLock();await port.close();}};
}
async function relay() {
  const path=$('ports').value;if(!path)throw new Error('没有可连接的 Espressif 串口，请接入后刷新');
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?port=${encodeURIComponent(path)}`);
  await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>{ws.close();reject(new Error('本机服务连接超时'));},3000);
    ws.onopen=()=>{clearTimeout(t);resolve();};ws.onerror=()=>{clearTimeout(t);reject(new Error('本机串口服务连接失败，设备可能被旧面板占用'));};
  });
  let closing=false;
  ws.onmessage=e=>client?.receive(e.data);ws.onclose=()=>{if(!closing)client?.fail('本机串口连接已断开');};
  return {name:path,send(line){if(ws.readyState!==WebSocket.OPEN)throw new Error('连接关闭');ws.send(line.trim());},
    async close(){closing=true;ws.close();}};
}
async function connect(){
  if(connecting)return;connecting=true;render();
  try {
    if(transport)await disconnect();
    state=null;settingsLoaded=false;localLock=false;feedback=null;
    transport=await ($('transport').value==='serial'?webSerial():relay());
    $('device').textContent=transport.name;
    client=new Protocol(line=>transport.send(line),onState,message=>{void fault(message);});
    await client.command({cmd:'hello'});
    await client.command({cmd:'heartbeat'});
    heartbeat=setInterval(()=>{
      if(!client?.valid||document.hidden)return;
      if(Date.now()-client.lastSeen>1200){client.fail('设备状态已过期，请重新连接');return;}
      client.command({cmd:'heartbeat'}).catch(()=>{});
    },200);
    render();log('连接完成；没有自动启动电机');
  }catch(e){await fault(e.message);}finally{connecting=false;render();}
}
async function disconnect(){
  clearInterval(heartbeat);heartbeat=null;clearTimeout(sliderTimer);
  if(client?.valid && state?.settings.stopOnDisconnect) {
    try{await client.command({cmd:'disarm'});}catch{}
  }
  client?.close();client=null;
  const old=transport;transport=null;if(old)try{await old.close();}catch{}
  render();notice('连接已关闭。若未收到停止确认，请等待固件超时保护或切断电机电源。');
}
async function send(body){
  if(!usable())throw new Error('固件未连接或状态已过期');
  feedback=null;renderNotice();log('TX '+JSON.stringify(body));
  try{
    const reply=await client.command(body);
    log(`ACK #${reply.id} ${reply.code} · ${directionLog(reply.state.mode)} · target=${directionLog(reply.state.targetDirection)} · ${reply.state.duty}%`);return reply;
  }catch(e){log(`ACK ERROR ${body.cmd} · ${e.message}`);throw e;}
}
function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>{notice(e.message,true);log('ERROR '+e.message);}));}
action('connect',connect);action('reconnect',connect);action('disconnect',disconnect);
action('forward',()=>send({cmd:'motor',action:rawActionForDisplay('forward'),speed:Number($('speed').value)}));
action('reverse',()=>send({cmd:'motor',action:rawActionForDisplay('reverse'),speed:Number($('speed').value)}));
action('stop',()=>{clearTimeout(sliderTimer);return send({cmd:'motor',action:'stop'});});
action('emergency',async()=>{clearTimeout(sliderTimer);localLock=true;render();await send({cmd:'motor',action:'emergency_stop'});localLock=false;render();});
action('unlock',async()=>{await send({cmd:'clear_emergency'});localLock=false;render();});
action('arm',async()=>{await send({cmd:'heartbeat'});await send({cmd:'arm'});render();});
action('disarm',()=>send({cmd:'disarm'}));
action('readSettings',async()=>{await send({cmd:'get_settings'});loadSettings();notice('已读取设备当前参数。');});
if($('applyProfile'))action('applyProfile',()=>{
  const form=$('settings');
  const values=benchFormValues(Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el.type==='checkbox'?el.checked:Number(el.value)])));
  for(const [key,value] of Object.entries(values)){
    const el=form.elements.namedItem(key);if(!el)continue;
    if(el.type==='checkbox')el.checked=value;else el.value=value;
  }
  const panel=form.closest('details');if(panel)panel.open=true;
  notice('已填入实测配置：1kHz、默认30%、上限30%。点击保存后才会写入设备。');
});
function speedChanged(e) {
  const plan=dutyPlan(e.target.value,state?.settings.maxDuty),value=plan.requested;
  if(!plan.valid){clearTimeout(sliderTimer);notice('占空比应为 0–100 的整数',true);render();return;}
  $('speed').value=$('slider').value=value;clearTimeout(sliderTimer);
  render();
  if(usable() && state.state.armed && !state.state.locked && !localLock)
    sliderTimer=setTimeout(()=>send({cmd:'set_speed',value}).catch(e=>notice(e.message,true)),100);
}
$('slider').addEventListener('input',speedChanged);$('speed').addEventListener('input',speedChanged);
document.querySelectorAll('[data-duty]').forEach(button=>button.addEventListener('click',()=>{
  $('speed').value=button.dataset.duty;speedChanged({target:$('speed')});
}));
$('settings').addEventListener('submit',async e=>{
  e.preventDefault();if(!$('settings').reportValidity())return;
  const settings={};for(const el of $('settings').elements)if(el.name)settings[el.name]=el.type==='checkbox'?el.checked:Number(el.value);
  if(settings.defaultDuty>settings.maxDuty){notice('默认启动占空比不得超过最大占空比',true);return;}
  try{await send({cmd:'set_settings',settings});await send({cmd:'save_settings'});await send({cmd:'get_settings'});loadSettings();notice('参数已收到设备保存确认。重新上电读取仍需实机验证。');}
  catch(e){notice(e.message,true);}
});
async function refresh(){
  const response=await fetch('/api/ports');if(!response.ok)throw new Error('本机服务不可用');
  const data=await response.json();$('ports').replaceChildren();
  for(const p of data.ports){const option=document.createElement('option');option.value=p.path;option.textContent=`${p.path} · ${p.serial||p.description}`;$('ports').append(option);}
  if(!data.ports.length){const option=document.createElement('option');option.value='';option.textContent='未发现 Espressif USB 设备';$('ports').append(option);}
}
action('refresh',refresh);
$('transport').addEventListener('change',()=>{
  $('portLabel').hidden=$('transport').value!=='relay';
  try{localStorage.setItem('conveyor.transport.v2',$('transport').value);}catch{}
});
action('export',()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob(eventLog.map(x=>JSON.stringify(x)+'\n'),{type:'application/x-ndjson'}));a.href=url;a.download=`conveyor-${new Date().toISOString().slice(0,10)}.jsonl`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearTimeout(sliderTimer);if(client?.valid&&state?.settings.stopOnDisconnect)client.command({cmd:'disarm'}).catch(()=>{});}
  else if(client?.valid)client.command({cmd:'get_status'}).catch(()=>{});
});
window.addEventListener('pagehide',()=>{clearInterval(heartbeat);if(client?.valid&&state?.settings.stopOnDisconnect)client.command({cmd:'disarm'}).catch(()=>{});});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!event.repeat&&usable()){
    event.preventDefault();$('emergency').click();
  }
});
let savedTransport=null;try{savedTransport=localStorage.getItem('conveyor.transport.v2');}catch{}
$('transport').value=!navigator.serial?'relay':['serial','relay'].includes(savedTransport)?savedTransport:'serial';
$('portLabel').hidden=$('transport').value!=='relay';
$('transportHint').textContent=navigator.serial?'支持 Web Serial；也可使用本机服务':'使用 Python 本机串口服务';
$('directionCalibration').textContent=HARDWARE_PROFILE.directionNote;
if($('uiVersion'))$('uiVersion').textContent=`UI ${UI_VERSION}`;
refresh().catch(e=>log(e.message));setInterval(render,250);render();
