// Device state changes only after a validated firmware response.
export class Protocol {
  constructor(send,onState,onFault,timeout=900) {
    this.send=send;this.onState=onState;this.onFault=onFault;this.timeout=timeout;
    this.id=0;this.session=0;this.boot=null;this.pending=new Map();this.lastSeen=0;
    this.valid=false;this.closed=false;
  }
  receive(line) {
    let m;try{m=JSON.parse(line);}catch{return;}
    if(m.protocol!==1 || !['ack','status'].includes(m.type) ||
      m.firmware!=='conveyor-1.0.0' || m.chip!=='ESP32-S3' || m.flashBytes!==8388608 ||
      !m.state || !m.settings || typeof m.state.duty!=='number')return;
    const p=this.pending.get(m.id);
    if(p?.hello && m.type==='ack' && m.ok) {
      this.session=m.session;this.boot=m.boot;this.valid=true;
    }
    if(!this.valid)return;
    if(m.boot!==this.boot || m.session!==this.session) {
      this.fail('设备已重启或控制会话已变更，请重新连接');return;
    }
    this.lastSeen=Date.now();this.onState(m);
    if(m.type==='ack' && p) {
      clearTimeout(p.timer);this.pending.delete(m.id);
      m.ok?p.resolve(m):p.reject(new Error(m.code));
    }
  }
  command(body) {
    if(this.closed)return Promise.reject(new Error('连接已关闭'));
    if(!this.valid && body.cmd!=='hello')return Promise.reject(new Error('尚未验证固件'));
    if(this.pending.size>=8)return Promise.reject(new Error('指令繁忙，请停止后重试'));
    const id=++this.id, msg={...body,id,session:this.session};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);reject(new Error('固件应答超时；停止心跳，等待硬件超时保护'));
        this.fail('通信超时，状态未知；必要时切断电机电源');
      },this.timeout);
      this.pending.set(id,{resolve,reject,timer,hello:body.cmd==='hello'});
      Promise.resolve().then(()=>this.send(JSON.stringify(msg)+'\n')).catch(e=>{
        clearTimeout(timer);this.pending.delete(id);reject(e);this.fail(e.message);
      });
    });
  }
  fail(message) {if(this.closed)return;this.close();this.onFault(message);}
  close() {
    this.closed=true;this.valid=false;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('连接已关闭'));}
    this.pending.clear();
  }
}
