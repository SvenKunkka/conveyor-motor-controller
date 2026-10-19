# USB JSON Lines 协议 v1

115200 baud、8N1；ESP32-S3 原生 USB CDC/JTAG。UTF-8，一行一个 JSON 对象，以 LF 结束，可接收 CRLF。命令正文最多 768 字节、JSON 嵌套最多 8 层；超长帧、NUL、无效 JSON、重复 JSON key 导致停止并撤销使能。未完成行不续期控制租期。所有数值只接受有界整数，拒绝字符串、布尔、NaN 和小数。

## 握手和应答

连接先发送 `{"id":1,"cmd":"hello"}`。hello 强制停止、撤销使能并产生新 session；不会清除急停锁定。回应中应检查 protocol=1、firmware=conveyor-1.0.0、chip=ESP32-S3、flashBytes=8388608、boot、session。

随后每条命令带递增正整数 id（1…2147483647）及返回的 session。每次重连建立新会话，运行状态不会恢复。

```json
{"id":2,"session":123456,"cmd":"heartbeat"}
{"id":3,"session":123456,"cmd":"arm"}
{"id":4,"session":123456,"cmd":"motor","action":"forward","speed":20}
{"id":5,"session":123456,"cmd":"motor","action":"reverse","speed":20}
{"id":6,"session":123456,"cmd":"set_speed","value":25}
{"id":7,"session":123456,"cmd":"motor","action":"stop"}
{"id":8,"session":123456,"cmd":"motor","action":"emergency_stop"}
{"id":9,"session":123456,"cmd":"clear_emergency"}
{"id":10,"session":123456,"cmd":"get_status"}
```

上面的 session 是说明用占位数，实际必须使用握手结果。不存在凭 hello 自报身份执行刷写的路径，刷写另经 ROM 检查。

统一应答：type=ack、id、ok、code、protocol、firmware、chip、flashBytes、boot、session、state、settings。每 250ms 还可能推送 type=status/id=0。state 包括 mode、targetDirection、duty、targetDuty、locked、armed、ready、usbConnected、nvsReady、watchdogReady、reason、runMs、uptimeMs、resetReason。

state 是固件输出状态，不是实测运动。mode=direction_delay 时实际 PWM 为 0，方向请求尚未实施；后续 status 才反映延迟结束。runMs 为最近一段实际施加非零输出的时长；停止后保留该段时长，不是编码器运动时间。

## 指令

| cmd | 参数 | 作用 |
|---|---|---|
| hello | id | 停止、创建会话 |
| heartbeat | id, session | 续期租期，不启动或恢复电机 |
| arm | id, session | 需要新鲜心跳、未锁定和硬件 ready；手动使能 |
| disarm | id, session | 停止并撤销使能 |
| motor | action=forward/reverse，speed 可选 | 以请求占空比运行；未提供时使用默认值 |
| motor | action=stop | 滑行停止、保留使能 |
| motor | action=emergency_stop | 立即归零、锁定、撤销使能 |
| clear_emergency | — | 本体按钮释放且硬件正常才解除；仍需 arm |
| set_speed | value=0…100 | 运行时修改 PWM；停止时仅设定目标，不启动 |
| get_status / get_settings | — | 查询，不续期心跳 |
| set_settings | settings 对象 | 停止且解除使能后修改，暂不落盘 |
| save_settings | — | 停止且解除使能后保存到 NVS |

## 配置范围

frequency 1000…40000Hz，defaultDuty 0…maxDuty，maxDuty 1…100%，reverseDelayMs 100…5000ms，timeoutMs 500…10000ms，stopOnDisconnect 为布尔。默认分别为 20000/20/30/300/1500/true。

```json
{"id":11,"session":123456,"cmd":"set_settings","settings":{"frequency":20000,"defaultDuty":20,"maxDuty":30,"reverseDelayMs":300,"timeoutMs":1500,"stopOnDisconnect":true}}
{"id":12,"session":123456,"cmd":"save_settings"}
```

参数全体校验通过才应用；频率设置失败回退并锁定。保存失败 E_NVS，不能宣称已持久化。单 blob 由 NVS 保存，启动时校验版本、大小与范围。运行状态和使能状态不写 NVS。

## 可靠性与安全

- 网页每 200ms 发心跳；应答超时 900ms 后关闭控制连接，停止发心跳；状态超过 1200ms 视为未知。主机不会自动重发运动命令。
- 固件只允许严格递增 ID。同一会话最后一条完全相同的原始 JSON 重复到达时，只重新应答当前状态，不重放动作或心跳；旧 ID／同 ID 不同内容 E_STALE_ID。不能无限期重试非最新请求。
- STOP/EMERGENCY_STOP 在 JSON 能解析时先执行安全动作，再验证 session/id，因此错误 ID 的急停可能已生效但应答仍为错误。
- stopOnDisconnect=true：USB 连接状态丢失时立即停止；网页主动断开或切到后台也发 disarm。浏览器崩溃、系统休眠或 USB 状态无法即时识别时，timeoutMs 仍然保护。
- stopOnDisconnect=false 仅关闭上述即刻策略，心跳超时仍必然停止；没有无限失联运行模式。页面后台不发心跳，返回页面不会自动重新使能。
- 源码中的 1000ms 任务看门狗在安全循环卡住时复位，仍需真实断线/卡死测试和硬件断电措施。停机为滑行，机械惯性仍存在。
- JSON Lines 无额外 CRC，USB 有链路校验；ID/session 解决确认与跨会话重放，不是身份认证协议。物理 USB 持有人可发送控制指令。

错误码：E_JSON、E_ID、E_SESSION、E_STALE_ID、E_LINE_TOO_LONG、E_FORMAT、E_RANGE、E_ACTION、E_COMMAND、E_UNKNOWN_SETTING、E_BUSY、E_HARDWARE、E_LOCKED、E_NOT_ARMED、E_HEARTBEAT、E_BUTTON、E_NVS。错误应答仍附带当前状态，不可仅凭发送成功更新 UI。

## 当前电机的方向校准

协议action字段和state.mode保持固件原始电气方向。用户现场确认本套线序raw forward=轴端观察逆时针，因此网页校准为“正转/顺时针→action reverse”，“反转/逆时针→action forward”。回报mode及targetDirection用同一映射显示，raw值保留日志。直接用本协议控制时必须应用项目hardware-profile.js中的对应关系，不能把raw forward无条件称作顺时针。
