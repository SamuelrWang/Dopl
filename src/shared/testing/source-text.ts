/**
 * Source read as text, for tests that pin what a render cannot see (class strings, constant names,
 * CSS declarations). `readCode` blanks comments first, so a docblock can never satisfy — or trip — a
 * pin. Every helper fails closed: unparseable input, a missing marker or an inverted slice throws.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The file's text with CRLF normalised, so a Windows checkout cannot move a multi-line pin. */
export function readSource(file: string | URL): string {
  const path = typeof file === "string" ? file : fileURLToPath(file);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.[jt]sx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Ranges whose `//` or `/*` is text, not a comment: string/template/regex literals and JSX text. */
function literalRanges(sf: ts.SourceFile): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    switch (node.kind) {
      case ts.SyntaxKind.JsxText:
        out.push([node.pos, node.end]);
        return;
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.RegularExpressionLiteral:
        out.push([node.getStart(sf), node.end]);
        return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a, b) => a[0] - b[0]);
}

/** TS/TSX/JS with every comment blanked (offsets and line numbers kept); literals and JSX text untouched. */
export function tsCode(src: string, fileName = "source.tsx"): string {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false, scriptKind(fileName));
  // `parseDiagnostics` is internal but long-stable; a file that doesn't parse must not be scanned.
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const why = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ");
    throw new Error(`source-text: ${fileName} does not parse (${why})`);
  }
  const literals = literalRanges(sf);
  let out = "";
  let i = 0;
  let next = 0;
  while (i < src.length) {
    while (next < literals.length && literals[next][1] <= i) next++;
    if (next < literals.length && literals[next][0] === i) {
      out += src.slice(i, literals[next][1]);
      i = literals[next][1];
      continue;
    }
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) throw new Error(`source-text: unterminated comment in ${fileName}`);
      out += blank(src.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** CSS with every `/* … *\/` blanked (offsets and line numbers kept). */
export function cssCode(css: string, fileName = "source.css"): string {
  return css.replace(/\/\*[\s\S]*?(\*\/|$)/g, (comment, close: string) => {
    if (!close) throw new Error(`source-text: unterminated comment in ${fileName}`);
    return blank(comment);
  });
}

/** Comments blanked by the file's own language (CSS by `.css`, everything else parsed as TS/JS). */
export function codeOnly(src: string, fileName: string): string {
  return fileName.endsWith(".css") ? cssCode(src, fileName) : tsCode(src, fileName);
}

/** {@link readSource} with comments blanked. */
export function readCode(file: string | URL): string {
  const name = typeof file === "string" ? file : fileURLToPath(file);
  return codeOnly(readSource(file), name);
}

/** `src` from the first `from` up to the first `to` after it; throws when either is missing. */
export function between(src: string, from: string, to: string): string {
  const i = src.indexOf(from);
  if (i === -1) throw new Error(`source-text: start marker not found: ${JSON.stringify(from)}`);
  const j = src.indexOf(to, i + from.length);
  if (j === -1) throw new Error(`source-text: end marker not found after start: ${JSON.stringify(to)}`);
  return src.slice(i, j);
}
