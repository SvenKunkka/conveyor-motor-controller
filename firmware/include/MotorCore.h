#pragma once
#include <stdint.h>

struct Settings {
  uint32_t version=1, frequency=20000, defaultDuty=20, maxDuty=30;
  uint32_t reverseDelayMs=300, timeoutMs=1500;
  bool stopOnDisconnect=true;
  bool valid() const {
    return version==1 && frequency>=1000 && frequency<=40000 &&
      maxDuty>=1 && maxDuty<=100 && defaultDuty<=maxDuty &&
      reverseDelayMs>=100 && reverseDelayMs<=5000 && timeoutMs>=500 && timeoutMs<=10000;
  }
};

// Hardware-independent state machine used by firmware and host safety tests.
class MotorCore {
public:
  Settings config;
  int actualDirection=0, targetDirection=0, lastDirection=0;
  uint32_t duty=0, targetDuty=20, lastCommand=0, stoppedAt=0, startedAt=0, runMs=0;
  bool locked=false, armed=false, pending=false, ready=false, heartbeatSeen=false;
  const char* reason="boot";
  void stop(uint32_t now, const char* why) {
    if(actualDirection) { stoppedAt=now; runMs=now-startedAt; }
    actualDirection=targetDirection=0; duty=0; pending=false; reason=why;
  }
  void emergency(uint32_t now, const char* why="emergency_stop") {
    stop(now,why); locked=true; armed=false;
  }
  void heartbeat(uint32_t now) { lastCommand=now; heartbeatSeen=true; }
  bool fresh(uint32_t now) const {return heartbeatSeen && uint32_t(now-lastCommand)<config.timeoutMs;}
  const char* arm(uint32_t now) {
    if(!ready) return "E_HARDWARE";
    if(locked) return "E_LOCKED";
    if(!fresh(now)) return "E_HEARTBEAT";
    stop(now,"armed"); armed=true; return nullptr;
  }
  void disarm(uint32_t now,const char* why) { stop(now,why); armed=false; }
  const char* move(int dir,uint32_t speed,uint32_t now) {
    if(!ready) return "E_HARDWARE";
    if(locked) return "E_LOCKED";
    if(!armed) return "E_NOT_ARMED";
    if(!fresh(now)) {disarm(now,"command_timeout"); return "E_HEARTBEAT";}
    if((dir!=1 && dir!=-1) || speed>100) return "E_RANGE";
    const uint32_t bounded=speed>config.maxDuty?config.maxDuty:speed;
    if(bounded==0) {targetDuty=0; stop(now,"zero_duty"); return nullptr;}
    if(actualDirection && actualDirection!=dir) stop(now,"direction_delay");
    targetDirection=dir; targetDuty=bounded;
    // Remember the last driven direction, even across STOP then immediate reverse.
    pending=lastDirection && lastDirection!=dir && uint32_t(now-stoppedAt)<config.reverseDelayMs;
    if(pending) { duty=0; reason="direction_delay"; }
    else start(now);
    return nullptr;
  }
  void start(uint32_t now) {
    if(!actualDirection) {startedAt=now;runMs=0;}
    actualDirection=targetDirection;lastDirection=actualDirection;
    duty=targetDuty;pending=false;reason="running";
  }
  const char* speed(uint32_t value,uint32_t now) {
    if(value>100) return "E_RANGE";
    if(actualDirection || pending) return move(targetDirection,value,now);
    targetDuty=value>config.maxDuty?config.maxDuty:value; return nullptr;
  }
  void tick(uint32_t now,bool connected,bool button) {
    if(button) {emergency(now,"physical_button");return;}
    if(config.stopOnDisconnect && !connected && armed) {disarm(now,"usb_disconnected");return;}
    if(armed && !fresh(now)) {disarm(now,"command_timeout");return;}
    if(pending && uint32_t(now-stoppedAt)>=config.reverseDelayMs) start(now);
  }
};
