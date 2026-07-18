"use client";

import { useEffect, useRef, useState } from "react";
import { validateTest, slugify } from "../lib/testSchema";

const LS_IMPORTED = "satrunner.importedTests"; // legacy per-browser store — migrated to the server for admins
const LS_PENDING = "satrunner.pendingAttempts"; // completed attempts not yet confirmed saved on the server
const LS_DEMO = "satrunner.demoMode"; // QA switch: shorten tests but otherwise behave like real attempts

const DEMO_QUESTIONS_PER_SECTION = 2;

const GOAL = 1400;

// A blank test in the exact schema the app expects — offered to admins as a download
// so they (or Claude) can see the format for questions and answers, including topic tags.
const TEMPLATE = {
  id: "sample-test",
  title: "Sample test",
  description: "Delete this and replace with your own. Shows the JSON format the app reads.",
  sections: [
    {
      name: "Reading & Writing",
      minutes: 30,
      questions: [
        {
          q: "Passage text here. Use \\n\\n for paragraph breaks.\n\nWhich choice best completes the text?",
          topic: "Words in Context",
          choices: ["Option A", "Option B", "Option C", "Option D"],
          answer: 1,
          explanation: "Why B is correct.",
        },
        {
          q: "A grammar/boundaries question.",
          topic: "Punctuation",
          choices: ["Option A", "Option B", "Option C", "Option D"],
          answer: 0,
          explanation: "Why A is correct.",
        },
      ],
    },
    {
      name: "Math",
      minutes: 30,
      questions: [
        {
          q: "If 2x + 3 = 11, what is x?",
          topic: "Linear equations",
          choices: ["2", "3", "4", "5"],
          answer: 2,
          explanation: "2x = 8, so x = 4.",
        },
        {
          q: "Grid-in: what is one-half as a decimal?",
          topic: "Fractions & decimals",
          type: "grid",
          answer: ["0.5", "1/2", ".5"],
          explanation: "Accepts equivalent forms — 0.5, .5, or 1/2.",
        },
      ],
    },
  ],
};

function loadPending() {
  try {
    return JSON.parse(localStorage.getItem(LS_PENDING) || "[]");
  } catch {
    return [];
  }
}
function savePending(arr) {
  try {
    localStorage.setItem(LS_PENDING, JSON.stringify(arr));
  } catch {}
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const x = s % 60;
  return `${m}:${x < 10 ? "0" : ""}${x}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function todayStamp() {
  // Local date (not UTC), so the stamp matches the admin's wall-clock day.
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pctOf(h) {
  return h.totalQuestions ? Math.round((h.totalScore / h.totalQuestions) * 100) : 0;
}

function pctClass(p) {
  return p >= 80 ? "high" : p >= 60 ? "mid" : "low";
}

// --- Non-LLM answer evaluation --------------------------------------------
// Parse a grid-in answer into a number so equivalent forms compare equal
// (fractions, decimals, commas, a trailing %). Returns null if not numeric.
function toNumber(v) {
  if (v == null) return null;
  let s = String(v).trim().replace(/\s/g, "").replace(/[,$£€]/g, "").replace(/%$/, "");
  if (s === "") return null;
  if (/^[-+]?\d+\/\d+$/.test(s)) {
    const [a, b] = s.split("/").map(Number);
    return b === 0 ? null : a / b;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
    const val = parseFloat(s);
    return Number.isNaN(val) ? null : val;
  }
  return null;
}

function gradeGrid(given, answer) {
  const norm = (v) => String(v).replace(/\s/g, "").toLowerCase();
  const accepted = Array.isArray(answer) ? answer : [answer];
  const g = given == null ? "" : given;
  if (g === "") return false;
  // 1) exact match, case- and space-insensitive
  if (accepted.some((a) => norm(a) === norm(g))) return true;
  // 2) numeric equivalence (1/2 == 0.5 == .5, 2.50 == 2.5, 1,000 == 1000)
  const gn = toNumber(g);
  if (gn === null) return false;
  return accepted.some((a) => {
    const an = toNumber(a);
    return an !== null && Math.abs(an - gn) < 1e-9;
  });
}

// --- Estimated SAT score (heuristic, no LLM) ------------------------------
function roundTo10(n) {
  return Math.round(n / 10) * 10;
}
function estSection(s) {
  const p = s.total ? s.score / s.total : 0;
  return Math.min(800, Math.max(200, roundTo10(200 + p * 600)));
}
// Two-section tests map each section to a 200–800 area score; otherwise the
// overall percentage is scaled onto the 400–1600 range.
function estSat(result) {
  const secs = result.sections || [];
  if (secs.length === 2) return secs.reduce((a, s) => a + estSection(s), 0);
  const p = pctOf(result) / 100;
  return Math.min(1600, Math.max(400, roundTo10(400 + p * 1200)));
}

function computeTopics(sections) {
  const map = {};
  for (const s of sections || []) {
    for (const a of s.answers || []) {
      if (!a.topic) continue;
      if (!map[a.topic]) map[a.topic] = { topic: a.topic, correct: 0, total: 0 };
      map[a.topic].total++;
      if (a.right) map[a.topic].correct++;
    }
  }
  return Object.values(map).sort((x, y) => x.correct / x.total - y.correct / y.total);
}

function motivate(pct) {
  if (pct >= 85) return "Outstanding — you're in top form! Keep it up. 🌟";
  if (pct >= 70) return "Great work — you're on track for your goal. 💪";
  if (pct >= 50) return "Solid effort. Review the misses and you'll climb fast. 📈";
  return "Every test makes you sharper. Let's target those weak spots together. 🎯";
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ReviewSections({ sections }) {
  return sections.map((s, si) => (
    <div className="card" key={si}>
      <h3>{s.name} review</h3>
      {!s.answers ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Question-level detail wasn&apos;t recorded for this attempt.
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {s.answers.map((a) => (
            <div className={`review ${a.right ? "right" : "wrong"}`} key={a.n}>
              <p style={{ margin: "0 0 4px" }}>
                <span className={`tag ${a.right ? "good" : "bad"}`}>{a.right ? "Correct" : "Missed"}</span>
                <span className="faint" style={{ marginLeft: 8 }}>Question {a.n}</span>
                {a.topic && <span className="topic-pill">{a.topic}</span>}
              </p>
              <p className="qtext" style={{ fontSize: 14.5, marginBottom: 6 }}>{a.q}</p>
              <p className="muted" style={{ margin: 0 }}>
                Your answer: {a.given}
                {!a.right && <> · Correct: {a.correct}</>}
              </p>
              {a.explanation && <p className="muted" style={{ margin: "4px 0 0" }}>{a.explanation}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  ));
}

function ScoreBoxes({ result }) {
  const pct = pctOf(result);
  return (
    <div className="row" style={{ margin: "1.25rem 0 1rem", gap: 12, flexWrap: "wrap" }}>
      {result.sections.map((s, i) => (
        <div className="scorebox" key={i}>
          <p className="faint" style={{ margin: 0 }}>{s.name}</p>
          <p className="big" style={{ margin: 0 }}>{s.score}/{s.total}</p>
        </div>
      ))}
      <div className="scorebox" style={{ background: "var(--ink)", color: "#fff" }}>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>Total</p>
        <p className="big" style={{ margin: 0 }}>{pct}%</p>
      </div>
    </div>
  );
}

function GoalProgress({ result }) {
  const est = estSat(result);
  if (est == null) return null;
  const hit = est >= GOAL;
  const fill = Math.max(3, Math.round((est / 1600) * 100));
  const goalPos = Math.round((GOAL / 1600) * 100);
  return (
    <div className="card">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <div>
          <span className="stat-label">Estimated SAT score</span>
          <span className="big" style={{ display: "block", fontFamily: "var(--font-display)" }}>
            {est} <span className="faint" style={{ fontSize: 14 }}>/ 1600</span>
          </span>
        </div>
        <span className={`pct ${hit ? "high" : "mid"}`}>{hit ? "Goal reached 🎉" : `Goal ${GOAL}`}</span>
      </div>
      <div className="bar goalbar" style={{ marginTop: 10 }}>
        <div className={`bar-fill ${hit ? "high" : "mid"}`} style={{ width: `${fill}%` }} />
        <div className="goal-marker" style={{ left: `${goalPos}%` }} title={`Goal ${GOAL}`} />
      </div>
      <p className="faint" style={{ margin: "8px 0 0" }}>
        Rough estimate from section percentages — not an official SAT score.
      </p>
    </div>
  );
}

function WeakAreas({ sections }) {
  const topics = computeTopics(sections);
  if (!topics.length) return null;
  return (
    <div className="card">
      <h3>Performance by topic</h3>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        Your weakest areas are at the top — focus study time there.
      </p>
      <div className="topics">
        {topics.map((t) => {
          const p = Math.round((t.correct / t.total) * 100);
          return (
            <div className="topic-row" key={t.topic}>
              <div className="topic-head">
                <span>{t.topic}</span>
                <span className={`pct ${pctClass(p)}`}>{t.correct}/{t.total} · {p}%</span>
              </div>
              <div className="bar">
                <div className={`bar-fill ${pctClass(p)}`} style={{ width: `${Math.max(3, p)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [loginName, setLoginName] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [phase, setPhase] = useState("home");
  const [builtIn, setBuiltIn] = useState([]);
  const [customTests, setCustomTests] = useState([]);
  const [history, setHistory] = useState([]);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [preview, setPreview] = useState(null); // { test } awaiting confirmation
  const [previewTitle, setPreviewTitle] = useState("");
  const [notice, setNotice] = useState("");

  // History filters
  const [fStudent, setFStudent] = useState("all");
  const [fTest, setFTest] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  // Test-list filters (home)
  const [tSearch, setTSearch] = useState("");
  const [tStatus, setTStatus] = useState("all");

  const [test, setTest] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [student, setStudent] = useState("");
  const [secIdx, setSecIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [result, setResult] = useState(null);
  const [saveState, setSaveState] = useState("");
  const [review, setReview] = useState(null);
  const [inspecting, setInspecting] = useState(null); // admin: test whose questions are being verified
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const timerRef = useRef(null);
  const finishRef = useRef(() => {});
  const flushingRef = useRef(false);

  const isAdmin = user && user.role === "admin";

  async function loadHistory() {
    try {
      const r = await fetch("/api/attempts");
      if (!r.ok) return;
      setHistory((await r.json()).attempts || []);
    } catch {}
  }

  async function loadTests() {
    try {
      const r = await fetch("/api/tests");
      if (r.ok) setCustomTests((await r.json()).tests || []);
    } catch {}
    fetch("/tests/manifest.json")
      .then((r) => (r.ok ? r.json() : { tests: [] }))
      .then(async (m) => {
        const loaded = [];
        for (const file of m.tests || []) {
          try {
            const t = await fetch(`/tests/${file}`).then((r) => r.json());
            if (!validateTest(t)) loaded.push(t);
          } catch {}
        }
        setBuiltIn(loaded);
      })
      .catch(() => {});
  }

  // On mount, discover the current session and restore the QA demo switch.
  useEffect(() => {
    try {
      setDemoMode(localStorage.getItem(LS_DEMO) === "1");
    } catch {}
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null));
  }, []);

  function toggleDemo(on) {
    setDemoMode(on);
    try {
      localStorage.setItem(LS_DEMO, on ? "1" : "0");
    } catch {}
  }

  // Once signed in, load data (and migrate any admin's old localStorage tests to the server).
  useEffect(() => {
    if (!user) return;
    setStudent(user.displayName || "");
    (async () => {
      if (user.role === "admin") {
        let legacy = [];
        try {
          legacy = JSON.parse(localStorage.getItem(LS_IMPORTED) || "[]");
        } catch {}
        for (const t of legacy) {
          try {
            await fetch("/api/tests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(t),
            });
          } catch {}
        }
        if (legacy.length) {
          try {
            localStorage.removeItem(LS_IMPORTED);
          } catch {}
        }
      }
      await loadTests();
      await loadHistory();
      await flushPending();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    finishRef.current = finishSection;
  });

  useEffect(() => {
    if (phase !== "test") {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setTimeout(() => finishRef.current(true), 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secIdx]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2500);
  }

  async function doLogin(e) {
    e && e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginName, password: loginPass }),
      });
      const d = await r.json();
      if (!r.ok) {
        setLoginError(d.error || "Login failed.");
      } else {
        setLoginPass("");
        setUser(d.user);
      }
    } catch {
      setLoginError("Could not reach the server.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    setUser(null);
    setHistory([]);
    setCustomTests([]);
    setPhase("home");
  }

  // ---- Import (admin only) ----
  function previewImport(text) {
    setImportError("");
    let t;
    try {
      t = JSON.parse(text);
    } catch {
      setImportError("That isn't valid JSON.");
      return;
    }
    const err = validateTest(t);
    if (err) {
      setImportError(err);
      return;
    }
    setPreview({ test: t });
    // Default the name to include today's date stamp (admin can still edit it).
    const stamp = todayStamp();
    setPreviewTitle(t.title.includes(stamp) ? t.title : `${t.title} — ${stamp}`);
  }

  function previewImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result));
      previewImport(String(reader.result));
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function confirmAddTest() {
    const title = (previewTitle || "").trim() || preview.test.title;
    const stamp = todayStamp();
    let id = slugify(title);
    if (!id.endsWith(stamp)) id = `${id}-${stamp}`; // guarantee a date-stamped id
    const t = { ...preview.test, title, id };
    try {
      const r = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t),
      });
      const d = await r.json();
      if (!r.ok) {
        setImportError(d.error || "Could not save test.");
        return;
      }
      setPreview(null);
      setImportText("");
      flash(`Added "${t.title}"`);
      loadTests();
    } catch {
      setImportError("Could not reach the server.");
    }
  }

  async function removeTest(id) {
    try {
      await fetch(`/api/tests/${id}`, { method: "DELETE" });
    } catch {}
    loadTests();
  }

  function exportTest(t) {
    // Export a clean copy (drop server bookkeeping fields).
    const { importedBy, importedAt, ...clean } = t;
    download(`test-${t.id}.json`, JSON.stringify(clean, null, 2));
  }

  function downloadTemplate() {
    download("sat-test-template.json", JSON.stringify(TEMPLATE, null, 2));
  }

  // ---- Test taking ----
  // Demo mode (QA switch) trims each section to its first few questions so a test
  // can be walked through quickly. Demo attempts otherwise behave like real ones —
  // timed, scored, and saved — and are tagged demo:true so they can be told apart.
  function makeDemo(t) {
    return {
      ...t,
      sections: t.sections.map((s) => ({
        ...s,
        questions: s.questions.slice(0, DEMO_QUESTIONS_PER_SECTION),
      })),
    };
  }

  function startSetup(t) {
    setTest(demoMode ? makeDemo(t) : t);
    setStudent(user.displayName || "");
    setPhase("setup");
  }

  // Admin: open a read-only view of every question and answer to verify an import.
  function inspectTest(t) {
    setInspecting(t);
    setPhase("inspect");
    window.scrollTo(0, 0);
  }

  function beginTest() {
    setAnswers(test.sections.map((s) => s.questions.map(() => null)));
    setSecIdx(0);
    setQIdx(0);
    setConfirmSubmit(false);
    setTimeLeft(test.sections[0].minutes * 60);
    setPhase("test");
  }

  function beginNextSection() {
    const n = secIdx + 1;
    setSecIdx(n);
    setQIdx(0);
    setConfirmSubmit(false);
    setTimeLeft(test.sections[n].minutes * 60);
    setPhase("test");
  }

  function goToQuestion(i) {
    setQIdx(i);
    setConfirmSubmit(false);
  }

  function setAnswer(value) {
    setAnswers((prev) => {
      const next = prev.map((s) => [...s]);
      next[secIdx][qIdx] = value;
      return next;
    });
  }

  function finishSection(auto = false) {
    if (phase !== "test") return;
    setConfirmSubmit(false);
    if (secIdx < test.sections.length - 1) {
      setPhase("break");
    } else {
      const r = grade();
      setResult(r);
      setPhase("results");
      saveAttempt(r); // demo attempts save like real ones (only the question count differs)
    }
    if (auto) flash("Time expired — section submitted.");
  }

  async function saveAttempt(r) {
    setSaveState("saving");
    // Back the attempt up on this device *before* the network call, so it survives
    // a dead/unreachable server and gets auto-uploaded on the next successful load.
    const pending = loadPending();
    if (!pending.some((p) => p.completedAt === r.completedAt)) {
      savePending([...pending, r]);
    }
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      if (!res.ok) throw new Error();
      savePending(loadPending().filter((p) => p.completedAt !== r.completedAt));
      setSaveState("saved");
      loadHistory();
    } catch {
      setSaveState("error");
    }
  }

  // Upload any attempts that were completed while the server was unreachable.
  async function flushPending() {
    if (flushingRef.current) return; // guard against concurrent runs (e.g. StrictMode)
    flushingRef.current = true;
    try {
      await doFlush();
    } finally {
      flushingRef.current = false;
    }
  }

  async function doFlush() {
    const pending = loadPending();
    if (!pending.length) return;
    let changed = false;
    for (const r of pending) {
      try {
        const res = await fetch("/api/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r),
        });
        if (res.ok) {
          savePending(loadPending().filter((p) => p.completedAt !== r.completedAt));
          changed = true;
        }
      } catch {}
    }
    if (changed) {
      loadHistory();
      flash("Recovered a completed test that hadn't uploaded yet.");
    }
  }

  function grade() {
    const sections = test.sections.map((s, si) => {
      let score = 0;
      const detail = s.questions.map((q, qi) => {
        const given = answers[si][qi];
        let right, givenLabel, correctLabel;
        if (q.type === "grid") {
          right = gradeGrid(given, q.answer);
          givenLabel = given === null || given === "" ? "(blank)" : String(given);
          correctLabel = Array.isArray(q.answer) ? q.answer[0] : String(q.answer);
        } else {
          right = given === q.answer;
          givenLabel = given === null ? "(blank)" : `${String.fromCharCode(65 + given)}. ${q.choices[given]}`;
          correctLabel = `${String.fromCharCode(65 + q.answer)}. ${q.choices[q.answer]}`;
        }
        if (right) score++;
        return {
          n: qi + 1,
          q: q.q,
          topic: q.topic || null,
          given: givenLabel,
          correct: correctLabel,
          right,
          explanation: q.explanation || "",
        };
      });
      return { name: s.name, score, total: s.questions.length, answers: detail };
    });
    const totalScore = sections.reduce((a, s) => a + s.score, 0);
    const totalQuestions = sections.reduce((a, s) => a + s.total, 0);
    return {
      // Stable id assigned once, at grade time, so retries / offline re-uploads
      // overwrite the same file instead of creating duplicate attempts.
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "sat-runner-results",
      testId: test.id,
      testTitle: test.title,
      student: student || user.displayName || "Student",
      completedAt: new Date().toISOString(),
      sections,
      totalScore,
      totalQuestions,
      topicStats: computeTopics(sections),
      estScore: estSat({ sections, totalScore, totalQuestions }),
      ...(demoMode ? { demo: true } : {}),
    };
  }

  async function viewAttempt(id) {
    try {
      const r = await fetch(`/api/attempts/${id}`);
      if (!r.ok) throw new Error();
      setReview(await r.json());
      setPhase("review");
      window.scrollTo(0, 0);
    } catch {
      flash("Could not load that attempt.");
    }
  }

  async function deleteAttempt(id) {
    setConfirmDelete(null);
    try {
      await fetch(`/api/attempts/${id}`, { method: "DELETE" });
    } catch {}
    loadHistory();
  }

  function exportJSON(r) {
    const name = `results-${r.testId}-${(r.student || "student").replace(/\s+/g, "-").toLowerCase()}.json`;
    download(name, JSON.stringify(r, null, 2));
  }

  async function copyJSON(r) {
    const ok = await copyText(JSON.stringify(r, null, 2));
    flash(ok ? "Results copied — paste them to Claude for analysis." : "Copy failed — use Download instead.");
  }

  async function copyHistory(rows) {
    const ok = await copyText(
      JSON.stringify({ kind: "sat-runner-history", exportedAt: new Date().toISOString(), attempts: rows }, null, 2)
    );
    flash(ok ? "History copied — paste it to Claude for analysis." : "Copy failed.");
  }

  function backToHome() {
    setPhase("home");
    setResult(null);
    setSaveState("");
    // demoMode is a persistent QA switch — leave it as the user set it.
  }

  // ===== Render =====

  if (user === undefined) {
    return <main className="shell"><p className="muted">Loading…</p></main>;
  }

  if (user === null) {
    return (
      <main className="shell">
        <div className="loginwrap">
          <div className="card">
            <h1 style={{ marginBottom: 4 }}>Sign in</h1>
            <p className="muted" style={{ margin: "0 0 16px" }}>Enter your account to continue.</p>
            <form onSubmit={doLogin}>
              <label className="field">
                <span className="field-label">Username</span>
                <input type="text" autoFocus value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="username" />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="password" />
              </label>
              {loginError && <p style={{ color: "var(--bad)", fontSize: 14, margin: "4px 0 0" }}>{loginError}</p>}
              <button className="primary" type="submit" disabled={loggingIn || !loginName || !loginPass} style={{ width: "100%", marginTop: 14 }}>
                {loggingIn ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
          <p className="faint" style={{ textAlign: "center" }}>
            Starter accounts: <strong>sofia / password</strong> (student) · <strong>admin / admin</strong> (admin)
          </p>
        </div>
      </main>
    );
  }

  const allTests = [...builtIn, ...customTests.filter((t) => !builtIn.some((b) => b.id === t.id))];
  const customIds = new Set(customTests.map((t) => t.id));

  // Status of a test for the signed-in user (their own attempts).
  // Status of a test. Admin sees whether *anyone* has taken it (they see all
  // attempts); a student sees only their own attempts.
  function testStatus(t) {
    const attempts = history.filter(
      (h) => h.testId === t.id && (isAdmin || h.username === user.username)
    );
    if (!attempts.length) return { taken: false, count: 0 };
    return { taken: true, count: attempts.length, best: Math.max(...attempts.map(pctOf)) };
  }

  function UserBar() {
    return (
      <div className="userbar">
        <span>
          Signed in as <strong>{user.displayName}</strong>
          <span className={`role-chip ${isAdmin ? "admin" : "student"}`}>{isAdmin ? "Admin" : "Student"}</span>
        </span>
        <button className="quiet" onClick={doLogout}>Sign out</button>
      </div>
    );
  }

  if (phase === "home") {
    const latest = history[0];
    const prev = history[1];
    const best = history.length ? Math.max(...history.map(pctOf)) : 0;
    const avg = history.length ? Math.round(history.reduce((a, h) => a + pctOf(h), 0) / history.length) : 0;
    const delta = latest && prev ? pctOf(latest) - pctOf(prev) : null;

    const students = Array.from(new Set(history.map((h) => h.student))).sort();
    const testTitles = Array.from(new Set(history.map((h) => h.testTitle))).sort();
    const filtered = history.filter((h) => {
      if (isAdmin && fStudent !== "all" && h.student !== fStudent) return false;
      if (fTest !== "all" && h.testTitle !== fTest) return false;
      const d = h.completedAt.slice(0, 10);
      if (fFrom && d < fFrom) return false;
      if (fTo && d > fTo) return false;
      return true;
    });
    const filterActive = (isAdmin && fStudent !== "all") || fTest !== "all" || fFrom || fTo;

    // Test-list filtering (search + taken/untaken)
    const visibleTests = allTests.filter((t) => {
      if (tSearch && !t.title.toLowerCase().includes(tSearch.toLowerCase())) return false;
      if (tStatus !== "all") {
        const taken = testStatus(t).taken;
        if (tStatus === "taken" && !taken) return false;
        if (tStatus === "untaken" && taken) return false;
      }
      return true;
    });

    return (
      <main className="shell">
        <UserBar />
        {notice && <div className="banner">{notice}</div>}

        {history.length > 0 && (
          <section className="stats">
            <div className="stat">
              <span className="stat-label">Tests taken</span>
              <span className="stat-value">{history.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Latest score</span>
              <span className="stat-value">{pctOf(latest)}%</span>
              {delta !== null && (
                <span className={`stat-sub ${delta >= 0 ? "up" : "down"}`}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs previous
                </span>
              )}
            </div>
            <div className="stat">
              <span className="stat-label">Best score</span>
              <span className="stat-value">{best}%</span>
            </div>
            <div className="stat">
              <span className="stat-label">Average</span>
              <span className="stat-value">{avg}%</span>
            </div>
          </section>
        )}

        <section className="card">
          <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 className="card-title">Available tests</h2>
            <label className="switch" title="QA: shorten tests to a few questions but keep scoring and saving">
              <input type="checkbox" checked={demoMode} onChange={(e) => toggleDemo(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
              <span className="switch-label">Demo mode{demoMode ? " · ON" : ""}</span>
            </label>
          </div>
          <p className="muted" style={{ margin: "2px 0 12px" }}>
            Each section is timed and auto-submits when the clock hits zero.
          </p>
          {demoMode && (
            <div className="banner" style={{ background: "var(--warn-soft)", color: "var(--warn)", borderColor: "var(--warn)" }}>
              Demo mode is <strong>ON</strong> — tests run with only {DEMO_QUESTIONS_PER_SECTION} questions per section, but are
              still timed, scored, and saved to history (for QA). Turn it off for a real test.
            </div>
          )}

          {allTests.length > 0 && (
            <div className="filters">
              <label className="filter">
                <span>Search</span>
                <input type="text" value={tSearch} onChange={(e) => setTSearch(e.target.value)} placeholder="Test name" />
              </label>
              <label className="filter">
                <span>Status</span>
                <select value={tStatus} onChange={(e) => setTStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="untaken">Not taken</option>
                  <option value="taken">Taken</option>
                </select>
              </label>
              {(tSearch || tStatus !== "all") && (
                <button className="quiet" onClick={() => { setTSearch(""); setTStatus("all"); }}>Clear</button>
              )}
            </div>
          )}

          {allTests.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No tests available yet{isAdmin ? " — import one below." : "."}</p>
          ) : visibleTests.length === 0 ? (
            <p className="muted" style={{ margin: "10px 0 0" }}>No tests match these filters.</p>
          ) : (
            visibleTests.map((t) => {
              const st = testStatus(t);
              return (
                <div className="row between test-row" key={t.id}>
                  <div>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0 }}>
                        {isAdmin ? (
                          <button className="titlelink" onClick={() => inspectTest(t)} title="View all questions and answers">
                            {t.title}
                          </button>
                        ) : (
                          t.title
                        )}
                      </h3>
                      {st.taken ? (
                        isAdmin ? (
                          <span className="status-taken">Taken · {st.count} attempt{st.count > 1 ? "s" : ""}</span>
                        ) : (
                          <span className={`pct ${pctClass(st.best)}`}>Best {st.best}%</span>
                        )
                      ) : (
                        <span className="status-untaken">Not taken</span>
                      )}
                    </div>
                    <p className="faint" style={{ margin: "3px 0 0" }}>
                      {t.sections.map((s) => `${s.name}: ${s.questions.length} questions / ${s.minutes} min`).join(" · ")}
                      {!isAdmin && st.taken && ` · ${st.count} attempt${st.count > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {isAdmin && <button className="quiet" onClick={() => exportTest(t)} title="Download this test's JSON">JSON</button>}
                    {isAdmin && customIds.has(t.id) && <button className="quiet danger" onClick={() => removeTest(t.id)}>Remove</button>}
                    <button className="primary" onClick={() => startSetup(t)}>{demoMode ? "Start (demo)" : "Start"}</button>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section className="card">
          <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2 className="card-title">Test history</h2>
            {isAdmin && filtered.length > 0 && (
              <button className="quiet" onClick={() => copyHistory(filtered)}>Copy {filterActive ? "filtered " : ""}history for analysis</button>
            )}
          </div>
          <p className="muted" style={{ margin: "2px 0 12px" }}>
            {isAdmin ? "Every attempt across all students" : "Your attempts"}, saved with full question-by-question detail.
          </p>

          {history.length > 0 && (
            <div className="filters">
              {isAdmin && (
                <label className="filter">
                  <span>Student</span>
                  <select value={fStudent} onChange={(e) => setFStudent(e.target.value)}>
                    <option value="all">All</option>
                    {students.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
              <label className="filter">
                <span>Test</span>
                <select value={fTest} onChange={(e) => setFTest(e.target.value)}>
                  <option value="all">All</option>
                  {testTitles.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="filter">
                <span>From</span>
                <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
              </label>
              <label className="filter">
                <span>To</span>
                <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
              </label>
              {filterActive && (
                <button className="quiet" onClick={() => { setFStudent("all"); setFTest("all"); setFFrom(""); setFTo(""); }}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Completed attempts will appear here.</p>
          ) : filtered.length === 0 ? (
            <p className="muted" style={{ margin: "10px 0 0" }}>No attempts match these filters.</p>
          ) : (
            <table className="history">
              <thead>
                <tr>
                  <th>Date</th>
                  {isAdmin && <th>Student</th>}
                  <th>Test</th>
                  <th>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => {
                  const p = pctOf(h);
                  return (
                    <tr key={h.id}>
                      <td>{fmtDate(h.completedAt)}</td>
                      {isAdmin && <td>{h.student}</td>}
                      <td>{h.testTitle}{h.demo && <span className="demo-badge">demo</span>}</td>
                      <td>
                        {h.totalScore}/{h.totalQuestions} <span className={`pct ${pctClass(p)}`}>{p}%</span>
                      </td>
                      <td className="actions">
                        {confirmDelete === h.id ? (
                          <>
                            <span className="muted">Delete?</span>
                            <button className="quiet danger" onClick={() => deleteAttempt(h.id)}>Yes</button>
                            <button className="quiet" onClick={() => setConfirmDelete(null)}>No</button>
                          </>
                        ) : (
                          <>
                            <button className="quiet" onClick={() => viewAttempt(h.id)}>View details</button>
                            {isAdmin && <button className="quiet danger" onClick={() => setConfirmDelete(h.id)}>Delete</button>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {isAdmin && (
          <section className="card">
            <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
              <h2 className="card-title">Import a test</h2>
              <button className="quiet" onClick={downloadTemplate}>Download JSON template</button>
            </div>
            <p className="muted" style={{ margin: "2px 0 10px" }}>
              Paste test JSON (generated by Claude) or choose a .json file, then verify it before adding. New tests are
              date-stamped automatically. Grab the template to see the exact format for questions and answers.
            </p>
            {!preview ? (
              <>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"id": "sat-practice-2", "title": "...", "sections": [...]}'
                />
                {importError && <p style={{ color: "var(--bad)", fontSize: 14 }}>{importError}</p>}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" disabled={!importText.trim()} onClick={() => previewImport(importText)}>
                    Verify &amp; preview
                  </button>
                  <label>
                    <input type="file" accept=".json,application/json" onChange={previewImportFile} style={{ display: "none" }} />
                    <span role="button" tabIndex={0} className="row" style={{ cursor: "pointer", color: "var(--accent)", fontSize: 15 }}>or choose a file</span>
                  </label>
                </div>
              </>
            ) : (
              <div className="preview">
                <div className="banner" style={{ background: "var(--good-soft)", color: "var(--good)", borderColor: "var(--good)" }}>
                  ✓ Valid test — review the details, adjust the name, then add it.
                </div>
                <label className="field">
                  <span className="field-label">Test name (date-stamped by default)</span>
                  <input type="text" value={previewTitle} onChange={(e) => setPreviewTitle(e.target.value)} />
                </label>
                {preview.test.description && <p className="muted" style={{ margin: "0 0 10px" }}>{preview.test.description}</p>}
                <p className="faint" style={{ margin: "0 0 4px" }}>
                  {preview.test.sections.reduce((a, s) => a + s.questions.length, 0)} questions ·{" "}
                  {preview.test.sections.reduce((a, s) => a + s.minutes, 0)} minutes total
                </p>
                <ul className="preview-sections">
                  {preview.test.sections.map((s, i) => (
                    <li key={i}>
                      <strong>{s.name}</strong> — {s.questions.length} questions, {s.minutes} min
                      <span className="faint"> · e.g. “{String(s.questions[0].q).replace(/\s+/g, " ").slice(0, 90)}…”</span>
                    </li>
                  ))}
                </ul>
                {importError && <p style={{ color: "var(--bad)", fontSize: 14 }}>{importError}</p>}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={confirmAddTest}>Add test</button>
                  <button onClick={() => { setPreview(null); setImportError(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    );
  }

  if (phase === "inspect" && inspecting) {
    const t = inspecting;
    const totalQ = t.sections.reduce((a, s) => a + s.questions.length, 0);
    return (
      <main className="shell">
        <button className="quiet" style={{ marginBottom: 8, marginLeft: -8 }} onClick={() => { setInspecting(null); setPhase("home"); }}>
          ← Back to test center
        </button>
        <p className="eyebrow">Verify import · answer key</p>
        <h1>{t.title}</h1>
        {t.description && <p className="muted" style={{ margin: "6px 0 0" }}>{t.description}</p>}
        <p className="faint" style={{ margin: "6px 0 0" }}>
          id: {t.id} · {t.sections.length} section{t.sections.length > 1 ? "s" : ""} · {totalQ} questions
        </p>
        <div className="row" style={{ margin: "10px 0 0" }}>
          <button className="quiet" onClick={() => exportTest(t)}>Download JSON</button>
        </div>

        {t.sections.map((s, si) => (
          <div className="card" key={si}>
            <h3>Section {si + 1}: {s.name} <span className="faint">— {s.questions.length} questions, {s.minutes} min</span></h3>
            <div style={{ marginTop: 10 }}>
              {s.questions.map((q, qi) => (
                <div className="inspect-q" key={qi}>
                  <p className="qtext" style={{ fontSize: 14.5, marginBottom: 6 }}>
                    <strong>{qi + 1}.</strong> {q.q}
                    {q.topic && <span className="topic-pill">{q.topic}</span>}
                    {q.type === "grid" && <span className="topic-pill" style={{ background: "var(--line)", color: "var(--ink-soft)" }}>grid-in</span>}
                  </p>
                  {q.type === "grid" ? (
                    <p className="muted" style={{ margin: 0 }}>
                      Accepted answer{Array.isArray(q.answer) && q.answer.length > 1 ? "s" : ""}:{" "}
                      <strong>{(Array.isArray(q.answer) ? q.answer : [q.answer]).join("  ·  ")}</strong>
                    </p>
                  ) : (
                    <ul className="inspect-choices">
                      {q.choices.map((c, ci) => (
                        <li key={ci} className={ci === q.answer ? "correct" : ""}>
                          <span className="letter-sm">{String.fromCharCode(65 + ci)}</span>
                          <span>{c}</span>
                          {ci === q.answer && <span className="tag good" style={{ marginLeft: 8 }}>correct</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.explanation && <p className="faint" style={{ margin: "6px 0 0" }}>Explanation: {q.explanation}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <button style={{ width: "100%" }} onClick={() => { setInspecting(null); setPhase("home"); }}>
          Back to test center
        </button>
      </main>
    );
  }

  if (phase === "setup") {
    return (
      <main className="shell">
        <p className="eyebrow">{test.title}{demoMode ? " · demo" : ""}</p>
        <h1>Before you begin</h1>
        {demoMode && (
          <div className="banner" style={{ marginTop: "1rem", background: "var(--warn-soft)", color: "var(--warn)", borderColor: "var(--warn)" }}>
            Demo run — {DEMO_QUESTIONS_PER_SECTION} questions per section. It is still timed, scored, and saved to history (marked as a demo).
          </div>
        )}
        <div className="card" style={{ marginTop: "1.25rem" }}>
          {test.sections.map((s, i) => (
            <p key={i} style={{ margin: "0 0 6px" }}>
              <strong>Section {i + 1}: {s.name}</strong>
              <span className="muted"> — {s.questions.length} questions, {s.minutes} minutes</span>
            </p>
          ))}
          <p className="muted" style={{ margin: "12px 0 0" }}>
            The timer starts as soon as you press Begin. Each section submits itself when time runs out. You can move
            between questions freely within a section, but you can&apos;t return to a section once it&apos;s submitted.
          </p>
        </div>
        <div className="card">
          <h3>Taking this test as</h3>
          <p className="muted" style={{ margin: "4px 0 10px" }}>Saved with your score history.</p>
          <input type="text" value={student} onChange={(e) => setStudent(e.target.value)} placeholder="Name" readOnly={!isAdmin} />
        </div>
        <div className="row">
          <button onClick={backToHome}>Back</button>
          <button className="primary spread" onClick={beginTest}>Begin section 1</button>
        </div>
      </main>
    );
  }

  if (phase === "test") {
    const section = test.sections[secIdx];
    const q = section.questions[qIdx];
    const secAnswers = answers[secIdx];
    const unanswered = secAnswers.filter((a) => a === null || a === "").length;
    const isLast = qIdx === section.questions.length - 1;
    return (
      <main className="shell">
        <div className="topbar">
          <div>
            <p className="eyebrow">Section {secIdx + 1}: {section.name}{demoMode ? " · demo" : ""}</p>
            <span className="muted">Question {qIdx + 1} of {section.questions.length}</span>
          </div>
          <span className={`clock${timeLeft <= 300 ? " low" : ""}`} aria-live="polite">{fmtTime(timeLeft)}</span>
        </div>

        <div className="card">
          <p className="qtext">{q.q}</p>
          {q.type === "grid" ? (
            <div>
              <p className="faint" style={{ margin: "0 0 6px" }}>Grid-in: type your answer (fractions and decimals both accepted)</p>
              <input
                type="text"
                inputMode="decimal"
                style={{ maxWidth: 160 }}
                value={secAnswers[qIdx] ?? ""}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Answer"
              />
            </div>
          ) : (
            q.choices.map((c, i) => (
              <button key={i} className={`choice${secAnswers[qIdx] === i ? " selected" : ""}`} onClick={() => setAnswer(i)}>
                <span className="letter">{String.fromCharCode(65 + i)}</span>
                <span>{c}</span>
              </button>
            ))
          )}
        </div>

        {confirmSubmit && (
          <div className="confirmbar" role="alertdialog" aria-label="Confirm submit">
            <span>{unanswered} unanswered question{unanswered === 1 ? "" : "s"} in this section. Submit anyway?</span>
            <button className="primary" onClick={() => finishSection()}>Submit section</button>
            <button onClick={() => setConfirmSubmit(false)}>Keep working</button>
          </div>
        )}

        <div className="row">
          <button onClick={() => goToQuestion(Math.max(0, qIdx - 1))} disabled={qIdx === 0} aria-label="Previous question">Back</button>
          {isLast ? (
            <button
              className="primary spread"
              onClick={() => {
                if (unanswered > 0) setConfirmSubmit(true);
                else finishSection();
              }}
            >
              Submit section
            </button>
          ) : (
            <button className="primary spread" onClick={() => goToQuestion(qIdx + 1)}>Next</button>
          )}
        </div>

        <div className="strip" aria-label="Question navigator">
          {section.questions.map((_, i) => {
            const done = secAnswers[i] !== null && secAnswers[i] !== "";
            return (
              <button
                key={i}
                className={`${done ? "answered" : ""} ${i === qIdx ? "current" : ""}`}
                onClick={() => goToQuestion(i)}
                aria-label={`Go to question ${i + 1}${done ? ", answered" : ""}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  if (phase === "break") {
    const next = test.sections[secIdx + 1];
    return (
      <main className="shell">
        <p className="eyebrow">{test.title}{demoMode ? " · demo" : ""}</p>
        <h1>Section {secIdx + 1} complete</h1>
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <p style={{ margin: 0 }}>
            Take a short breath. Up next: <strong>{next.name}</strong> — {next.questions.length} questions in {next.minutes} minutes.
          </p>
        </div>
        <button className="primary" style={{ width: "100%" }} onClick={beginNextSection}>
          Begin section {secIdx + 2}
        </button>
      </main>
    );
  }

  if (phase === "results") {
    return (
      <main className="shell">
        <p className="eyebrow">{result.testTitle} · {result.student}{demoMode ? " · demo" : ""}</p>
        <h1>Results</h1>
        {notice && <div className="banner" style={{ marginTop: "1rem" }}>{notice}</div>}
        {result.demo && (
          <div className="banner" style={{ background: "var(--warn-soft)", color: "var(--warn)", borderColor: "var(--warn)" }}>
            Demo attempt ({DEMO_QUESTIONS_PER_SECTION} questions per section) — scored and saved like a real test, tagged “demo” in history.
          </div>
        )}
        <div className="banner motivate">{motivate(pctOf(result))}</div>
        <ScoreBoxes result={result} />
        <GoalProgress result={result} />

        <div className="card">
          <div className="row between">
            <h3>Saved to score history</h3>
            {saveState === "saving" && <span className="faint">Saving…</span>}
            {saveState === "saved" && <span className="pct high">✓ Saved</span>}
            {saveState === "error" && (
              <span className="row">
                <span className="pct mid">Saved on this device</span>
                <button className="quiet" onClick={() => saveAttempt(result)}>Retry upload</button>
              </span>
            )}
          </div>
          <p className="muted" style={{ margin: "4px 0 10px" }}>
            {saveState === "error"
              ? "The server couldn't be reached, so this attempt is saved safely on this device and will upload automatically next time the app opens. Don't clear your browser data before then."
              : "This attempt is stored with full detail — review it anytime from the home screen."}
            {isAdmin && saveState !== "error" && " Send the results file to Claude for weak-area analysis and a study plan."}
          </p>
          {isAdmin && (
            <div className="row">
              <button className="primary" onClick={() => exportJSON(result)}>Download results JSON</button>
              <button onClick={() => copyJSON(result)}>Copy to clipboard</button>
            </div>
          )}
        </div>

        <WeakAreas sections={result.sections} />
        <ReviewSections sections={result.sections} />

        <button style={{ width: "100%" }} onClick={backToHome}>
          Back to test center
        </button>
      </main>
    );
  }

  if (phase === "review") {
    return (
      <main className="shell">
        {notice && <div className="banner">{notice}</div>}
        <button className="quiet" style={{ marginBottom: 8, marginLeft: -8 }} onClick={() => { setReview(null); setPhase("home"); }}>
          ← Back to test center
        </button>
        <p className="eyebrow">Past attempt · {fmtDate(review.completedAt)} · {review.student}</p>
        <h1>{review.testTitle}</h1>
        <ScoreBoxes result={review} />
        <GoalProgress result={review} />

        {isAdmin && (
          <div className="card">
            <h3>Export this attempt</h3>
            <p className="muted" style={{ margin: "4px 0 10px" }}>
              Send it to Claude for weak-area analysis, targeted homework, and progress tracking.
            </p>
            <div className="row">
              <button className="primary" onClick={() => exportJSON(review)}>Download results JSON</button>
              <button onClick={() => copyJSON(review)}>Copy to clipboard</button>
            </div>
          </div>
        )}

        <WeakAreas sections={review.sections} />
        <ReviewSections sections={review.sections} />
      </main>
    );
  }

  return null;
}
