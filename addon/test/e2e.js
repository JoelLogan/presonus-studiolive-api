/**
 * End-to-end test for the add-on server: runs it against a fake mixer and an
 * in-process MQTT broker, and acts like Home Assistant.
 *
 *   node test/e2e.js                          # test addon/server.js with the local library build
 *   E2E_DOCKER_IMAGE=<image> node test/e2e.js # test a built add-on image instead
 *
 * Needs the library to be built first (npm run build in the repository root).
 */
const { fork, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const mqtt = require('mqtt');
const aedes = require('aedes')();

const MQTT_PORT = 18830;
const MIXER_PORT = 53999;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

// Add-on options: the defaults from config.json, pointed at the fake mixer
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'presonus-e2e-'));
const options = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf8')).options;
fs.writeFileSync(path.join(tmp, 'options.json'), JSON.stringify({ ...options, mixer_ip: '127.0.0.1', mixer_port: MIXER_PORT }));
fs.mkdirSync(path.join(tmp, 'data'));

const brokerServer = net.createServer(aedes.handle);
brokerServer.listen(MQTT_PORT);
const mixer = fork(path.join(__dirname, 'fakeMixer.js'), [String(MIXER_PORT)], { silent: true });
const mixerWrites = () => new Promise((r) => { mixer.once('message', r); mixer.send('dump'); });
let srv, log = '';
const msgs = []; // { t, topic, payload, retain }
const last = (topic) => [...msgs].reverse().find((m) => m.topic === topic)?.payload;
const count = (topic, since = 0) => msgs.filter((m) => m.topic === topic && m.t >= since).length;
const getJson = (p) => new Promise((res) => http.get('http://127.0.0.1:8099' + p, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }));

function startServer() {
  const env = {
    CONFIG_PATH: path.join(tmp, 'options.json'),
    DATA_DIR: path.join(tmp, 'data'),
    MQTT_HOST: '127.0.0.1',
    MQTT_PORT: String(MQTT_PORT)
  };
  const image = process.env.E2E_DOCKER_IMAGE;
  if (!image) {
    return spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, ...env } });
  }
  const args = ['run', '--rm', '--network', 'host', '-v', `${tmp}:${tmp}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  // Bypass the base image's s6 init, which expects the Home Assistant Supervisor
  args.push('--entrypoint', 'node', image, '/addon/server.js');
  return spawn('docker', args);
}

process.on('exit', () => { mixer.kill(); srv?.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); });
(async () => {
  await sleep(500);
  const ha = mqtt.connect('mqtt://127.0.0.1:18830');
  await new Promise((r) => ha.on('connect', r));
  ha.subscribe(['homeassistant/#', 'presonus/#']);
  ha.on('message', (topic, p, packet) => msgs.push({ t: Date.now(), topic, payload: p.toString(), retain: packet.retain }));

  srv = startServer();
  srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  srv.on('exit', (c, s) => { if (c) { console.log('!!! server exited', c, s, '\n' + log.slice(-3000)); process.exit(1); } });
  for (let i = 0; i < 100 && !(last('presonus/mixer') === 'online' && last('presonus/main/mute')); i++) await sleep(100);
  await sleep(300);

  // 1. Discovery
  const configs = msgs.filter((m) => m.topic.endsWith('/config'));
  check('discovery: 17 levels + 17 mutes + 2 globals', configs.length === 36, `got ${configs.length}`);
  const c1 = JSON.parse(last('homeassistant/number/presonus_chan_1_level/config'));
  check('chan_1 level entity id', c1.default_entity_id === 'number.presonus_chan_1_level' && c1.name === 'Channel 1 Level');
  const cm = JSON.parse(last('homeassistant/switch/presonus_main_mute/config'));
  check('main mute entity id', cm.default_entity_id === 'switch.presonus_main_mute');
  const late = mqtt.connect('mqtt://127.0.0.1:18830'); const lateMsgs = [];
  await new Promise((r) => late.on('connect', r));
  late.on('message', (t, p, pk) => lateMsgs.push({ t, retain: pk.retain }));
  late.subscribe('homeassistant/#'); await sleep(300); late.end();
  check('discovery is retained (new subscriber gets it)', lateMsgs.length === 36 && lateMsgs.every((m) => m.retain), `${lateMsgs.length}`);

  // 2. Initial state from the console's state dump
  check('bridge online', last('presonus/bridge') === 'online');
  check('mixer online', last('presonus/mixer') === 'online');
  check('control ON', last('presonus/control') === 'ON');
  check('chan_1 level 50', last('presonus/chan_1/level') === '50', last('presonus/chan_1/level'));
  check('chan_3 level 72 + muted', last('presonus/chan_3/level') === '72' && last('presonus/chan_3/mute') === 'ON');
  check('chan_1 unmuted', last('presonus/chan_1/mute') === 'OFF');
  check('main level 50 (MAIN)', last('presonus/main/level') === '50');
  check('main_fl level 50 (AUX 1)', last('presonus/main_fl/level') === '50');
  await mixerWrites();

  // 3. Drag: 100 commands over ~1 s ending at 63
  let t0 = Date.now();
  for (let i = 0; i < 100; i++) { ha.publish('presonus/chan_1/level/set', String(20 + i * 0.4)); await sleep(10); }
  ha.publish('presonus/chan_1/level/set', '63');
  const dragEnd = Date.now();
  await sleep(150);
  check('no HA state updates during the drag', count('presonus/chan_1/level', t0) === 0, `got ${count('presonus/chan_1/level', t0)}`);
  await sleep(400);
  let w = await mixerWrites();
  const lw = w.filter((x) => x.key === 'line/ch1/volume');
  check('mixer got throttled writes', lw.length > 10 && lw.length < 60, `${lw.length} writes for 101 commands`);
  check('mixer final value 63', lw.at(-1)?.v === 63, String(lw.at(-1)?.v));
  check('exactly one HA state update after the drag', count('presonus/chan_1/level', t0) === 1 && last('presonus/chan_1/level') === '63',
    `count=${count('presonus/chan_1/level', t0)} value=${last('presonus/chan_1/level')} after ${msgs.filter(m=>m.topic==='presonus/chan_1/level'&&m.t>=t0)[0]?.t - dragEnd} ms`);

  // 4. Mute from HA
  t0 = Date.now();
  ha.publish('presonus/chan_2/mute/set', 'ON');
  await sleep(500);
  w = await mixerWrites();
  check('mute reached mixer', w.some((x) => x.key === 'line/ch2/mute' && x.v === true));
  check('mute state confirmed to HA', last('presonus/chan_2/mute') === 'ON' && count('presonus/chan_2/mute', t0) === 1);
  ha.publish('presonus/main/mute/set', 'ON');
  await sleep(500);
  w = await mixerWrites();
  check('main mute reached mixer', w.some((x) => x.key === 'main/ch1/mute' && x.v === true));

  // 5. Changes made on the console itself
  t0 = Date.now();
  mixer.send({ console: 'line/ch5/volume', value: 0.3 });
  mixer.send({ console: 'line/ch6/mute', value: true });
  mixer.send({ console: 'aux/ch1/volume', value: 0.8 });
  await sleep(600);
  check('console fader -> HA (chan_5 = 30)', last('presonus/chan_5/level') === '30', last('presonus/chan_5/level'));
  check('console mute -> HA (chan_6 ON)', last('presonus/chan_6/mute') === 'ON');
  check('console aux -> HA (main_fl = 80)', last('presonus/main_fl/level') === '80', last('presonus/main_fl/level'));
  // Repeated identical reports don't cause extra publishes
  t0 = Date.now();
  mixer.send({ console: 'line/ch5/volume', value: 0.3 });
  await sleep(500);
  check('repeated identical console value: no publish', count('presonus/chan_5/level', t0) === 0);

  // 6. Home Assistant control switch
  ha.publish('presonus/control/set', 'OFF');
  await sleep(200);
  check('control switch OFF confirmed', last('presonus/control') === 'OFF');
  t0 = Date.now();
  ha.publish('presonus/chan_1/level/set', '10');
  await sleep(300);
  w = await mixerWrites();
  check('commands ignored while control is OFF', !w.some((x) => x.key === 'line/ch1/volume'));
  check('real state re-sent so the UI snaps back', last('presonus/chan_1/level') === '63');
  const st = await getJson('/api/status');
  check('control OFF visible in /api/status', st.control_enabled === false);
  ha.publish('presonus/control/set', 'ON');
  await sleep(200);
  check('control switch back ON', last('presonus/control') === 'ON');

  // 7. REST state endpoint
  const s = await getJson('/api/state');
  const ch1 = s.channels.find((c) => c.id === 'chan_1');
  check('/api/state reports levels and mutes', ch1.level === 63 && ch1.muted === false && s.channels.length === 17);

  // 8. HA restart (birth message) -> discovery + state re-sent
  t0 = Date.now();
  ha.publish('homeassistant/status', 'online');
  await sleep(300);
  check('HA birth: discovery re-sent', msgs.filter((m) => m.t >= t0 && m.topic.endsWith('/config')).length === 36);
  check('HA birth: state re-sent', count('presonus/chan_1/level', t0) === 1);

  // 9. Mixer connection drop and recovery
  t0 = Date.now();
  mixer.send('reset');
  const offlineSeen = () => msgs.find((m) => m.t >= t0 && m.topic === 'presonus/mixer' && m.payload === 'offline');
  for (let i = 0; i < 100 && !offlineSeen(); i++) await sleep(100);
  check('mixer offline reported', !!offlineSeen(), offlineSeen() ? `${offlineSeen().t - t0} ms after drop` : '');
  for (let i = 0; i < 100 && last('presonus/mixer') !== 'online'; i++) await sleep(100);
  check('mixer back online', last('presonus/mixer') === 'online', `${Date.now() - t0} ms after drop`);
  ha.publish('presonus/chan_1/level/set', '40');
  await sleep(500);
  w = await mixerWrites();
  check('commands work after reconnect', w.some((x) => x.key === 'line/ch1/volume' && x.v === 40));

  // 10. Shutdown marks the bridge offline (entities become unavailable)
  srv.removeAllListeners('exit');
  srv.kill('SIGTERM');
  await new Promise((r) => srv.on('exit', r));
  await sleep(200);
  check('bridge offline on shutdown', last('presonus/bridge') === 'offline');

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  if (failures) console.log('--- server log ---\n' + log.slice(-4000));
  const warn = log.split('\n').filter((l) => /error|warn|Skipping/i.test(l) && !l.includes('"level":30'));
  if (warn.length) console.log('server warnings/errors:\n' + warn.slice(0, 10).join('\n'));
  process.exit(failures ? 1 : 0);
})();
