/**
 * Per-channel "latest value wins" throttle for level writes.
 *
 * A burst of level requests for the same channel (e.g. a slider being dragged)
 * results in at most one mixer write per `intervalMs`. The first value is sent
 * immediately, intermediate values are replaced by newer ones, and the most
 * recent value is always sent once the interval elapses, so the fader always
 * ends up where the slider stopped.
 */
function createLevelCoalescer(send, intervalMs = 25) {
  // key -> { lastSent: number, pending: { selector, level } | null, timer }
  const channels = new Map();

  function flush(key) {
    const entry = channels.get(key);
    entry.timer = null;
    if (!entry.pending) return;

    const { selector, level } = entry.pending;
    entry.pending = null;
    entry.lastSent = Date.now();
    send(selector, level);
  }

  function set(selector, level) {
    const key = `${selector.type}/${selector.channel}`;
    let entry = channels.get(key);
    if (!entry) {
      entry = { lastSent: 0, pending: null, timer: null };
      channels.set(key, entry);
    }

    entry.pending = { selector, level };
    if (entry.timer) return; // A flush is already scheduled; it will pick up this value

    const wait = entry.lastSent + intervalMs - Date.now();
    if (wait <= 0) {
      flush(key);
    } else {
      entry.timer = setTimeout(() => flush(key), wait);
    }
  }

  function clear() {
    for (const entry of channels.values()) {
      clearTimeout(entry.timer);
    }
    channels.clear();
  }

  return { set, clear };
}

module.exports = { createLevelCoalescer };
