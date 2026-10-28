// What a Google Home plays or shows, produced on this Mac with no third-party service:
//   - speech: macOS `say` → AAC in an .m4a (a Cast-supported audio format)
//   - a card: an SVG laid out here → PNG by macOS `sips` (Cast images: PNG, ≤1280x720)
// No text leaves the machine except to the user's own speaker. `run` is the execFile seam tests stub.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CARD_W = 1280;
const CARD_H = 720;
const TITLE_CHARS = 32; // per line at 64px Helvetica across the card's text width
const LINE_CHARS = 52; // per line at 40px

function defaultRun(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${(stderr && String(stderr).trim()) || err.message}`));
      else resolve();
    });
  });
}

function workDir() {
  const dir = path.join(os.tmpdir(), 'dopl-google-home');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const fileIn = (dir, ext) => path.join(dir, `${crypto.randomBytes(8).toString('hex')}.${ext}`);

function assertMac(platform) {
  if (platform !== 'darwin') throw new Error('Speech and cards are rendered with macOS tools; on this OS pass audio_url / image_url instead.');
}

/** Speak `text` into an .m4a. Text goes through a file, so a leading dash is never read as a flag. */
async function synthesizeSpeech(text, { voice, run = defaultRun, dir = workDir(), platform = process.platform } = {}) {
  assertMac(platform);
  const input = fileIn(dir, 'txt');
  const out = fileIn(dir, 'm4a');
  fs.writeFileSync(input, text, { mode: 0o600 });
  try {
    const args = ['-f', input, '-o', out, '--file-format=m4af', '--data-format=aac'];
    if (voice) args.unshift('-v', voice);
    await run('say', args);
  } finally {
    fs.rmSync(input, { force: true });
  }
  return { file: out, contentType: 'audio/mp4' };
}

const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Greedy word wrap; a word longer than the width is hard-split. */
function wrap(text, width) {
  const out = [];
  let line = '';
  for (const raw of String(text).split(/\s+/).filter(Boolean)) {
    let word = raw;
    while (word.length > width) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, width)); word = word.slice(width); }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** The card as SVG: title (≤2 wrapped lines) then body lines, cut to what fits on 720px. */
function cardSvg({ title, lines = [] }) {
  const rows = [];
  let y = 150;
  for (const t of wrap(title, TITLE_CHARS).slice(0, 2)) { rows.push({ y, size: 64, weight: 600, fill: '#111111', text: t }); y += 80; }
  y += 30;
  for (const l of lines.flatMap((x) => wrap(x, LINE_CHARS))) {
    if (y > CARD_H - 60) break;
    rows.push({ y, size: 40, weight: 400, fill: '#555555', text: l });
    y += 60;
  }
  const text = rows
    .map((r) => `<text x="80" y="${r.y}" font-family="Helvetica, Arial, sans-serif" font-size="${r.size}" font-weight="${r.weight}" fill="${r.fill}">${escapeXml(r.text)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}"><rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>${text}</svg>`;
}

/** Render the card to a 1280x720 PNG. */
async function renderCard(card, { run = defaultRun, dir = workDir(), platform = process.platform } = {}) {
  assertMac(platform);
  const svg = fileIn(dir, 'svg');
  const out = fileIn(dir, 'png');
  fs.writeFileSync(svg, cardSvg(card), { mode: 0o600 });
  try {
    await run('sips', ['-s', 'format', 'png', svg, '--out', out]);
  } finally {
    fs.rmSync(svg, { force: true });
  }
  return { file: out, contentType: 'image/png' };
}

module.exports = { synthesizeSpeech, renderCard, cardSvg, wrap, escapeXml };
