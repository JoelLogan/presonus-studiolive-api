# Changelog

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
