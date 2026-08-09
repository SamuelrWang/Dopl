// One-off: regenerate all Dopl logo assets padded onto a black rounded square so
// the crystal mark no longer runs to the edge. Source of truth is the unpadded
// crystal at scripts/assets/dopl-mark-source.png.
//
//   node scripts/gen-padded-icons.mjs
//
// Regenerates the web favicons + favicon.ico, and the desktop iconset/icns.
// Desktop app must be rebuilt (cd dopl-desktop-app && npm run build) to ship it.
//
// P0-4 (2026-08-07): the source MOVED out of `public/favicons/`. Everything under
// `public/` is served, so a 297KB build input that no page references was shipping
// to production as a public URL. It is an INPUT to this script, not an asset, and
// `scripts/assets/` is where inputs live. Deleting it outright was the ticket's
// suggestion and would have silently broken this script — it is the only thing
// that references the file, which is exactly why the reference was easy to miss.

import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const SRC = "scripts/assets/dopl-mark-source.png";
const CRYSTAL_SCALE = 0.7; // crystal occupies 70% of the canvas; rest is padding
const RADIUS_FRAC = 0.22; // iOS-style squircle corner radius

const srcBuf = await sharp(SRC).toBuffer();

async function makeIcon(size) {
  const r = Math.round(size * RADIUS_FRAC);
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#000000"/></svg>`,
  );
  const inner = Math.round(size * CRYSTAL_SCALE);
  const crystal = await sharp(srcBuf)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(bg).composite([{ input: crystal, gravity: "center" }]).png().toBuffer();
}

// Web favicons.
const web = {
  "public/favicons/favicon-32x32.png": 32,
  "public/favicons/apple-touch-icon.png": 180,
  "public/favicons/android-chrome-192x192.png": 192,
  "public/favicons/android-chrome-512x512.png": 512,
};
for (const [path, size] of Object.entries(web)) {
  await writeFile(path, await makeIcon(size));
  console.log("wrote", path);
}

// favicon.ico (multi-resolution).
const ico = await pngToIco(await Promise.all([16, 32, 48].map(makeIcon)));
await writeFile("public/favicons/favicon.ico", ico);
console.log("wrote public/favicons/favicon.ico");

// macOS desktop iconset -> icns.
const iconset = "dopl-desktop-app/build/icon.iconset";
const macSizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of macSizes) {
  await writeFile(`${iconset}/${name}`, await makeIcon(size));
}
console.log("wrote", iconset, "(10 sizes)");

execFileSync("iconutil", ["-c", "icns", iconset, "-o", "dopl-desktop-app/build/icon.icns"]);
console.log("wrote dopl-desktop-app/build/icon.icns");
