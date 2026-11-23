# Changelog

## 1.3.0

- The add-on is now installed as a ready-made image from GitHub Container Registry, built and tested by GitHub Actions. Installs and updates are a quick download instead of compiling on your device.
- Updated to the current Home Assistant community base image (Alpine 3.24, Node.js 24). The previous base used Node.js 20, which reached end of life in April 2026.
- Supported architectures are now `aarch64` (including Home Assistant Green) and `amd64`. The base image no longer supports `armhf`, `armv7` and `i386`.
- Smaller image: the build tools are no longer included.

## 1.2.0

- **Home Assistant entities over MQTT** (needs the Mosquitto broker add-on). For each channel in the new `channels` option the add-on creates a level slider (`number.presonus_<id>_level`) and a mute switch (`switch.presonus_<id>_mute`). They follow the mixer's real state, including changes made on the mixer itself or in UC Surface.
- Real-time faders: commands go straight to the mixer. State is reported back to Home Assistant once a channel has been still for `state_debounce_ms` (default 300 ms), so dragging doesn't flood Home Assistant.
- `binary_sensor.presonus_mixer_connected` shows the mixer connection immediately (no polling).
- `switch.presonus_ha_control`: turn off to make the add-on ignore changes from Home Assistant (MQTT and HTTP).
- New HTTP endpoints: `GET /api/state` and `POST /api/control`.
- Fixed: fader levels reported by the mixer were stored on a 0–1 scale instead of 0–100.
- Supervisor watchdog: the add-on is restarted if it stops responding.

## 1.1.0

- Level changes are throttled per channel: at most one write to the mixer every 25 ms, the newest value wins, and the final value is always sent. Sliders that update while dragging no longer flood the mixer.
- Per-request log lines are now only written when `log_level` is `debug`.
- Invalid channels (e.g. `LINE 30` on a 16-channel mixer) now return a 400 error immediately.
- Fixed a crash when the mixer connection receives malformed or partial data (for example after a dropped connection).
- Socket errors are always handled, so they can no longer crash the add-on.
- Faster, cleaner shutdown when the add-on is stopped or restarted.
- Docs: use `mode: restart` on level automations, call the add-on at `127.0.0.1:8099`, and exclude level helpers from recorder/logbook.

## 1.0.0

- Initial release.
