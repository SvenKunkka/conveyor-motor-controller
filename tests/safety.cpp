#include <cassert>
#include <iostream>
#include "MotorCore.h"
void ready(MotorCore& m,uint32_t t=1){m.ready=true;m.heartbeat(t);assert(!m.arm(t));}
int main(){
  MotorCore m;assert(m.duty==0&&!m.armed&&!m.pending);assert(m.move(1,20,0));
  ready(m);assert(!m.move(1,100,2));assert(m.duty==30); // firmware clamp
  assert(!m.move(-1,20,100));assert(m.pending&&m.duty==0&&m.actualDirection==0);
  m.tick(399,true,false);assert(m.duty==0);m.tick(400,true,false);assert(m.duty==20&&m.actualDirection==-1);
  m.stop(450,"test");assert(!m.move(1,20,451));assert(m.pending); // STOP cannot bypass dead time
  m.emergency(452);m.tick(900,true,false);assert(m.duty==0&&m.locked&&!m.armed&&!m.pending);
  assert(m.arm(900));assert(m.move(1,20,900));
  MotorCore timeout;ready(timeout);timeout.move(1,20,2);timeout.tick(1501,true,false);
  assert(timeout.duty==0&&!timeout.armed);timeout.heartbeat(1600);timeout.tick(1600,true,false);assert(timeout.duty==0); // heartbeat never restarts
  MotorCore usb;ready(usb);usb.move(1,20,2);usb.tick(3,false,false);assert(!usb.armed&&usb.duty==0);
  MotorCore policy;ready(policy);policy.config.stopOnDisconnect=false;policy.move(1,20,2);
  policy.tick(3,false,false);assert(policy.duty==20);policy.tick(1501,false,false);assert(policy.duty==0); // timeout cannot be disabled
  MotorCore button;ready(button);button.move(1,20,2);button.tick(3,true,true);assert(button.locked&&button.duty==0);
  MotorCore wrap;ready(wrap,0xffffff00U);wrap.move(1,20,0xffffff01U);wrap.tick(0x00000500U,true,false);assert(wrap.duty==0);
  MotorCore zero;ready(zero);zero.move(1,20,2);zero.speed(0,3);assert(zero.duty==0&&!zero.pending);zero.speed(20,4);assert(zero.duty==0);
  Settings s;assert(s.valid());s.frequency=0;assert(!s.valid());s=Settings{};s.timeoutMs=0;assert(!s.valid());s=Settings{};s.defaultDuty=90;assert(!s.valid());
  // Deterministic randomized sequences: never run while unarmed/locked, never exceed limits.
  MotorCore random;ready(random);uint32_t seed=7;
  for(uint32_t t=10;t<100010;t++) {
    seed=1664525*seed+1013904223;switch(seed%9) {
      case 0:random.heartbeat(t);break;case 1:random.arm(t);break;
      case 2:random.move(1,(seed>>16)%101,t);break;case 3:random.move(-1,(seed>>16)%101,t);break;
      case 4:random.stop(t,"test");break;case 5:random.emergency(t);break;
      case 6:random.locked=false;break;case 7:random.speed((seed>>16)%101,t);break;
      default:break;
    }
    random.tick(t,true,false);
    assert(random.duty<=random.config.maxDuty);
    if(random.locked||!random.armed||random.pending)assert(random.duty==0);
  }
  std::cout<<"PASS: boot, interlock, cap, reverse dead time, stop/reverse, emergency, timeout, disconnect policy, button, millis wrap, zero duty, settings, 100000 randomized transitions\n";
}
