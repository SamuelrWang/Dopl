# Web fonts (self-hosted)

Loaded by `src/app/layout.tsx` through `next/font/local`. The build never fetches a font.

Each file is the **latin** subset of the family's variable font, exactly as Google Fonts'
CSS API served it on 2026-10-14 (request made with `next/font/google`'s own User-Agent,
so the format is woff2). Google served one file for every weight listed, so the layout
declares that file once per weight/style, as Google's CSS did.

| File | Family | Declared weights / style | Source (fonts.gstatic.com) | Bytes |
| --- | --- | --- | --- | --- |
| `hanken-grotesk-latin.woff2` | Hanken Grotesk v12 | 400 500 600 700 | `/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59CxCis4.woff2` | 34,664 |
| `geist-mono-latin.woff2` | Geist Mono v6 | 100–900 (variable) | `/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrcdmhHkjko.woff2` | 23,108 |
| `space-grotesk-latin.woff2` | Space Grotesk v22 | 400 500 600 700 | `/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2` | 22,320 |
| `jetbrains-mono-latin.woff2` | JetBrains Mono v24 | 400 500 | `/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2` | 31,340 |
| `newsreader-latin.woff2` | Newsreader v26 | 400 500 600 normal | `/s/newsreader/v26/cY9VfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBAbNJYQ5ayZC.woff2` | 58,152 |
| `newsreader-italic-latin.woff2` | Newsreader v26 | 400 500 600 italic | `/s/newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLFYYzbARA_n8.woff2` | 64,500 |
| `inter-latin.woff2` | Inter v20 | 300 400 500 600 700 | `/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2` | 48,432 |

Total 282,516 bytes. The CSS requests were
`https://fonts.googleapis.com/css2?family=<Family>:wght@<weights>&display=swap`
(Newsreader: `ital,wght@0,400;0,500;0,600;1,400;1,500;1,600`; Geist Mono: `wght@100..900`);
each file is the `/* latin */` block's `src`.

## License

All seven files are under the **SIL Open Font License 1.1**; the copyright lines and the
license text are in `OFL.txt` beside them (from `github.com/google/fonts`, `ofl/<family>/OFL.txt`).

## Updating

Re-run the same request, take the `/* latin */` block's URL, replace the file, and keep the
weights in `layout.tsx` in step with the request. Only add another subset if the product
starts rendering text outside latin in one of these faces.
