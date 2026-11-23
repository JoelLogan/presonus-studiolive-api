# Improvement Plan: HA Green ↔ StudioLive Add-on

## Status

| Phase | State |
| --- | --- |
| 0: Quick wins (level throttling, quieter logs, docs) | Done in 1.1.0 |
| 3: Library crash fixes (socket errors, framing reset, close) | Done in 1.1.0. Fast disconnect detection still open |
| 2: MQTT entities with two-way state | Done in 1.2.0. Done before Phase 1, because it lets the existing `custom-mixer-card` dashboard drag in real time |
| 1: WebSocket fader page through ingress | Optional now; only needed if dashboard dragging isn't smooth enough |
| 4: Build and packaging | Done in 1.3.0 (images built in GitHub Actions, multi-stage Dockerfile, base image update). Duplicate pnpm lockfile removed. Standard add-on folder layout still open |
| 5: Nice-to-haves | Not started |

## 1. How it works today

```
HA dashboard slider (input_number.mic_1_level)
   │  slider released → input_number.set_value
   ▼
HA core state machine  ── writes state to recorder DB, logbook, pushes to every open frontend
   │  state trigger
   ▼
Automation "Sync Mic 1 Level"  (default mode: single, saves a trace each run)
   │  rest_command.presonus_level  (new HTTP request to homeassistant.local:8099)
   ▼
Add-on: addon/server.js  (plain node http server on port 8099)
   │  POST /api/level → client.setChannelVolumeLinear()  (logs every call at info)
   ▼
Library Client (src/lib/Client.ts) → one 'PV' TCP packet → mixer :53000
```

What the add-on does:
- `Dockerfile` builds the TypeScript library **on the HA Green** at install time (`npm ci` with all dev deps, swc, tsc), then prunes.
- `addon/run.sh` reads options via bashio, then `server.js` opens one long-lived TCP connection to the mixer with `autoreconnect`.
- HTTP API: `/health`, `/api/status`, `/api/channels`, `POST /api/mute`, `POST /api/level`. It only sends to the mixer and never reads state back. HA doesn't know the real fader or mute state, so if someone moves a fader on the mixer or in UC Surface, HA shows the wrong value.

## 2. Why "send while dragging" bogged things down

Sending one level packet to the mixer is cheap. A single `PV` packet is about 40 bytes, and UC Surface sends dozens per second while you drag. **The bottleneck is Home Assistant, not the add-on or the mixer.** When the slider fires on every move, each tick goes through the whole pipeline above:

1. **State-machine churn.** Each tick is a full HA state change on `input_number`. HA writes it to the recorder (SQLite on the Green's eMMC), adds a logbook entry, and broadcasts it over the websocket to every open dashboard. At 20–50 ticks/s this is the main load.
2. **An automation run per tick.** Each run renders templates and saves a trace. With the default `mode: single`, ticks that arrive while the automation is still running are **dropped**, and the *final* value can be the one that gets dropped, so the fader lands in the wrong place. `mode: queued` replays a backlog instead, which shows up as lag.
3. **A new HTTP request per tick** to `homeassistant.local`. From inside the core container that's an mDNS/hairpin lookup instead of a direct container-to-container call.
4. **Add-on side.** `console.log` on every request goes into the Supervisor log pipeline. There's no coalescing either, so a burst of 50 requests becomes 50 mixer writes even though only the last one matters.

So the fix isn't to "make the HTTP call faster". **High-rate drag updates should go around the HA state machine entirely**, and HA should only see the value once the fader has settled.

## 3. Target design for real-time faders

```
Browser (fader UI, served through HA ingress)
   │  WebSocket, throttled to ~30 Hz with requestAnimationFrame; final value always sent on release
   ▼
Add-on  ── per-channel "latest value wins" coalescer (flush every ~25 ms) ──► mixer TCP
   │  ▲
   │  └── mixer PV/MS events (someone moved a real fader) → broadcast to all WS clients
   ▼
HA entities (MQTT discovery: number.*, switch.*), updated only after ~300–500 ms of no movement
```

- **The drag path never touches HA core.** No recorder writes, no automations, no state broadcasts.
- **HA still gets accurate entities** (`number.presonus_line_1_level`, `switch.presonus_line_1_mute`) for automations, scripts and voice. They update once per gesture, and they also follow changes made on the mixer itself.
- **Ingress** makes the UI work through the HA sidebar, Nabu Casa and HTTPS with HA handling auth, and WebSockets work through it too. A dashboard can embed the fader page with a `webpage`/iframe card, or the page can live as a sidebar panel.

## 4. Phased plan

### Phase 0: Quick wins, no new architecture (about 1 hour)
Use these right away. They also make the existing slider usable while dragging, though not perfectly smooth.
- **Add-on:** add a per-channel latest-value-wins coalescer in `server.js`. Requests return immediately and the mixer gets at most one write per channel every ~25 ms. Move the per-request `console.log` to debug level.
- **HA config:**
  - Change the level automations to `mode: restart`, so the newest value always wins and the final value is never dropped.
  - Point `rest_command` URLs at the add-on hostname (shown on the add-on's info page, for example `http://local-presonus-studiolive:8099`) or `127.0.0.1:8099`, not `homeassistant.local`.
  - Exclude the `input_number.*_level` helpers from `recorder:` and `logbook:`.
- **Bump `version`** in `config.json` on every change. Today it is stuck at `1.0.0`, so HA never offers an update.

### Phase 1: Real-time WebSocket channel + fader UI (the main feature)
- Add a WebSocket endpoint to the add-on (`/ws`) using the `ws` package or Node's built-in upgrade handling. Messages: `{t:"level", ch:"LINE/1", v:63.2}`, `{t:"mute", ch:"LINE/1", v:true}`, and server→client `state` snapshots and deltas.
- Server: the coalescer from Phase 0, with optional `duration` transitions cancelled when a new value arrives (`transitionValue` already returns a cancel function).
- Client: a small static page (no framework) with vertical faders for a configured channel list. It sends on `input` events throttled by `requestAnimationFrame`, always sends on `change`/`pointerup`, and ignores echoes for the channel being dragged.
- Turn on `ingress: true`, `ingress_port: 8099` and `panel_icon: mdi:tune-vertical` in the add-on config. Keep the host port optional or off so the mixer isn't controllable by anyone on the LAN (today it is: no auth, CORS `*`).
- New add-on option `channels:` (list of `{type, number, name}`) to choose which faders appear.

### Phase 2: Two-way state into HA via MQTT discovery
- Add `services: ["mqtt:want"]` and read the broker credentials from the Supervisor API (`/services/mqtt`).
- Publish discovery configs for each configured channel: a `number` for the level (0–100, or dB), a `switch` for mute, and `binary_sensor` connectivity for the mixer link.
- Subscribe to the library's `ParamValue` and `FaderPosition` events and publish state **debounced** (~300 ms per channel, `retain: true`). Command topics feed the same coalescer.
- Once this works, the `input_number` + automation + `rest_command` setup can be removed. Dashboards use the MQTT entities, and the ingress fader page handles live dragging.
- Keep the REST API for backwards compatibility. Add `GET /api/level` and `GET /api/mute` that read from `client.state`.

### Phase 3: Library robustness (the add-on must stay up for months)
Problems found in `src/lib`:
- **Socket `error` handling** (`Client.ts`, `doConnect`): each reconnect attaches `conn.once("error", () => {})`. After that one listener is used up, a second error on the same socket (such as ECONNRESET while connected) has no handler. Node then throws an unhandled `'error'` event and **the add-on process crashes**. Listeners also pile up across reconnects. Fix: one persistent `conn.on("error", …)` registered in the constructor.
- **Framing state not reset on reconnect** (`DataClient.ts`): `remaining`/`payload` survive a dropped connection mid-packet, so the first frames after reconnecting can hit `throw new Error("Header not matching…")` inside the queue job. Fix: reset on `connect`, and catch inside the job so a bad frame is dropped instead of being thrown.
- **No fast disconnect detection:** the library relies only on the 3 s keep-alive timeout. Also listen for the socket `close` event to start reconnecting immediately.
- **`close()`** awaits a write on a possibly dead socket. Add a timeout and stop the keep-alive interval so shutdown and option changes don't hang.
- **Hot-path inefficiency:** `handleRecvPacket` rebuilds its handler table for every packet, and `KVTree.register` re-joins and re-tokenises paths recursively. This is cheap per packet, but MS (fader) packets touch every channel. Hoist the table and register with token arrays.
- **Unanswered keep-alive IDs** are never released from `UniqueRandom` when a connection dies. This leaks slowly; clear them in `failFn`.

### Phase 4: Build and packaging
- **Stop compiling on the Green.** Build multi-arch images in GitHub Actions (`home-assistant/builder`), push them to GHCR, and set `image:` in the add-on config. Updates then become a fast pull instead of an `npm ci` + swc + tsc run on eMMC. At minimum, use a multi-stage Dockerfile so dev deps and build tools never reach the final image.
- Move the add-on into its own folder (`presonus_studiolive/` with `config.yaml`, `Dockerfile`, `rootfs/`), the standard HA add-on repository layout, so the library and add-on can be versioned separately.
- Update the base image (`hassio-addons/base` 15.0.1 is old). Drop `armhf`/`armv7`/`i386`, which HA has deprecated; the Green is `aarch64`.
- Use one lockfile: CI uses pnpm, but the Dockerfile uses `package-lock.json`. Pick one. (Done in 1.3.0: `package-lock.json` only.)
- Add `watchdog: http://[HOST]:[PORT:8099]/health`. Make `/health` return 503 while the mixer is disconnected, so the Supervisor can restart a wedged add-on.

### Phase 5: Nice-to-haves
- Scene and project recall (`recallProjectScene`, already in the library) exposed as an MQTT `select` entity.
- Optional metering: `meterSubscribe` drives VU bars in the ingress UI only, never in HA state.
- dB display and dB input on the faders (`logVolumeToLinear` exists; add the inverse).
- Aux-mix sends (`mixType: "AUX"`) for per-musician monitor control from phones.

## 5. Suggested order
1. Phase 0 (immediate relief) + Phase 3's crash fixes. These are small and high-value.
2. Phase 1 (real-time faders through ingress).
3. Phase 2 (MQTT entities with feedback), then remove the old helper and automation setup.
4. Phase 4 packaging, then Phase 5 as wanted.
