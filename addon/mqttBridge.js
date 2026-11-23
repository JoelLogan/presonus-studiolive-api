/**
 * MQTT bridge: exposes configured mixer channels to Home Assistant through
 * MQTT discovery, and keeps their state in sync with the console.
 *
 * Entities (for a channel with id "chan_1"):
 *   number.presonus_chan_1_level   0-100 fader level (72 = 0 dB unity)
 *   switch.presonus_chan_1_mute    ON = muted
 * Global entities:
 *   binary_sensor.presonus_mixer_connected
 *   switch.presonus_ha_control     OFF = ignore all commands from Home Assistant
 *
 * Commands from Home Assistant go straight to the mixer (through the level
 * coalescer). They do not create Home Assistant state changes. State is
 * published back only once a channel has been still for `debounceMs`, so a
 * dragged fader produces one state update per gesture, not hundreds.
 */

const mqtt = require('mqtt');

const PREFIX = 'presonus';
const DISCOVERY_PREFIX = 'homeassistant';
const BRIDGE_TOPIC = `${PREFIX}/bridge`;
const MIXER_TOPIC = `${PREFIX}/mixer`;
const CONTROL_TOPIC = `${PREFIX}/control`;

const DEVICE = {
  identifiers: ['presonus_studiolive'],
  name: 'PreSonus StudioLive',
  manufacturer: 'PreSonus',
  model: 'StudioLive III'
};

const ENTITY_AVAILABILITY = {
  availability: [{ topic: BRIDGE_TOPIC }, { topic: MIXER_TOPIC }],
  availability_mode: 'all'
};

/**
 * @param {object} opts
 * @param {string} opts.url              mqtt://host:port
 * @param {string} [opts.username]
 * @param {string} [opts.password]
 * @param {Array<{id,name,selector}>} opts.channels
 * @param {number} opts.debounceMs       Quiet time before publishing a channel's state
 * @param {() => boolean} opts.isMixerConnected
 * @param {(selector) => number|null} opts.readLevel
 * @param {(selector) => boolean|null} opts.readMute
 * @param {(selector, level) => void} opts.setLevel
 * @param {(selector, muted) => void} opts.setMute
 * @param {() => boolean} opts.isControlEnabled
 * @param {(enabled: boolean) => void} opts.setControlEnabled
 * @param {(...args) => void} opts.debugLog
 */
function createMqttBridge(opts) {
  const {
    channels,
    debounceMs,
    isMixerConnected,
    readLevel,
    readMute,
    setLevel,
    setMute,
    isControlEnabled,
    setControlEnabled,
    debugLog
  } = opts;

  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  const lastPublished = new Map(); // topic -> payload
  const timers = new Map(); // `${id}/${kind}` -> timeout

  const client = mqtt.connect(opts.url, {
    username: opts.username || undefined,
    password: opts.password || undefined,
    clientId: `presonus-studiolive-${Math.random().toString(16).slice(2, 10)}`,
    will: { topic: BRIDGE_TOPIC, payload: 'offline', retain: true, qos: 1 },
    reconnectPeriod: 5000
  });

  function publish(topic, payload, { retain = true, force = false } = {}) {
    if (!client.connected) return;
    if (!force && lastPublished.get(topic) === payload) return;
    lastPublished.set(topic, payload);
    client.publish(topic, payload, { retain, qos: 0 });
  }

  function publishDiscovery() {
    for (const ch of channels) {
      const base = `${PREFIX}/${ch.id}`;

      publish(`${DISCOVERY_PREFIX}/number/presonus_${ch.id}_level/config`, JSON.stringify({
        name: `${ch.name} Level`,
        unique_id: `presonus_${ch.id}_level`,
        default_entity_id: `number.presonus_${ch.id}_level`,
        device: DEVICE,
        ...ENTITY_AVAILABILITY,
        command_topic: `${base}/level/set`,
        state_topic: `${base}/level`,
        min: 0,
        max: 100,
        step: 1,
        mode: 'slider',
        unit_of_measurement: '%',
        icon: 'mdi:volume-high'
      }), { force: true });

      publish(`${DISCOVERY_PREFIX}/switch/presonus_${ch.id}_mute/config`, JSON.stringify({
        name: `${ch.name} Mute`,
        unique_id: `presonus_${ch.id}_mute`,
        default_entity_id: `switch.presonus_${ch.id}_mute`,
        device: DEVICE,
        ...ENTITY_AVAILABILITY,
        command_topic: `${base}/mute/set`,
        state_topic: `${base}/mute`,
        payload_on: 'ON',
        payload_off: 'OFF',
        icon: 'mdi:volume-off'
      }), { force: true });
    }

    publish(`${DISCOVERY_PREFIX}/binary_sensor/presonus_mixer_connected/config`, JSON.stringify({
      name: 'Mixer Connected',
      unique_id: 'presonus_mixer_connected',
      default_entity_id: 'binary_sensor.presonus_mixer_connected',
      device: DEVICE,
      availability: [{ topic: BRIDGE_TOPIC }],
      state_topic: MIXER_TOPIC,
      payload_on: 'online',
      payload_off: 'offline',
      device_class: 'connectivity'
    }), { force: true });

    publish(`${DISCOVERY_PREFIX}/switch/presonus_ha_control/config`, JSON.stringify({
      name: 'Home Assistant Control',
      unique_id: 'presonus_ha_control',
      default_entity_id: 'switch.presonus_ha_control',
      device: DEVICE,
      availability: [{ topic: BRIDGE_TOPIC }],
      command_topic: `${CONTROL_TOPIC}/set`,
      state_topic: CONTROL_TOPIC,
      payload_on: 'ON',
      payload_off: 'OFF',
      icon: 'mdi:tune-vertical',
      entity_category: 'config'
    }), { force: true });
  }

  /** Current state payload for a channel, or null if unknown */
  function statePayload(ch, kind) {
    if (kind === 'level') {
      const level = readLevel(ch.selector);
      if (typeof level !== 'number' || Number.isNaN(level)) return null;
      return String(Math.round(level * 10) / 10);
    }
    const muted = readMute(ch.selector);
    if (typeof muted !== 'boolean') return null;
    return muted ? 'ON' : 'OFF';
  }

  function publishChannelState(ch, kind, force = false) {
    if (!isMixerConnected()) return;
    const payload = statePayload(ch, kind);
    if (payload !== null) publish(`${PREFIX}/${ch.id}/${kind}`, payload, { force });
  }

  function publishAll(force = false) {
    publish(BRIDGE_TOPIC, 'online', { force });
    publish(CONTROL_TOPIC, isControlEnabled() ? 'ON' : 'OFF', { force });
    publish(MIXER_TOPIC, isMixerConnected() ? 'online' : 'offline', { force });
    for (const ch of channels) {
      publishChannelState(ch, 'level', force);
      publishChannelState(ch, 'mute', force);
    }
  }

  /** Publish a channel's state once it has been unchanged for debounceMs */
  function scheduleState(ch, kind) {
    const key = `${ch.id}/${kind}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      publishChannelState(ch, kind);
    }, debounceMs));
  }

  client.on('connect', () => {
    console.log('✓ Connected to MQTT broker');
    client.subscribe([`${PREFIX}/+/level/set`, `${PREFIX}/+/mute/set`, `${CONTROL_TOPIC}/set`, `${DISCOVERY_PREFIX}/status`]);
    publishDiscovery();
    publishAll(true);
  });

  client.on('reconnect', () => debugLog('Reconnecting to MQTT broker...'));
  client.on('error', (err) => console.error('MQTT error:', err.message));

  client.on('message', (topic, payloadBuf) => {
    const payload = payloadBuf.toString().trim();

    // Home Assistant restarted: send discovery and current state again
    if (topic === `${DISCOVERY_PREFIX}/status`) {
      if (payload === 'online') {
        publishDiscovery();
        publishAll(true);
      }
      return;
    }

    if (topic === `${CONTROL_TOPIC}/set`) {
      const enabled = payload.toUpperCase() === 'ON';
      setControlEnabled(enabled);
      console.log(`Home Assistant control ${enabled ? 'enabled' : 'disabled'}`);
      publish(CONTROL_TOPIC, enabled ? 'ON' : 'OFF');
      return;
    }

    const match = topic.match(new RegExp(`^${PREFIX}/([^/]+)/(level|mute)/set$`));
    if (!match) return;
    const ch = byId.get(match[1]);
    if (!ch) return;
    const kind = match[2];

    if (!isControlEnabled() || !isMixerConnected()) {
      debugLog(`Ignoring ${kind} command for ${ch.id} (control disabled or mixer offline)`);
      // Re-send the real state so Home Assistant's UI snaps back
      publishChannelState(ch, kind, true);
      return;
    }

    if (kind === 'level') {
      const level = parseFloat(payload);
      if (Number.isNaN(level) || level < 0 || level > 100) return;
      setLevel(ch.selector, level);
    } else {
      const upper = payload.toUpperCase();
      if (upper !== 'ON' && upper !== 'OFF') return;
      setMute(ch.selector, upper === 'ON');
    }
    scheduleState(ch, kind);
  });

  return {
    /** The mixer connection came up or went down */
    mixerStatusChanged(connected) {
      publish(MIXER_TOPIC, connected ? 'online' : 'offline');
      if (connected) {
        // Full resync from the console's state dump
        for (const ch of channels) {
          publishChannelState(ch, 'level', true);
          publishChannelState(ch, 'mute', true);
        }
      }
    },

    /** A value changed on the console (someone moved a fader, or a scene was recalled) */
    channelChanged(ch, kind) {
      // The console can repeat fader positions it already reported; only
      // (re)start the quiet-time timer when something actually changed
      const pending = timers.has(`${ch.id}/${kind}`);
      if (!pending && statePayload(ch, kind) === lastPublished.get(`${PREFIX}/${ch.id}/${kind}`)) return;
      scheduleState(ch, kind);
    },

    /** The control switch was changed from somewhere else (e.g. REST) */
    controlChanged(enabled) {
      publish(CONTROL_TOPIC, enabled ? 'ON' : 'OFF');
    },

    async close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      if (client.connected) {
        await new Promise((resolve) => client.publish(BRIDGE_TOPIC, 'offline', { retain: true, qos: 1 }, resolve));
      }
      await client.endAsync().catch(() => {});
    }
  };
}

module.exports = { createMqttBridge };
