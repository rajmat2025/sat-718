import katex from "katex";

// Pure math-notation normalization. Runs ONCE at test load/import time — never
// during a timed section. Converts the various conventions test authors use
// ($...$, $$...$$, bare LaTeX) into a single \( \) / \[ \] convention, repairs
// what corruption it can, and reports what it can't fix.

// Private-use sentinel standing in for a literal \$ while we look for delimiters.
const ESC_DOLLAR = "\uE000";

// Mangled-escape repair table: a JSON string written with a single backslash
// turns "\frac" into formfeed + "rac". Key = control char + following letters.
const REPAIR_TABLE = [
  ["\u000C", "rac", "\\frac"], // \f
  ["\u000C", "orall", "\\forall"],
  ["\u0008", "inom", "\\binom"], // \b
  ["\u0008", "eta", "\\beta"],
  ["\u0008", "ar", "\\bar"],
  ["\r", "ightarrow", "\\rightarrow"],
  ["\t", "imes", "\\times"],
  ["\t", "heta", "\\theta"],
  ["\t", "riangle", "\\triangle"],
  ["\t", "ext", "\\text"],
  ["\t", "an", "\\tan"],
  ["\n", "eq", "\\neq"],
];

// \b \v \f \r are never legitimate in test prose; \t and \n are (passage breaks).
const ALWAYS_CORRUPT = /[\u0008\u000B\u000C\r]/;

const SYMBOLIC_CHARSET = /^[\s\w+\-*/=<>^_{}().,|:!'\\[\]πθλμαβ√×÷≤≥≠≈°]+$/;

function repairEscapes(input) {
  const repairs = [];
  let text = input;
  // \t / \n repairs are only safe where the string is plausibly math at all.
  const plausiblyMath = text.includes("$") || text.includes("\\");
  for (const [ctrl, suffix, intended] of REPAIR_TABLE) {
    const risky = ctrl === "\t" || ctrl === "\n";
    if (risky && !plausiblyMath) continue;
    const needle = ctrl + suffix;
    while (text.includes(needle)) {
      text = text.replace(needle, intended);
      repairs.push({ from: JSON.stringify(needle), to: intended });
    }
  }
  return { text, repairs };
}

// Decide whether the text between a pair of unescaped $ is math or currency.
// SAT word problems are full of literal dollars, so this errs toward currency.
function isMathSpan(span) {
  if (!span.trim()) return false;
  if (span.includes("\n")) return false; // math spans don't cross lines
  // A LaTeX command (or an escaped \$) is decisive: prose never contains
  // backslashes, so length/punctuation heuristics must not veto it.
  if (span.includes(ESC_DOLLAR)) return true;
  if (span.includes("\\")) return true;
  if (span.length > 80) return false;
  if (/[.?!]\s/.test(span)) return false; // sentence punctuation => prose

  const compact = !/\s/.test(span);
  if (compact && span.length <= 20) return true; // "x", "xy", "2x", "1{,}200"

  const words = (span.match(/[A-Za-z]{2,}/g) || []).length;
  if (words >= 2) return false; // prose guard: "5 a pound and pears cost"

  const structural = /[\^_{}]/.test(span);
  const relational = /[=<>≤≥≠]/.test(span);
  if (words === 0 && SYMBOLIC_CHARSET.test(span)) {
    // "a + h + k" is math; "20 - " sitting between two prices is not.
    if (/[A-Za-z]/.test(span) || structural || relational) return true;
  }
  return structural || relational;
}

function restoreEscapedDollars(text) {
  let out = "";
  let i = 0;
  const re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += text.slice(i, m.index).split(ESC_DOLLAR).join("$"); // outside math
    out += m[0].split(ESC_DOLLAR).join("\\$"); // inside math: KaTeX renders \$
    i = m.index + m[0].length;
  }
  out += text.slice(i).split(ESC_DOLLAR).join("$");
  return out;
}

function convertDollarSpans(input, problems) {
  // Protect \$ so escaped dollars are never mistaken for delimiters.
  let text = input.split("\\$").join(ESC_DOLLAR);

  // $$...$$ is unambiguous — never currency.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => `\\[${inner}\\]`);

  const segs = text.split("$");
  if (segs.length > 1) {
    if (segs.length % 2 === 0) {
      // Odd number of $ — treat every one as currency, convert nothing.
      if (/\\[a-zA-Z]+/.test(text)) {
        problems.push({
          kind: "odd-dollar-with-latex",
          detail: "Odd number of '$' but the text contains LaTeX; left as currency.",
        });
      }
    } else {
      let out = segs[0];
      for (let i = 1; i < segs.length; i += 2) {
        const span = segs[i];
        const after = segs[i + 1] ?? "";
        out += isMathSpan(span) ? `\\(${span}\\)` : `$${span}$`;
        out += after;
      }
      text = out;
    }
  }

  return restoreEscapedDollars(text);
}

function hasMathDelimiters(s) {
  return s.includes("\\(") || s.includes("\\[");
}

// A whole string that is itself an expression — common for answer choices that
// arrive as bare LaTeX with no $ delimiters, e.g. "\frac{8}{3}" or "25\pi".
// Only a real LaTeX command counts as "stray LaTeX". Bare "x^3" is a
// plain-text convention, not an authoring error.
function looksLikeBareExpression(s) {
  const t = s.trim();
  if (!t) return false;
  if (t.length > 400) return false;
  return /\\[a-zA-Z]+/.test(t);
}

// Real LaTeX intent. Deliberately does NOT match bare "x^2" — that is a
// plain-text convention some tests use, and rendering only part of such a
// question as math looks broken.
const LATEX_MARKER = /\\[a-zA-Z]+|\^\{|_\{/;

export function hasLatexIntent(s) {
  return typeof s === "string" && (s.includes("\\(") || s.includes("\\[") || LATEX_MARKER.test(s));
}

// Within a question already established as math, should this choice be
// rendered as math? Prose answers ("No solution") must stay prose.
export function choiceLooksLikeExpression(c) {
  const t = String(c ?? "").trim();
  if (!t) return false;
  if (t.length > 120) return false;
  if (/[.?!]\s/.test(t)) return false; // reads as a sentence
  if (LATEX_MARKER.test(t)) return true;
  if (!/[\^_/{}]/.test(t)) return false; // plain number or word — leave alone
  const words = (t.match(/[A-Za-z]{2,}/g) || []).length;
  return words <= 1;
}

export function extractMathSpans(text) {
  const spans = [];
  const re = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) spans.push({ tex: m[1], display: true });
    else spans.push({ tex: m[2], display: false });
  }
  return spans;
}

export function normalizeMathText(input, options = {}) {
  const { context } = options;
  const problems = [];
  if (typeof input !== "string" || input === "") {
    return { text: typeof input === "string" ? input : "", repairs: [], problems };
  }

  const repaired = repairEscapes(input);
  let text = repaired.text;

  if (ALWAYS_CORRUPT.test(text)) {
    problems.push({
      kind: "unrepaired-control-char",
      detail: "Contains a control character left over from a mangled backslash escape.",
    });
  }

  text = convertDollarSpans(text, problems);

  // Stray LaTeX command sitting outside any math span: report it (we don't
  // guess at wrapping prose). Choice wrapping is decided per-question in
  // normalizeTest, which has the context to know whether the item is math.
  if (context !== "choice" && !hasMathDelimiters(text) && looksLikeBareExpression(text)) {
    problems.push({
      kind: "bare-latex",
      detail: "LaTeX command outside any math delimiter; it will render literally.",
      sample: text.slice(0, 90),
    });
  }

  // Display math inside an answer choice breaks the option row layout.
  if (context === "choice") {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\\(${inner}\\)`);
  }

  // Validate that every span actually compiles.
  for (const span of extractMathSpans(text)) {
    try {
      katex.renderToString(span.tex, {
        displayMode: span.display,
        throwOnError: true,
        strict: false,
      });
    } catch (e) {
      problems.push({ kind: "katex-error", detail: String((e && e.message) || e), tex: span.tex });
    }
  }

  return { text, repairs: repaired.repairs, problems };
}

// Walk a whole test. Stems, explanations, and choices are normalized; grid-in
// `answer` values are deliberately left untouched — grading compares raw text
// and must never see LaTeX.
export function normalizeTest(test) {
  const report = { repairs: 0, problems: [] };
  if (!test || !Array.isArray(test.sections)) return { test, report };

  const run = (value, context, where) => {
    const r = normalizeMathText(value, { context });
    report.repairs += r.repairs.length;
    for (const p of r.problems) report.problems.push({ ...p, where });
    return r.text;
  };

  const sections = test.sections.map((section) => ({
    ...section,
    questions: section.questions.map((q, qi) => {
      const where = `${section.name} Q${qi + 1}`;
      const next = {
        ...q,
        q: run(q.q, "stem", where),
        explanation: q.explanation ? run(q.explanation, "stem", where) : q.explanation,
      };
      if (Array.isArray(q.choices)) {
        const converted = q.choices.map((c) => run(c, "choice", where));
        // Decide once per question: does this item use LaTeX at all? If so,
        // bare expressions among its choices get wrapped so the whole question
        // renders consistently. If not (e.g. plain "5x^7"), nothing is touched.
        const mathy =
          hasLatexIntent(next.q) ||
          hasLatexIntent(next.explanation) ||
          converted.some(hasLatexIntent);
        next.choices = converted.map((c) => {
          if (!mathy) return c;
          if (c.includes("\\(") || c.includes("\\[")) return c;
          if (!choiceLooksLikeExpression(c)) return c;
          const wrapped = `\\(${c.trim()}\\)`;
          try {
            katex.renderToString(c.trim(), { throwOnError: true, strict: false });
          } catch (e) {
            report.problems.push({
              kind: "katex-error",
              detail: String((e && e.message) || e),
              tex: c,
              where,
            });
            return c; // leave it as plain text rather than emit broken math
          }
          return wrapped;
        });
      }
      if (q.type === "grid") {
        const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
        for (const a of answers) {
          if (typeof a === "string" && /\\/.test(a)) {
            report.problems.push({
              kind: "grid-answer-latex",
              detail: `Grid-in answer "${a}" contains LaTeX; grading compares raw text so it can never match.`,
              where,
            });
          }
        }
      }
      return next;
    }),
  }));

  return { test: { ...test, sections }, report };
}
