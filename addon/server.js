#!/usr/bin/env node

/**
 * Home Assistant Addon Server for PreSonus StudioLive Control
 *
 * - Keeps one connection to the mixer (auto-reconnecting)
 * - Exposes configured channels to Home Assistant over MQTT discovery
 *   (level + mute entities that follow the mixer's real state)
 * - Provides a small HTTP API on port 8099 (kept for scripts and backwards compatibility)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createLevelCoalescer } = require('./levelCoalescer');

// Inside the add-on container the library is built to /app/dist; fall back to
// the repository build so the server can also be run locally for testing.
const LIB_DIR = fs.existsSync('/app/dist/cjs/api.js')
  ? '/app/dist/cjs'
  : path.join(__dirname, '..', 'dist', 'cjs');
// parseChannelString is the library's own channel validation (it uses the
// channel counts reported by the mixer once connected)
const { Client, MessageCode, parseChannelString } = require(path.join(LIB_DIR, 'api'));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/options.json';
let config = {
  mixer_ip: process.env.MIXER_IP || '192.168.1.100',
  mixer_port: parseInt(process.env.MIXER_PORT || '53000'),
  log_level: process.env.LOG_LEVEL || 'info',
  mqtt_enabled: true,
  state_debounce_ms: 300,
  channels: []
};

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = { ...config, ...fileConfig };
    console.log('Loaded configuration from', CONFIG_PATH);
  } catch (err) {
    console.error('Failed to load config file:', err.message);
  }
}

console.log('Starting PreSonus StudioLive Control Addon');
console.log('Mixer IP:', config.mixer_ip);
console.log('Mixer Port:', config.mixer_port);
console.log('Log Level:', config.log_level);

const DEBUG = config.log_level === 'debug';
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

// Minimum time between level writes to the mixer for a single channel.
// Bursts (e.g. a slider being dragged) are coalesced: newest value wins and the
// final value is always sent.
const LEVEL_INTERVAL_MS = 25;

// Persistent add-on state (survives restarts)
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '.data'));
const STATE_FILE = path.join(DATA_DIR, 'presonus_state.json');
let persisted = { control_enabled: true };
try {
  persisted = { ...persisted, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch (err) {
  // First run, or no saved state yet
}
function savePersisted() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(persisted));
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Channels exposed to Home Assistant
// ---------------------------------------------------------------------------

const channels = [];
const channelByKey = new Map(); // "line/ch1/volume" -> { ch, kind }

for (const raw of config.channels || []) {
  try {
    if (!raw.id || !/^[a-z0-9_]+$/.test(raw.id)) {
      throw new Error('id must be lowercase letters, numbers and underscores');
    }
    if (channels.some((c) => c.id === raw.id)) {
      throw new Error('duplicate id');
    }
    const selector = { type: String(raw.type).toUpperCase(), channel: parseInt(raw.number) };
    const base = parseChannelString(selector); // validates the type
    const ch = { id: raw.id, name: raw.name || raw.id, selector };
    channels.push(ch);
    channelByKey.set(`${base}/volume`, { ch, kind: 'level' });
    channelByKey.set(`${base}/mute`, { ch, kind: 'mute' });
  } catch (err) {
    console.error(`Skipping channel ${JSON.stringify(raw)}: ${err.message}`);
  }
}
console.log(`Configured channels: ${channels.map((c) => `${c.id}=${c.selector.type} ${c.selector.channel}`).join(', ') || 'none'}`);

// ---------------------------------------------------------------------------
// Mixer connection
// ---------------------------------------------------------------------------

let client = null;
let isConnected = false;
let bridge = null;

const levelCoalescer = createLevelCoalescer((selector, level) => {
  if (!client || !isConnected) return;
  debugLog(`Sending level: ${selector.type} ${selector.channel} = ${level}`);
  // Writes can run from a timer, outside any request handler, so an error here
  // must never escape and take down the process
  try {
    client.setChannelVolumeLinear(selector, level).catch((err) => {
      console.error('Error sending level:', err.message);
    });
  } catch (err) {
    console.error('Error sending level:', err.message);
  }
}, LEVEL_INTERVAL_MS);

const mixer = {
  setLevel(selector, level) {
    levelCoalescer.set(selector, level);
  },
  setMute(selector, muted) {
    client.setMute(selector, muted);
    // The console doesn't necessarily echo our own change back, so record it
    // in the local state cache right away (this is what gets reported to HA)
    client.state.set(`${parseChannelString(selector)}/mute`, muted);
  },
  readLevel(selector) {
    try {
      const level = client?.getLevel(selector);
      return typeof level === 'number' ? level : null;
    } catch (err) {
      return null;
    }
  },
  readMute(selector) {
    try {
      const muted = client?.getMute(selector);
      return typeof muted === 'boolean' ? muted : null;
    } catch (err) {
      return null;
    }
  }
};

function setControlEnabled(enabled) {
  persisted.control_enabled = enabled;
  savePersisted();
}

function initializeMixer() {
  client = new Client({
    host: config.mixer_ip,
    port: config.mixer_port
  }, {
    autoreconnect: true,
    logLevel: config.log_level
  });

  client.on('connected', () => {
    console.log('✓ Connected to mixer at', config.mixer_ip);
    isConnected = true;
    for (const ch of channels) {
      try {
        parseChannelString(ch.selector);
      } catch (err) {
        console.error(`Channel ${ch.id} (${ch.selector.type} ${ch.selector.channel}) does not exist on this mixer`);
      }
    }
    bridge?.mixerStatusChanged(true);
  });

  client.on('closed', () => {
    console.log('✗ Connection to mixer closed');
    isConnected = false;
    bridge?.mixerStatusChanged(false);
  });

  client.on('reconnecting', () => {
    console.log('⟳ Reconnecting to mixer...');
    isConnected = false;
  });

  // Changes made on the console itself (or by UC Surface, or a scene recall)
  client.on(MessageCode.ParamValue, ({ name }) => {
    const hit = channelByKey.get(name);
    if (hit) bridge?.channelChanged(hit.ch, hit.kind);
  });

  client.on(MessageCode.FaderPosition, () => {
    for (const ch of channels) bridge?.channelChanged(ch, 'level');
  });

  client.connect().catch((err) => {
    console.error('Failed to connect to mixer:', err.message);
  });
}

initializeMixer();

// ---------------------------------------------------------------------------
// MQTT (Home Assistant entities)
// ---------------------------------------------------------------------------

const mqttHost = process.env.MQTT_HOST;
if (config.mqtt_enabled === false) {
  console.log('MQTT disabled in configuration');
} else if (!mqttHost) {
  console.warn('No MQTT broker found. Install the Mosquitto broker add-on to get Home Assistant entities.');
} else if (channels.length === 0) {
  console.warn('No channels configured, so no MQTT entities will be created');
} else {
  const { createMqttBridge } = require('./mqttBridge');
  bridge = createMqttBridge({
    url: `mqtt://${mqttHost}:${process.env.MQTT_PORT || 1883}`,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    channels,
    debounceMs: Math.max(50, parseInt(config.state_debounce_ms) || 300),
    isMixerConnected: () => isConnected,
    readLevel: mixer.readLevel,
    readMute: mixer.readMute,
    setLevel: mixer.setLevel,
    setMute: mixer.setMute,
    isControlEnabled: () => persisted.control_enabled,
    setControlEnabled,
    debugLog
  });
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

// Parse channel selector from request body
function parseChannelSelector(data) {
  if (!data.channel_type || data.channel_number === undefined) {
    throw new Error('Missing required fields: channel_type and channel_number');
  }

  const selector = {
    type: String(data.channel_type).toUpperCase(),
    channel: parseInt(data.channel_number)
  };

  // Throws "Invalid channel ..." for unknown types or channels the mixer doesn't have,
  // so bad requests get a 400 response instead of failing later
  parseChannelString(selector);

  return selector;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) req.destroy();
  });
  req.on('end', () => {
    let data;
    try {
      data = body ? JSON.parse(body) : {};
    } catch (err) {
      callback(new Error('Invalid JSON body'));
      return;
    }
    callback(null, data);
  });
}

function requireControl() {
  if (!isConnected) throw new Error('Not connected to mixer');
  if (!persisted.control_enabled) throw new Error('Home Assistant control is disabled');
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' || url.pathname === '/') {
    sendJson(res, 200, { status: 'ok', connected: isConnected, mixer: config.mixer_ip });
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, {
      connected: isConnected,
      mixer_ip: config.mixer_ip,
      mixer_port: config.mixer_port,
      control_enabled: persisted.control_enabled,
      mqtt: !!bridge
    });
    return;
  }

  // Current level/mute of every configured channel
  if (url.pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, {
      connected: isConnected,
      control_enabled: persisted.control_enabled,
      channels: channels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        channel_type: ch.selector.type,
        channel_number: ch.selector.channel,
        level: isConnected ? mixer.readLevel(ch.selector) : null,
        muted: isConnected ? mixer.readMute(ch.selector) : null
      }))
    });
    return;
  }

  if (url.pathname === '/api/control' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      if (err || typeof data.enabled !== 'boolean') {
        sendJson(res, 400, { success: false, error: err?.message || 'Body must be {"enabled": true|false}' });
        return;
      }
      setControlEnabled(data.enabled);
      bridge?.controlChanged(data.enabled);
      sendJson(res, 200, { success: true, control_enabled: data.enabled });
    });
    return;
  }

  if (url.pathname === '/api/mute' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      try {
        if (err) throw err;
        requireControl();
        const selector = parseChannelSelector(data);
        const muted = data.muted !== undefined ? data.muted === true || data.muted === 'true' : true;

        debugLog(`Setting mute: ${selector.type} ${selector.channel} = ${muted}`);
        mixer.setMute(selector, muted);
        const hit = channelByKey.get(`${parseChannelString(selector)}/mute`);
        if (hit) bridge?.channelChanged(hit.ch, 'mute');

        sendJson(res, 200, { success: true, channel: selector, muted });
      } catch (e) {
        console.error('Error in /api/mute:', e.message);
        sendJson(res, 400, { success: false, error: e.message });
      }
    });
    return;
  }

  if (url.pathname === '/api/level' && req.method === 'POST') {
    readJsonBody(req, (err, data) => {
      try {
        if (err) throw err;
        requireControl();
        const selector = parseChannelSelector(data);
        const level = parseFloat(data.level);

        if (isNaN(level) || level < 0 || level > 100) {
          throw new Error('Level must be a number between 0 and 100 (0 = -84dB, 72 = 0dB unity, 100 = +10dB)');
        }

        debugLog(`Received level: ${selector.type} ${selector.channel} = ${level}`);
        mixer.setLevel(selector, level);
        const hit = channelByKey.get(`${parseChannelString(selector)}/volume`);
        if (hit) bridge?.channelChanged(hit.ch, 'level');

        sendJson(res, 200, {
          success: true,
          channel: selector,
          level,
          note: 'Level scale: 0 = -84dB, 72 = 0dB (unity), 100 = +10dB'
        });
      } catch (e) {
        console.error('Error in /api/level:', e.message);
        sendJson(res, 400, { success: false, error: e.message });
      }
    });
    return;
  }

  if (url.pathname === '/api/channels' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      channel_types: ['LINE', 'AUX', 'FX', 'MAIN', 'DCA'],
      channel_counts: isConnected ? client.channelCounts : null,
      configured: channels.map((ch) => ({ id: ch.id, name: ch.name, ...ch.selector }))
    });
    return;
  }

  sendJson(res, 404, {
    error: 'Not found',
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /api/status',
      'GET /api/state',
      'GET /api/channels',
      'POST /api/mute',
      'POST /api/level',
      'POST /api/control'
    ]
  });
});

const PORT = 8099;
server.listen(PORT, () => {
  console.log(`HTTP API server listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  levelCoalescer.clear();
  // Don't let idle keep-alive HTTP connections hold the shutdown open
  server.closeAllConnections?.();
  server.close(async () => {
    try {
      await bridge?.close();
    } catch (err) {
      debugLog('Error closing MQTT:', err.message);
    }
    if (client) {
      try {
        await client.close();
      } catch (err) {
        debugLog('Error during disconnect:', err.message);
      }
    }
    process.exit(0);
  });
  // Hard stop if something hangs
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
