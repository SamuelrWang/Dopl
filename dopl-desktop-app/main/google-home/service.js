// The Google Home device for Dopl: status, capabilities, notify (spoken) and show (a card on a
// Nest Hub), plus the cross-device control pair (device_status / device_command). Same intent vocabulary as the glasses (`glasses_status/capabilities/notify/show`), so
// Google Home is the second device behind one set of intents. `ask` is NOT offered: Cast is
// output-only (no tap or voice answer reaches a third-party sender), and capabilities says so.
// Every network effect goes through `deps`, so tests run with no LAN.

const { discoverDevices } = require('./discovery');
const { castMedia } = require('./cast-client');
const { synthesizeSpeech, renderCard } = require('./render');
const { createMediaServer } = require('./media-server');
const { readDeviceState, sendDeviceCommand, DeviceCommandError } = require('./device-control');

const LIMITS = { text: 500, title: 80, line: 120, lines: 6 };
const CACHE_MS = 60 * 1000;

class GoogleHomeError extends Error {}

const bounded = (value, max, field) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new GoogleHomeError(`${field} is required`);
  if (s.length > max) throw new GoogleHomeError(`${field} is ${s.length} chars; max ${max}`);
  return s;
};

const httpUrl = (value, field) => {
  let u;
  try { u = new URL(String(value)); } catch (_) { throw new GoogleHomeError(`${field} is not a URL`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new GoogleHomeError(`${field} must be http(s)`);
  return u.toString();
};

const publicRow = (d) => ({ id: d.id, name: d.name, model: d.model, display: d.display, group: d.group });

function createGoogleHome(overrides = {}) {
  const deps = {
    discover: discoverDevices,
    cast: castMedia,
    speak: synthesizeSpeech,
    card: renderCard,
    media: null,
    state: readDeviceState,
    control: sendDeviceCommand,
    now: () => Date.now(),
    ...overrides,
  };
  const media = () => (deps.media ??= createMediaServer());
  let cache = null; // {at, devices}

  async function devices({ refresh = false } = {}) {
    if (!refresh && cache && deps.now() - cache.at < CACHE_MS) return cache.devices;
    const found = await deps.discover();
    cache = { at: deps.now(), devices: found };
    return found;
  }

  /** `device` is an id or a name (case-insensitive). Omitted: the one speaker on the network. */
  async function resolveDevice(device, { needsDisplay = false } = {}) {
    let list = await devices();
    if (device && !list.some((d) => matches(d, device))) list = await devices({ refresh: true });
    if (!list.length) throw new GoogleHomeError('No Google Home found on this network. Same Wi-Fi as this computer? Call google_home_status to rescan.');
    let pick;
    if (device) {
      pick = list.find((d) => matches(d, device));
      if (!pick) throw new GoogleHomeError(`No device "${device}". Found: ${names(list)}`);
    } else {
      const pool = list.filter((d) => !d.group && (!needsDisplay || d.display));
      if (pool.length !== 1) {
        throw new GoogleHomeError(pool.length
          ? `Several devices found; pass device. Found: ${names(pool)}`
          : `No ${needsDisplay ? 'Nest Hub (a device with a screen)' : 'speaker'} found. Found: ${names(list)}`);
      }
      pick = pool[0];
    }
    if (needsDisplay && !pick.display) throw new GoogleHomeError(`${pick.name} has no screen; use google_home_notify to speak instead.`);
    return pick;
  }

  async function status({ refresh = true } = {}) {
    const list = await devices({ refresh });
    return { online: list.length > 0, count: list.length, devices: list.map(publicRow) };
  }

  function capabilities() {
    return {
      transport: 'Google Cast over the local network, sent from this computer',
      notify: { supported: true, output: 'spoken (macOS voice), or your own audio_url', limits: { text: LIMITS.text } },
      show: {
        supported: true,
        devices: 'Nest Hub / Nest Hub Max / Chromecast (display:true in google_home_status)',
        output: `a 1280x720 card (title + up to ${LIMITS.lines} lines), or your own image_url; optional spoken copy`,
        limits: { title: LIMITS.title, line: LIMITS.line, lines: LIMITS.lines },
      },
      ask: { supported: false, reason: 'Cast is output-only: an answer cannot come back from the speaker. Use glasses_ask or dopl_show.' },
      device_control: {
        supported: true,
        tools: 'device_status lists what each device is playing and the commands it accepts now; device_command sends one',
        commands: 'set_volume, mute, unmute always; stop while an app is playing; pause / play when the app allows it',
        not_covered: 'choosing what to play, and smart-home devices (lights, thermostats): Google Home MCP or Home Assistant',
      },
    };
  }

  async function notify(args = {}) {
    const target = await resolveDevice(args.device);
    let url;
    let contentType = 'audio/mp4';
    let text = '';
    if (args.audio_url) {
      url = httpUrl(args.audio_url, 'audio_url');
      contentType = typeof args.content_type === 'string' && args.content_type ? args.content_type : 'audio/mpeg';
    } else {
      text = bounded(args.text, LIMITS.text, 'text');
      const audio = await deps.speak(text, { voice: args.voice });
      url = await media().publish(audio.file, audio.contentType, target.host);
    }
    const r = await deps.cast(target, { url, contentType, title: args.title || 'Dopl', subtitle: text.slice(0, LIMITS.line) || undefined });
    return { ok: true, device: publicRow(target), status: r.playerState || 'loaded', media_session_id: r.mediaSessionId };
  }

  async function show(args = {}) {
    const target = await resolveDevice(args.device, { needsDisplay: true });
    const title = bounded(args.title, LIMITS.title, 'title');
    const lines = Array.isArray(args.lines) ? args.lines : [];
    if (lines.length > LIMITS.lines) throw new GoogleHomeError(`lines has ${lines.length} items; max ${LIMITS.lines}`);
    lines.forEach((l, i) => bounded(l, LIMITS.line, `lines[${i}]`));
    const imageUrl = args.image_url
      ? httpUrl(args.image_url, 'image_url')
      : await media().publish((await deps.card({ title, lines })).file, 'image/png', target.host);
    const subtitle = lines.join(' · ').slice(0, LIMITS.line) || undefined;
    let r;
    if (args.speak) {
      // Spoken copy: play the speech with the card as its artwork, so the Hub shows it while talking.
      const audio = await deps.speak([title, ...lines].join('. '), { voice: args.voice });
      const url = await media().publish(audio.file, audio.contentType, target.host);
      r = await deps.cast(target, { url, contentType: audio.contentType, title, subtitle, imageUrl });
    } else {
      r = await deps.cast(target, { url: imageUrl, contentType: imageType(imageUrl), title, subtitle });
    }
    return { ok: true, device: publicRow(target), status: r.playerState || 'loaded', media_session_id: r.mediaSessionId };
  }

  /** Live state + accepted commands. `device` omitted: every device that is not a group. */
  async function deviceStatus(args = {}) {
    const targets = args.device ? [await resolveDevice(args.device)] : (await devices({ refresh: true })).filter((d) => !d.group);
    if (!targets.length) throw new GoogleHomeError('No Google Home found on this network. Same Wi-Fi as this computer?');
    const rows = await Promise.all(targets.map(async (d) => {
      try {
        return { device: publicRow(d), kind: 'google_home', ...(await deps.state(d)) };
      } catch (err) {
        return { device: publicRow(d), kind: 'google_home', error: `unreachable: ${err && err.message ? err.message : err}` };
      }
    }));
    return { count: rows.length, devices: rows };
  }

  /** One command from that device's `commands`; returns its state afterwards. */
  async function deviceCommand(args = {}) {
    const command = typeof args.command === 'string' ? args.command.trim().toLowerCase() : '';
    if (!command) throw new GoogleHomeError('command is required; device_status lists each device\'s commands');
    const target = await resolveDevice(args.device);
    try {
      const after = await deps.control(target, command, args.args || {});
      return { ok: true, device: publicRow(target), command, ...after };
    } catch (err) {
      if (err instanceof DeviceCommandError) throw new GoogleHomeError(err.message);
      throw err;
    }
  }

  return { status, capabilities, notify, show, deviceStatus, deviceCommand, close: () => deps.media && deps.media.close() };
}

function matches(d, wanted) {
  const w = String(wanted).trim().toLowerCase();
  return d.id.toLowerCase() === w || d.name.toLowerCase() === w;
}
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', png: 'image/png' };
const imageType = (url) => IMAGE_TYPES[(/\.([a-z]+)$/i.exec(new URL(url).pathname) || [])[1]?.toLowerCase()] || 'image/png';
const names = (list) => list.map((d) => `${d.name}${d.display ? ' (screen)' : ''}${d.group ? ' (group)' : ''}`).join(', ');

module.exports = { createGoogleHome, GoogleHomeError, LIMITS };
