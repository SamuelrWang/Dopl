// Device control over Cast: read what a speaker is doing and the commands it accepts right now,
// then send one of them. This is the Google Home translator behind the cross-device pair
// `device_status` / `device_command`: the command list is read off the device (receiver status +
// media status), never hard-coded per app, so "stop" stops Spotify, YouTube Music, a podcast or a
// Dopl message alike.
//
//   receiver GET_STATUS  -> volume {level, muted} + the running app {appId, displayName, sessionId,
//                           transportId, namespaces}
//   media GET_STATUS     -> {mediaSessionId, playerState, supportedMediaCommands, media.metadata}
//                           (only when the app speaks the media namespace; some apps do not)
//
// Commands: set_volume / mute / unmute (receiver, always), stop (receiver STOP of the running
// session), pause / play (media, when the session reports it can).

const { withCastChannel, NS, RECEIVER } = require('./cast-client');

const MEDIA_STATUS_MS = 3000;
// supportedMediaCommands bit 0 = PAUSE (Cast media spec).
const CAN_PAUSE = 1;

class DeviceCommandError extends Error {}

/** `{status:{applications:[...]}}` → the running app, or null when only the idle screen runs. */
function runningApp(receiverStatus) {
  const apps = (receiverStatus && receiverStatus.applications) || [];
  const app = apps.find((a) => !a.isIdleScreen);
  if (!app) return null;
  const namespaces = (app.namespaces || []).map((n) => n.name);
  return {
    appId: app.appId,
    name: app.displayName || app.appId,
    statusText: app.statusText || null,
    sessionId: app.sessionId,
    transportId: app.transportId,
    hasMedia: namespaces.includes(NS.media),
  };
}

/** The commands this state allows, each with its args. Order is stable. */
function commandsFor({ app, media }) {
  const out = [
    { name: 'set_volume', args: { level: 'number 0-1' } },
    { name: 'mute' },
    { name: 'unmute' },
  ];
  if (media && media.state === 'PLAYING' && media.canPause) out.push({ name: 'pause' });
  if (media && media.state === 'PAUSED') out.push({ name: 'play' });
  if (app) out.push({ name: 'stop' });
  return out;
}

async function readMedia(channel, app) {
  if (!app || !app.hasMedia || !app.transportId) return null;
  channel.send(NS.connection, app.transportId, { type: 'CONNECT' });
  let reply;
  try {
    reply = await channel.request(NS.media, app.transportId, { type: 'GET_STATUS' }, MEDIA_STATUS_MS);
  } catch (_) {
    return null; // an app may claim the namespace and never answer; the receiver half still stands
  }
  const s = Array.isArray(reply.status) ? reply.status[0] : null;
  if (!s) return null;
  const meta = (s.media && s.media.metadata) || {};
  return {
    mediaSessionId: s.mediaSessionId,
    state: s.playerState || null,
    canPause: ((s.supportedMediaCommands || 0) & CAN_PAUSE) === CAN_PAUSE,
    title: meta.title || null,
    artist: meta.artist || meta.subtitle || null,
  };
}

async function readState(channel) {
  const r = await channel.request(NS.receiver, RECEIVER, { type: 'GET_STATUS' });
  const status = r.status || {};
  const app = runningApp(status);
  const media = await readMedia(channel, app);
  const volume = status.volume || {};
  return { app, media, volume: { level: typeof volume.level === 'number' ? volume.level : null, muted: !!volume.muted } };
}

/** The public view of a state: no transport or session ids. */
function publicState({ app, media, volume }) {
  return {
    playing: app ? {
      app: app.name,
      state: media ? media.state : null,
      title: media ? media.title : null,
      artist: media ? media.artist : null,
    } : null,
    volume,
    commands: commandsFor({ app, media }),
  };
}

/** What `target` is doing and the commands it accepts now. */
function readDeviceState(target, options) {
  return withCastChannel(target, options, async (channel) => publicState(await readState(channel)));
}

/** Send one command (a name from `commands`), then return the device's state after it. */
function sendDeviceCommand(target, command, args = {}, options) {
  return withCastChannel(target, options, async (channel) => {
    const state = await readState(channel);
    const allowed = commandsFor(state).map((c) => c.name);
    if (!allowed.includes(command)) {
      throw new DeviceCommandError(`${target.name} cannot ${command} right now. It accepts: ${allowed.join(', ')}`);
    }
    const { app, media } = state;
    if (command === 'set_volume') {
      const level = Number(args.level);
      if (!Number.isFinite(level) || level < 0 || level > 1) throw new DeviceCommandError('level must be a number from 0 to 1');
      await channel.request(NS.receiver, RECEIVER, { type: 'SET_VOLUME', volume: { level } });
    } else if (command === 'mute' || command === 'unmute') {
      await channel.request(NS.receiver, RECEIVER, { type: 'SET_VOLUME', volume: { muted: command === 'mute' } });
    } else if (command === 'stop') {
      await channel.request(NS.receiver, RECEIVER, { type: 'STOP', sessionId: app.sessionId });
    } else {
      await channel.request(NS.media, app.transportId, { type: command === 'pause' ? 'PAUSE' : 'PLAY', mediaSessionId: media.mediaSessionId });
    }
    return publicState(await readState(channel));
  });
}

module.exports = { readDeviceState, sendDeviceCommand, commandsFor, DeviceCommandError };
