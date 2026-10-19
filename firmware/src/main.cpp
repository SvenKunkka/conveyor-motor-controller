#include <Arduino.h>
#include <Preferences.h>
#include <driver/ledc.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <cJSON.h>
#include <cmath>
#include "MotorCore.h"

constexpr char VERSION[]="conveyor-1.0.0";
constexpr int A=5,B=6,BUTTON=41;
MotorCore motor;
Preferences prefs;
bool nvsReady=false, wdtReady=false;
uint32_t bootId=0, session=0, lastId=0, lastEvent=0;
int appliedDirection=0; uint32_t appliedDuty=0;
char line[769]; size_t used=0; bool overflow=false;
char lastRequest[769]=""; const char* lastError=nullptr;

void zero() {
  ledc_stop(LEDC_LOW_SPEED_MODE,LEDC_CHANNEL_0,0);
  ledc_stop(LEDC_LOW_SPEED_MODE,LEDC_CHANNEL_1,0);
  appliedDirection=0;appliedDuty=0;
}
bool pwmSetup() {
  zero();
  ledc_timer_config_t t{};
  t.speed_mode=LEDC_LOW_SPEED_MODE;t.duty_resolution=LEDC_TIMER_10_BIT;
  t.timer_num=LEDC_TIMER_0;t.freq_hz=motor.config.frequency;t.clk_cfg=LEDC_AUTO_CLK;
  if(ledc_timer_config(&t)!=ESP_OK)return false;
  for(int i=0;i<2;i++) {
    ledc_channel_config_t c{};c.gpio_num=i?B:A;c.speed_mode=LEDC_LOW_SPEED_MODE;
    c.channel=(ledc_channel_t)i;c.timer_sel=LEDC_TIMER_0;c.duty=0;
    if(ledc_channel_config(&c)!=ESP_OK)return false;
  }
  return true;
}
void apply() {
  if(motor.duty==appliedDuty && motor.actualDirection==appliedDirection)return;
  // Clear BOTH channels before any new nonzero output; never drive both high.
  zero();
  if(!motor.duty || !motor.actualDirection)return;
  auto channel=motor.actualDirection==1?LEDC_CHANNEL_0:LEDC_CHANNEL_1;
  uint32_t raw=(motor.duty*1023+50)/100;
  if(ledc_set_duty(LEDC_LOW_SPEED_MODE,channel,raw)!=ESP_OK ||
     ledc_update_duty(LEDC_LOW_SPEED_MODE,channel)!=ESP_OK) {
    motor.ready=false;motor.emergency(millis(),"pwm_error");zero();return;
  }
  appliedDirection=motor.actualDirection;appliedDuty=motor.duty;
}
const char* direction(int d) {return d==1?"forward":d==-1?"reverse":"stopped";}
void addSettings(cJSON* o) {
  auto &s=motor.config;
  cJSON_AddNumberToObject(o,"frequency",s.frequency);
  cJSON_AddNumberToObject(o,"defaultDuty",s.defaultDuty);
  cJSON_AddNumberToObject(o,"maxDuty",s.maxDuty);
  cJSON_AddNumberToObject(o,"reverseDelayMs",s.reverseDelayMs);
  cJSON_AddNumberToObject(o,"timeoutMs",s.timeoutMs);
  cJSON_AddBoolToObject(o,"stopOnDisconnect",s.stopOnDisconnect);
}
void reply(uint32_t id,const char* error=nullptr,bool event=false) {
  if(!Serial)return;
  cJSON* out=cJSON_CreateObject();if(!out)return;
  cJSON_AddStringToObject(out,"type",event?"status":"ack");
  cJSON_AddNumberToObject(out,"protocol",1);cJSON_AddNumberToObject(out,"id",id);
  cJSON_AddBoolToObject(out,"ok",!error);cJSON_AddStringToObject(out,"code",error?error:"OK");
  cJSON_AddStringToObject(out,"firmware",VERSION);cJSON_AddStringToObject(out,"chip",ESP.getChipModel());
  cJSON_AddNumberToObject(out,"flashBytes",ESP.getFlashChipSize());
  cJSON_AddNumberToObject(out,"boot",bootId);cJSON_AddNumberToObject(out,"session",session);
  cJSON* s=cJSON_AddObjectToObject(out,"state");
  cJSON_AddStringToObject(s,"mode",motor.pending?"direction_delay":direction(motor.actualDirection));
  cJSON_AddStringToObject(s,"targetDirection",direction(motor.targetDirection));
  cJSON_AddNumberToObject(s,"duty",motor.duty);cJSON_AddNumberToObject(s,"targetDuty",motor.targetDuty);
  cJSON_AddBoolToObject(s,"locked",motor.locked);cJSON_AddBoolToObject(s,"armed",motor.armed);
  cJSON_AddBoolToObject(s,"ready",motor.ready);cJSON_AddBoolToObject(s,"usbConnected",bool(Serial));
  cJSON_AddBoolToObject(s,"nvsReady",nvsReady);cJSON_AddBoolToObject(s,"watchdogReady",wdtReady);
  cJSON_AddStringToObject(s,"reason",motor.reason);
  cJSON_AddNumberToObject(s,"runMs",motor.actualDirection?uint32_t(millis()-motor.startedAt):motor.runMs);
  cJSON_AddNumberToObject(s,"uptimeMs",millis());cJSON_AddNumberToObject(s,"resetReason",esp_reset_reason());
  addSettings(cJSON_AddObjectToObject(out,"settings"));
  char* text=cJSON_PrintUnformatted(out);
  // A missing ACK is safer than blocking the safety loop on a disconnected USB host.
  if(text) {size_t n=strlen(text);if(Serial.availableForWrite()>=int(n+1)){Serial.write((uint8_t*)text,n);Serial.write('\n');}cJSON_free(text);}
  cJSON_Delete(out);
}
bool integer(cJSON* v,uint32_t low,uint32_t high,uint32_t& result) {
  if(!cJSON_IsNumber(v) || !std::isfinite(v->valuedouble) || v->valuedouble<low ||
     v->valuedouble>high || floor(v->valuedouble)!=v->valuedouble)return false;
  result=(uint32_t)v->valuedouble;return true;
}
const char* str(cJSON* o,const char* key) {auto v=cJSON_GetObjectItemCaseSensitive(o,key);return cJSON_IsString(v)?v->valuestring:"";}
bool uniqueKeys(cJSON* o) {
  for(auto a=o->child;a;a=a->next) {
    for(auto b=a->next;b;b=b->next)if(a->string && b->string && !strcmp(a->string,b->string))return false;
    if(cJSON_IsObject(a) && !uniqueKeys(a))return false;
  }
  return true;
}
const char* settings(cJSON* obj) {
  if(motor.actualDirection || motor.pending || motor.armed)return "E_BUSY";
  if(!cJSON_IsObject(obj))return "E_FORMAT";
  Settings next=motor.config;
  for(auto x=obj->child;x;x=x->next) {
    uint32_t v=0;
    if(!strcmp(x->string,"stopOnDisconnect")) {if(!cJSON_IsBool(x))return "E_FORMAT";next.stopOnDisconnect=cJSON_IsTrue(x);continue;}
    if(!integer(x,0,40000,v))return "E_RANGE";
    if(!strcmp(x->string,"frequency"))next.frequency=v;
    else if(!strcmp(x->string,"defaultDuty"))next.defaultDuty=v;
    else if(!strcmp(x->string,"maxDuty"))next.maxDuty=v;
    else if(!strcmp(x->string,"reverseDelayMs"))next.reverseDelayMs=v;
    else if(!strcmp(x->string,"timeoutMs"))next.timeoutMs=v;
    else return "E_UNKNOWN_SETTING";
  }
  if(!next.valid())return "E_RANGE";
  Settings old=motor.config; motor.config=next;
  if(!pwmSetup()) {motor.config=old;motor.ready=pwmSetup()&&wdtReady;motor.emergency(millis(),"pwm_error");return "E_HARDWARE";}
  motor.targetDuty=next.defaultDuty;return nullptr;
}
void command(const char* input) {
  // Bound parser recursion independently of the vendor cJSON nesting limit.
  int depth=0; bool quoted=false, escaped=false, deep=false;
  for(const char* c=input;*c;c++) {
    if(quoted) {if(escaped)escaped=false;else if(*c=='\\')escaped=true;else if(*c=='"')quoted=false;}
    else if(*c=='"')quoted=true;
    else if(*c=='{' || *c=='[') {if(++depth>8){deep=true;break;}}
    else if(*c=='}' || *c==']')--depth;
  }
  if(deep){motor.disarm(millis(),"json_too_deep");apply();reply(0,"E_JSON");return;}
  const char* end=nullptr;
  cJSON* o=cJSON_ParseWithOpts(input,&end,true);
  if(!o || !cJSON_IsObject(o) || !uniqueKeys(o)) {
    motor.disarm(millis(),"invalid_json");apply();reply(0,"E_JSON");cJSON_Delete(o);return;
  }
  uint32_t id=0, reqSession=0; const char* cmd=str(o,"cmd");const char* action=str(o,"action");
  bool emergency=!strcmp(cmd,"motor") && !strcmp(action,"emergency_stop");
  bool stop=!strcmp(cmd,"motor") && !strcmp(action,"stop");
  // Stop paths act even if session/id validation subsequently fails.
  if(emergency)motor.emergency(millis());else if(stop)motor.stop(millis(),"user_stop");
  apply();
  if(!integer(cJSON_GetObjectItemCaseSensitive(o,"id"),1,2147483647,id)) {
    reply(0,"E_ID");cJSON_Delete(o);return;
  }
  if(!strcmp(cmd,"hello")) {
    motor.disarm(millis(),"new_session");motor.heartbeatSeen=false;apply();
    do {session=esp_random()&0x7fffffff;}while(!session);
    lastId=0;lastRequest[0]=0;reply(id);cJSON_Delete(o);return;
  }
  if(!integer(cJSON_GetObjectItemCaseSensitive(o,"session"),1,2147483647,reqSession) || reqSession!=session) {
    reply(id,"E_SESSION");cJSON_Delete(o);return;
  }
  if(id<=lastId) {
    const char* e=id==lastId && !strcmp(input,lastRequest)?lastError:"E_STALE_ID";
    reply(id,e);cJSON_Delete(o);return;
  }
  const uint32_t now=millis();const char* error=nullptr;
  if(stop || emergency) {}
  else if(!strcmp(cmd,"heartbeat"))motor.heartbeat(now);
  else if(!strcmp(cmd,"get_status") || !strcmp(cmd,"get_settings")) {}
  else if(!strcmp(cmd,"arm"))error=motor.arm(now);
  else if(!strcmp(cmd,"disarm"))motor.disarm(now,"user_disarm");
  else if(!strcmp(cmd,"clear_emergency")) {
    if(digitalRead(BUTTON)==LOW)error="E_BUTTON";
    else if(!motor.ready)error="E_HARDWARE";
    else {motor.disarm(now,"emergency_cleared");motor.locked=false;}
  }
  else if(!strcmp(cmd,"motor")) {
    int dir=!strcmp(action,"forward")?1:!strcmp(action,"reverse")?-1:0;
    uint32_t speed=motor.config.defaultDuty;
    auto value=cJSON_GetObjectItemCaseSensitive(o,"speed");
    if(!dir)error="E_ACTION";
    else if(value && !integer(value,0,100,speed))error="E_RANGE";
    else error=motor.move(dir,speed,now);
  }
  else if(!strcmp(cmd,"set_speed")) {
    uint32_t v=0;if(!integer(cJSON_GetObjectItemCaseSensitive(o,"value"),0,100,v))error="E_RANGE";
    else error=motor.speed(v,now);
  }
  else if(!strcmp(cmd,"set_settings"))error=settings(cJSON_GetObjectItemCaseSensitive(o,"settings"));
  else if(!strcmp(cmd,"save_settings")) {
    if(motor.actualDirection || motor.pending || motor.armed)error="E_BUSY";
    else if(!nvsReady || prefs.putBytes("settings",&motor.config,sizeof(Settings))!=sizeof(Settings))error="E_NVS";
  }
  else error="E_COMMAND";
  apply();lastId=id;strlcpy(lastRequest,input,sizeof(lastRequest));lastError=error;
  reply(id,error);cJSON_Delete(o);
}
void setup() {
  digitalWrite(A,LOW);digitalWrite(B,LOW);pinMode(A,OUTPUT);pinMode(B,OUTPUT);
  pinMode(BUTTON,INPUT_PULLUP);
  nvsReady=prefs.begin("conveyor-v1",false);
  Settings saved;
  if(nvsReady && prefs.getBytesLength("settings")==sizeof(Settings) &&
     prefs.getBytes("settings",&saved,sizeof(saved))==sizeof(saved) && saved.valid())motor.config=saved;
  motor.targetDuty=motor.config.defaultDuty;
  esp_task_wdt_config_t w{};w.timeout_ms=1000;w.idle_core_mask=0;w.trigger_panic=true;
  esp_err_t init=esp_task_wdt_init(&w);
  if(init==ESP_ERR_INVALID_STATE)init=esp_task_wdt_reconfigure(&w);
  wdtReady=init==ESP_OK && (esp_task_wdt_status(nullptr)==ESP_OK || esp_task_wdt_add(nullptr)==ESP_OK);
  motor.ready=pwmSetup()&&wdtReady;zero();
  if(!motor.ready)motor.emergency(millis(),"initialization_failed");
  bootId=esp_random();Serial.setTxBufferSize(4096);Serial.setRxBufferSize(2048);
  Serial.begin(115200);Serial.setTxTimeoutMs(0);
}
void loop() {
  if(wdtReady)esp_task_wdt_reset();
  motor.tick(millis(),bool(Serial),digitalRead(BUTTON)==LOW);apply();
  for(int n=0;n<96 && Serial.available();n++) {
    char c=(char)Serial.read();
    if(c=='\r')continue;
    if(c=='\n') {
      line[used]=0;
      if(overflow)reply(0,"E_LINE_TOO_LONG");else if(used)command(line);
      used=0;overflow=false;
    } else if(!overflow && used<sizeof(line)-1 && c!=0)line[used++]=c;
    else {overflow=true;motor.disarm(millis(),"invalid_frame");apply();}
    motor.tick(millis(),bool(Serial),digitalRead(BUTTON)==LOW);apply();
  }
  if(uint32_t(millis()-lastEvent)>=250) {lastEvent=millis();reply(0,nullptr,true);}
  delay(1);
}
