#!/usr/bin/env node

/**
 * Home Assistant Addon Server for PreSonus StudioLive Control
 * 
 * Provides HTTP API endpoints for controlling mixer channels
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('../dist/cjs/api');

// Read configuration from Home Assistant
const CONFIG_PATH = process.env.CONFIG_PATH || '/data/options.json';
let config = {
  mixer_ip: process.env.MIXER_IP || '192.168.1.100',
  mixer_port: parseInt(process.env.MIXER_PORT || '53000'),
  log_level: process.env.LOG_LEVEL || 'info'
};

// Try to load config from file
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

// Initialize mixer client
let client = null;
let isConnected = false;

function initializeMixer() {
  if (client) {
    try {
      client.disconnect();
    } catch (err) {
      // Log disconnect errors at debug level
      if (config.log_level === 'debug') {
        console.error('Error during disconnect:', err.message);
      }
    }
  }

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
  });

  client.on('closed', () => {
    console.log('✗ Connection to mixer closed');
    isConnected = false;
  });

  client.on('reconnecting', () => {
    console.log('⟳ Reconnecting to mixer...');
    isConnected = false;
  });

  client.on('error', (err) => {
    console.error('Mixer error:', err.message);
  });

  // Connect to mixer
  client.connect().catch(err => {
    console.error('Failed to connect to mixer:', err.message);
  });
}

// Initialize mixer connection
initializeMixer();

// Parse channel selector from request body
function parseChannelSelector(data) {
  if (!data.channel_type || data.channel_number === undefined) {
    throw new Error('Missing required fields: channel_type and channel_number');
  }

  return {
    type: data.channel_type.toUpperCase(),
    channel: parseInt(data.channel_number)
  };
}

// HTTP Server
const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connected: isConnected,
      mixer: config.mixer_ip
    }));
    return;
  }

  // API Status endpoint
  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: isConnected,
      mixer_ip: config.mixer_ip,
      mixer_port: config.mixer_port
    }));
    return;
  }

  // Set Mute endpoint
  if (url.pathname === '/api/mute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        if (!isConnected) {
          throw new Error('Not connected to mixer');
        }

        const data = JSON.parse(body);
        const selector = parseChannelSelector(data);
        const muted = data.muted !== undefined ? data.muted : true;

        console.log(`Setting mute: ${selector.type} ${selector.channel} = ${muted}`);
        client.setMute(selector, muted);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          channel: selector,
          muted: muted
        }));
      } catch (err) {
        console.error('Error in /api/mute:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message
        }));
      }
    });
    return;
  }

  // Set Level endpoint
  if (url.pathname === '/api/level' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        if (!isConnected) {
          throw new Error('Not connected to mixer');
        }

        const data = JSON.parse(body);
        const selector = parseChannelSelector(data);
        const level = parseFloat(data.level);

        if (isNaN(level) || level < 0 || level > 100) {
          throw new Error('Level must be a number between 0 and 100 (0 = -84dB, 72 = 0dB unity, 100 = +10dB)');
        }

        console.log(`Setting level: ${selector.type} ${selector.channel} = ${level}`);
        client.setChannelVolumeLinear(selector, level);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          channel: selector,
          level: level,
          note: 'Level scale: 0 = -84dB, 72 = 0dB (unity), 100 = +10dB'
        }));
      } catch (err) {
        console.error('Error in /api/level:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message
        }));
      }
    });
    return;
  }

  // Get channel info endpoint
  if (url.pathname === '/api/channels' && req.method === 'GET') {
    try {
      if (!isConnected) {
        throw new Error('Not connected to mixer');
      }

      // Return available channel types
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        channel_types: ['LINE', 'AUX', 'FX', 'MAIN', 'DCA'],
        note: 'Use channel_type and channel_number in your API calls'
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: err.message
      }));
    }
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /api/status',
      'GET /api/channels',
      'POST /api/mute',
      'POST /api/level'
    ]
  }));
});

const PORT = 8099;
server.listen(PORT, () => {
  console.log(`HTTP API server listening on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check');
  console.log('  GET  /api/status - Connection status');
  console.log('  GET  /api/channels - Available channel types');
  console.log('  POST /api/mute - Set channel mute state');
  console.log('  POST /api/level - Set channel level');
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    if (client) {
      client.disconnect();
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    if (client) {
      client.disconnect();
    }
    process.exit(0);
  });
});
