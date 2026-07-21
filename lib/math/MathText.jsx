"use client";

import { useMemo } from "react";
import katex from "katex";
import { extractMathSpans } from "./normalize";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Renders an ALREADY-NORMALIZED string containing \( \) / \[ \] math spans.
// Never throws: a span KaTeX can't compile degrades to a visibly flagged
// <code> element so a question can never fail to display mid-section.
//
// Note: newlines are intentionally NOT converted to <br/>. The surrounding
// styles use `white-space: pre-line`, which already renders them — emitting
// <br/> as well would double-space every passage break.
function toHtml(input) {
  const text = typeof input === "string" ? input : "";
  if (!text) return "";
  const re = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const display = m[1] !== undefined;
    const tex = display ? m[1] : m[2];
    try {
      out += katex.renderToString(tex, {
        displayMode: display,
        output: "htmlAndMathml", // MathML keeps it readable to screen readers
        throwOnError: true,
        strict: "ignore",
      });
    } catch (e) {
      const msg = escapeHtml(String((e && e.message) || e));
      out += `<code class="math-error" title="${msg}">${escapeHtml(tex)}</code>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

export default function MathText({ children, className, block, style }) {
  const html = useMemo(() => toHtml(children), [children]);
  const Tag = block ? "div" : "span";
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

// True when the string has anything KaTeX needs to render (lets callers skip
// the component entirely for plain text).
export function hasMath(s) {
  return typeof s === "string" && extractMathSpans(s).length > 0;
}
