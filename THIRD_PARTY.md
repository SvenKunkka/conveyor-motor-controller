# Third-party sources

This repository implements the ESP32-S3 motor-control portion of a personal conveyor-keyboard build. It is not an official Google, M5Stack or Espressif project.

- Google mozc-devices / mozc-conveyorbelt: https://github.com/google/mozc-devices/tree/main/mozc-conveyorbelt — project inspiration and mechanical assembly reference. No CH559 firmware is included or flashed to ESP32-S3.
- M5Stack ATOMS3 Lite hardware documentation: https://docs.m5stack.com/en/core/AtomS3-Lite — pin and board reference. Official pinmap is linked, not redistributed.
- pioarduino platform-espressif32 55.03.37: https://github.com/pioarduino/platform-espressif32/releases/tag/55.03.37 — build platform, fetched by PlatformIO.
- Espressif Arduino ESP32 3.3.7: https://github.com/espressif/arduino-esp32/tree/3.3.7 — installed package identifies its license as LGPL-2.1-or-later. Distributed firmware uses the unmodified upstream core; its source and license remain available upstream.
- ESP-IDF 5.5.2: https://github.com/espressif/esp-idf/tree/v5.5.2 — runtime and hardware APIs, upstream Apache-2.0 and component-specific notices. See the matching upstream source for individual components.
- aiohttp and pyserial are installed separately using tools/requirements.txt; they are not vendored. Their upstream licenses and notices apply.

Only project-written source and clean build artifacts are present here. The public release does not include personal flash/NVS backups or local runtime data. No project-wide license has been selected in this publication; public visibility is not a substitute for a license grant. Third-party licenses are not changed by this repository.
