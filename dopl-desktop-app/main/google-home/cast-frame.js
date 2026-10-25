// Google Cast v2 wire format: a 4-byte big-endian length, then one protobuf `CastMessage`
// (cast_channel.proto). Hand-encoded rather than pulling protobufjs@6 through `castv2` (MIT):
// the message has seven fields and only string payloads are used, so ~80 lines replace a
// dependency tree with a known prototype-pollution history. Field numbers follow
// https://chromium.googlesource.com/chromium/src/+/main/components/cast_channel/proto/cast_channel.proto
//
//   1 protocol_version (enum, 0 = CASTV2_1_0)   2 source_id   3 destination_id   4 namespace
//   5 payload_type (enum, 0 = STRING, 1 = BINARY)   6 payload_utf8   7 payload_binary

const WIRE_VARINT = 0;
const WIRE_LEN = 2;

function varint(n) {
  const out = [];
  let v = n >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return Buffer.from(out);
}

const key = (field, wire) => varint((field << 3) | wire);

function lenField(field, value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([key(field, WIRE_LEN), varint(buf.length), buf]);
}

/** One CastMessage with a UTF-8 payload (proto2: the required enums are written even at 0). */
function encodeMessage({ sourceId, destinationId, namespace, data }) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return Buffer.concat([
    key(1, WIRE_VARINT), varint(0),
    lenField(2, sourceId),
    lenField(3, destinationId),
    lenField(4, namespace),
    key(5, WIRE_VARINT), varint(0),
    lenField(6, payload),
  ]);
}

/** Length-prefixed frame, ready for the socket. */
function encodeFrame(message) {
  const body = encodeMessage(message);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function readVarint(buf, at) {
  let result = 0;
  let shift = 0;
  let pos = at;
  for (;;) {
    if (pos >= buf.length) throw new Error('cast frame: truncated varint');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value: result, next: pos };
    shift += 7;
    if (shift > 35) throw new Error('cast frame: varint too long');
  }
}

/** Decode one CastMessage body. Unknown fields are skipped; `data` is parsed JSON when it parses. */
function decodeMessage(buf) {
  const out = { sourceId: '', destinationId: '', namespace: '', payloadType: 0, payload: '', data: null };
  let pos = 0;
  while (pos < buf.length) {
    const k = readVarint(buf, pos);
    pos = k.next;
    const field = Math.floor(k.value / 8);
    const wire = k.value & 7;
    if (wire === WIRE_VARINT) {
      const v = readVarint(buf, pos);
      pos = v.next;
      if (field === 5) out.payloadType = v.value;
    } else if (wire === WIRE_LEN) {
      const len = readVarint(buf, pos);
      const end = len.next + len.value;
      if (end > buf.length) throw new Error('cast frame: truncated field');
      const slice = buf.subarray(len.next, end);
      pos = end;
      if (field === 2) out.sourceId = slice.toString('utf8');
      else if (field === 3) out.destinationId = slice.toString('utf8');
      else if (field === 4) out.namespace = slice.toString('utf8');
      else if (field === 6) out.payload = slice.toString('utf8');
    } else {
      throw new Error(`cast frame: unsupported wire type ${wire}`);
    }
  }
  if (out.payload) { try { out.data = JSON.parse(out.payload); } catch (_) { out.data = null; } }
  return out;
}

const MAX_FRAME = 64 * 1024;

/** Accumulates socket chunks and yields whole decoded messages. */
function createFrameReader(onMessage) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 4) {
      const len = pending.readUInt32BE(0);
      if (len > MAX_FRAME) throw new Error(`cast frame: ${len} bytes exceeds ${MAX_FRAME}`);
      if (pending.length < 4 + len) return;
      const body = pending.subarray(4, 4 + len);
      pending = pending.subarray(4 + len);
      onMessage(decodeMessage(body));
    }
  };
}

module.exports = { encodeMessage, encodeFrame, decodeMessage, createFrameReader };
