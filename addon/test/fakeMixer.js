// Fake StudioLive console for the add-on tests: handshake with a state dump,
// keep-alive replies, records writes, and can simulate changes made on the console itself.
const net = require('net');
const zlib = require('zlib');
const path = require('path');
const repo = path.join(__dirname, '..', '..', 'dist', 'cjs', 'lib', 'util') + '/';
const { createPacket, analysePacket } = require(repo + 'messageProtocol');
const { JSONtoPacketBuffer } = require(repo + 'jsonPacketUtil');
const PORT = +process.argv[2] || 53999;

// Mixer state: volume 0..1, mute 0/1
const state = {};
const mk = (type, n) => { for (let i = 1; i <= n; i++) state[`${type}/ch${i}`] = { volume: 0.5, mute: 0 }; };
mk('line', 16); mk('aux', 4); mk('main', 1);
state['line/ch3'].volume = 0.72; state['line/ch3'].mute = 1;

// Minimal UBJSON encoder (objects, strings, float32, int8)
const key = (s) => Buffer.concat([Buffer.from([0x69, s.length]), Buffer.from(s)]);
function enc(v) {
  if (typeof v === 'string') return Buffer.concat([Buffer.from('S'), key(v)]);
  if (Number.isInteger(v)) return Buffer.from([0x69, v]);
  if (typeof v === 'number') { const b = Buffer.alloc(5); b[0] = 0x64; b.writeFloatBE(v, 1); return b; }
  return Buffer.concat([Buffer.from('{'), ...Object.entries(v).map(([k, x]) => Buffer.concat([key(k), enc(x)])), Buffer.from('}')]);
}
function dump() {
  const children = {};
  for (const [path, values] of Object.entries(state)) {
    const [type, ch] = path.split('/');
    children[type] ??= { children: {} };
    children[type].children[ch] = { values };
  }
  return enc({ id: 'Synchronize', children });
}

const pv = [];
const sockets = new Set();
const pvPacket = (k, valueBuf) => createPacket('PV', Buffer.concat([Buffer.from(k + '\x00\x00\x00'), valueBuf]));
const server = net.createServer((sock) => {
  sockets.add(sock); sock.on('close', () => sockets.delete(sock)); sock.on('error', () => {});
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 6) {
      const len = buf.readUInt16LE(4);
      if (buf.length < len + 6) break;
      const pkt = buf.slice(0, len + 6); buf = buf.slice(len + 6);
      const [code, data] = analysePacket(pkt);
      if (code === 'JM') {
        const j = JSON.parse(data.slice(4));
        if (j.id === 'Subscribe') {
          sock.write(createPacket('JM', JSONtoPacketBuffer({ id: 'SubscriptionReply' })));
          const z = zlib.deflateSync(dump());
          const len4 = Buffer.alloc(4); len4.writeUInt32LE(z.length);
          sock.write(createPacket('ZB', Buffer.concat([len4, z])));
        }
      } else if (code === 'FR') {
        const id = data.readUInt16BE(0);
        const body = Buffer.from('ok');
        const h = Buffer.alloc(14);
        h.writeUInt16BE(id, 0); h.writeUInt16LE(body.length, 6); h.writeUInt16LE(body.length, 12);
        sock.write(createPacket('FD', Buffer.concat([h, body])));
      } else if (code === 'PV') {
        const i = data.indexOf(0);
        const k = data.slice(0, i).toString();
        const v = data.readFloatLE(i + 3);
        pv.push({ t: Date.now(), key: k, v: k.endsWith('/mute') ? v === 1 : Math.round(v * 1000) / 10 });
        const [type, ch, param] = k.split('/');
        if (state[`${type}/${ch}`]) state[`${type}/${ch}`][param] = param === 'mute' ? (v === 1 ? 1 : 0) : v;
      }
    }
  });
});
server.listen(PORT, () => console.log('fake mixer on', PORT));
process.on('message', (m) => {
  if (m === 'dump') return process.send(pv.splice(0));
  if (m === 'reset') for (const s of sockets) s.destroy();
  if (m === 'garbage') for (const s of sockets) s.write(Buffer.from('this is not a ucnet packet at all'));
  // Simulate a change on the console: { console: 'line/ch2/volume', value: 0.3 }
  if (m && m.console) {
    const isMute = m.console.endsWith('/mute');
    const b = Buffer.alloc(4); b.writeFloatLE(isMute ? (m.value ? 1 : 0) : m.value);
    for (const s of sockets) s.write(pvPacket(m.console, b));
  }
});
