# 诊断工具

所有命令需选择你自己的设备，不能把示例占位值原样运行。先核对端口、303A:1001以及USB序列号；需要ROM核验的刷写使用tools/flash.sh。退出网页串口连接后才能由脚本独占串口。

```sh
# 只在VM物理断开时执行：零占空比设备验收
.venv/bin/python tools/device_acceptance.py --port /dev/cu.usbmodemXXXX --expected-mac YOUR_DEVICE_MAC --confirm-vm-disconnected
# 只在VM物理断开时执行：真实控制器非零PWM/超时状态验收，不构成电机运动测试
.venv/bin/python tools/output_acceptance.py --port /dev/cu.usbmodemXXXX --expected-mac YOUR_DEVICE_MAC --confirm-vm-disconnected
# 以下会真正启动电机；只有现场已准备好、空载固定、清楚电气方向后才执行
.venv/bin/python tools/short_pulse.py --port /dev/cu.usbmodemXXXX --expected-mac YOUR_DEVICE_MAC --empty-fixed-motor --frequency 1000 --duty 30 --duration-ms 200 --direction reverse
```

short_pulse的direction参数是固件raw电气方向；参考线序的raw reverse为轴端顺时针，网页已另做映射。脚本临时将命令超时设500ms，不持续发心跳，结束停止、恢复原参数并急停锁定；不会保存NVS。它不能量测真实转动或确认供电容量。诊断日志与设备整片备份可能含私人信息，默认不纳入Git。
