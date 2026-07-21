# SAT Prep Studio

A small Next.js app that helps a student prepare for the SAT over a multi-month plan. It runs timed, SAT-style practice tests, grades them instantly, and keeps a permanent history of every attempt — down to the individual question — so a parent (with Claude's help) can spot weak areas, assign targeted homework, and track progress toward a target score.

**Original goal this app serves:** prepare a student for the SAT in ~4 months with a target score of **1400** — using mini tests (~1 hr) and full tests, tracking results, emphasizing weak areas, and generating personalized practice for those areas.

## What it does

- **Accounts & roles.** Sign-in with two roles — **student** (takes tests, sees only their own history) and **admin/parent** (full access: import, delete, export, and every student's history).
- **Runs timed tests.** Any number of sections, each with its own countdown timer that auto-submits when it hits zero.
- **Two question types.** Multiple choice and grid-in (type-the-answer).
- **Grades instantly, no AI/LLM involved.** All scoring is plain local logic: multiple choice compares the chosen index; grid-ins match strings *and* mathematically-equivalent numbers (`1/2` = `0.5` = `.5`, `2.50` = `2.5`, `1,000` = `1000`, `$160` = `160`).
- **Estimated SAT score toward the 1400 goal.** Each results screen shows a rough 400–1600 estimate with a goal marker (clearly labelled an estimate, not an official score).
- **Weak-area breakdown by topic.** If questions carry a `topic` tag, results and reviews show a per-topic bar chart, weakest area first — the core of targeted studying.
- **Demo mode (QA switch).** A toggle on the home screen. When on, every test runs with just 2 questions per section but otherwise behaves exactly like a real attempt — timed, scored, and saved to history — so you can exercise the whole flow quickly. Demo attempts are tagged `demo` (badge in history) so they're easy to spot and delete after testing. The switch persists per browser; turn it off for real tests.
- **Saves every attempt to disk** with complete detail, attributed to the signed-in student — nothing is lost after the results screen.
- **Progress dashboard** on the home screen: tests taken, latest score (with ▲/▼ change vs. the previous attempt), best score, and average.
- **Test list with per-test status + filter.** Each test shows a status badge — a student sees their **best score** or **Not taken**; an admin sees **Taken · N attempts** (across all students) or **Not taken**. Filter the list by name or taken/not-taken.
- **Answer-key verifier (admin).** Click a test's title to open a read-only view of every question with its correct answer marked, topic, accepted grid-in forms, and explanation — a quick way to confirm an imported JSON is correct.
- **Math notation rendering.** Tests may use LaTeX (`$...$`, `$$...$$`, or bare commands in answer choices); it renders properly via KaTeX. Plain-Unicode and plain-ASCII tests are left exactly as-is. See "Math notation" below.
- **Score history with filters** — every past attempt, with color-coded percentages and a **View details** button to re-open the full review anytime. Filter by **student** (admin only), **test**, and **date range**.
- **Import with a verify step (admin only).** Paste JSON or pick a `.json` file, preview the parsed test, and **edit the (auto date-stamped) test name** before it's added.
- **Download the JSON format (admin).** A "Download JSON template" button gives a ready-to-edit sample showing the exact question/answer format; each test also has a **JSON** button to export its full questions and answers.
- **Export / copy** any attempt as JSON to hand back to Claude for analysis (admin only).
- **Encouraging feedback.** A short motivational message on each real results screen.
- **LAN mode** so the student can take a test from a phone or tablet on the same wifi.

## Accounts & roles

Login is required. Two starter accounts are seeded automatically on first run:

| Username | Password | Role | Can do |
| --- | --- | --- | --- |
| `sofia` | `password` | student | Take tests; view **only their own** history and reviews. |
| `admin` | `admin` | admin | Everything above **plus** import/delete tests, delete attempts, export results, and see **all** students' history. |

- Passwords are stored **hashed** (scrypt) in `data/auth.json`, which is generated on first run along with a random session-signing secret. Change or add accounts by editing that file (replace a `pass` value using the same `salt:hash` format, or just delete the file to re-seed the defaults).
- Sessions are a signed, `httpOnly` cookie — a logged-in student on the LAN cannot reach admin actions. **All role checks are enforced on the server**, not just hidden in the UI, so the API rejects (401/403) any attempt to import, delete, export others' data, or read another student's attempt.
- To add another student, add an entry to the `users` array in `data/auth.json` with `"role": "student"`.

## Where data is stored

No database and no cloud — everything stays on the computer running the app.

| Data | Location | Notes |
| --- | --- | --- |
| **Test results / score history** | `<data>/attempts/` (one JSON file per attempt) | The source of truth. Full question-by-question detail, attributed to the signed-in student. Survives browser cache clears. Results always land on the machine running the app, even when the test is taken from another device. |
| **Imported tests** | `<data>/tests/` (one JSON file per test) | Tests an admin imports through the app. Shared to everyone, so a student sees the tests the admin added. Admin-only to create/delete. |
| **Accounts** | `<data>/auth.json` | Hashed passwords + a random session secret. Seeded on first run. |
| **Bundled tests** | `public/tests/*.json` + `public/tests/manifest.json` | Ship a test with the app by dropping its JSON here and adding the filename to `manifest.json`. |

`<data>` is the data folder described below (by default `~/sat-prep-data`). It (and everything in it) is created automatically on first run. Back it up by copying it.

### Where the data folder lives (and surviving deployments)

To keep score history from being wiped on every redeploy, the data folder lives **outside the app directory by default**: `~/sat-prep-data` (the home directory of the account running the app). The home directory persists across deployments, so `git checkout` / re-upload / rebuild of the app folder can't touch it.

- **No configuration needed** for this — it's the default. Set `SAT_DATA_DIR` only if you want an explicit path (see `.env.example`).
- **Automatic migration:** on startup, if `~/sat-prep-data` doesn't exist yet but an old in-project `./data` folder does, its contents are copied over once (the source is never deleted). So upgrading preserves existing accounts, tests, and attempts.
- All data lives together under the folder: `.../attempts`, `.../tests`, `auth.json`.
- The app **only ever adds files, or removes one when an admin explicitly deletes it** — no code path (build, deploy, or feature) bulk-deletes tests or attempts.

> Preserving existing live data on first upgrade: if your Hostinger instance currently has attempts you want to keep, back up its `data/` folder and drop the contents into `~/sat-prep-data` on the server before/after deploying this change.

> Deploy checklist: (1) data already persists in `~/sat-prep-data` by default (override with `SAT_DATA_DIR` only if needed), (2) never expose `next dev` publicly — build and run with `npm run build && npm start`, (3) change the default `admin`/`sofia` passwords (see the security note below).

## Security notes (for public/hosted deployments)

The auth model was designed for local/LAN use. When the app is reachable on the public internet, tighten these:

- **Change the default passwords immediately.** `admin`/`admin` and `sofia`/`password` are well-known defaults — on a public URL anyone could sign in as admin. Update the `pass` values in `auth.json` (scrypt `salt:hash`).
- **Keep `data/` off the web.** It's outside `public/`, so Next.js doesn't serve it — don't move it under `public/`, and prefer an external `SAT_DATA_DIR`.
- **Patch dependencies.** `next@14.2.35` has several High/Moderate advisories that matter once public (SSRF/XSS/DoS). Plan the upgrade to `next@15.5.16` + `postcss@8.5.10`; note the 14→15 jump makes dynamic-route `params` async (`app/api/*/[id]/route.js` would need `const { id } = await params;`).
- **Cookies over HTTPS.** Consider marking the session cookie `secure` in production so it's only sent over HTTPS (Hostinger provides SSL).

## Run it

```bash
npm install
npm run dev
```

Open **http://localhost:3200**. (The app is pinned to port 3200 so the URL is always the same. Change the `-p 3200` in `package.json` scripts if you ever need a different port.)

### Let a student on the same wifi take it

```bash
npm run lan
```

Then find your computer's local IP (Windows: `ipconfig` → IPv4 Address; Mac: `ipconfig getifaddr en0`) and give the student `http://YOUR_IP:3200` on the same network. Plain `localhost` only works on your own machine — the LAN URL is how another device reaches it. Results taken this way are still saved to `data/attempts/` on your computer.

## The coaching workflow

1. **Generate a test.** Ask Claude "generate a new test JSON" and specify topics, difficulty, and length (e.g. a 1-hour mini test focused on weak areas, or a full-length test).
2. **Import it (as admin).** Sign in as `admin`, paste the JSON (or pick a file) in "Import a test", check the preview, adjust the test name, and **Add test**. (Or ship it with the app via `public/tests/` + `manifest.json`.)
3. **Student takes it.** Sign in as the student, start the test. Each section is timed and auto-submits at 0:00. The attempt is graded and saved to `data/attempts/`, attributed to that student, automatically.
4. **Review progress.** The home dashboard shows the trend; filter history by student/test/date and use **View details** to re-open any past attempt's full review.
5. **Analyze with Claude.** As admin, use **Download results JSON** / **Copy to clipboard** on an attempt (or **Copy history for analysis** for the filtered set) and paste it to Claude for weak-area analysis, a study plan, and targeted 5–10 question homework sets. Loop back to step 1.

## Architecture

- **Next.js 14 (App Router), React 18** — a single client page in `app/page.js` handles all screens (login, home, setup, test, break, results, review).
- **Auth** — `lib/auth.js` seeds accounts, hashes/verifies passwords (scrypt), and issues an HMAC-signed `httpOnly` session cookie. Routes: `app/api/login`, `app/api/logout`, `app/api/me`.
- **Attempts API** — `app/api/attempts/route.js` (list / save) and `app/api/attempts/[id]/route.js` (fetch one / delete). Students only ever get their own attempts; delete is admin-only.
- **Tests API** — `app/api/tests/route.js` (list for everyone / create for admin) and `app/api/tests/[id]/route.js` (admin delete) manage the imported tests in `data/tests/`.
- **Shared validation** — `lib/testSchema.js` validates test JSON on both the client (import preview) and the server (import API).
- **Styling** — plain CSS in `app/globals.css`; the app header lives in `app/layout.js`.

## Test JSON schema

```json
{
  "id": "sat-practice-2",
  "title": "SAT practice test 2",
  "description": "Optional description",
  "sections": [
    {
      "name": "Reading & Writing",
      "minutes": 30,
      "questions": [
        {
          "q": "Question text. Use \n\n for passage breaks.",
          "topic": "Words in Context",
          "choices": ["Option A", "Option B", "Option C", "Option D"],
          "answer": 1,
          "explanation": "Why B is correct."
        },
        {
          "q": "Grid-in question text.",
          "type": "grid",
          "topic": "Percentages",
          "answer": ["25", "25%"],
          "explanation": "Accepts any listed string, plus numeric equivalents."
        }
      ]
    }
  ]
}
```

- `answer` for multiple choice is the zero-based index of the correct choice.
- `answer` for grid-ins is a string or an array of accepted strings. Matching is whitespace/case-insensitive **and** numeric-aware, so equivalent forms (`1/2` = `0.5` = `.5`, `2.50` = `2.5`, `1,000` = `1000`, `$160` = `160`) all count as correct — no need to list every form.
- `topic` (optional, any question) is a short label like `"Linear equations"`. When present, results and reviews show a **per-topic weak-area breakdown**. Tag questions consistently to make it useful.
- Any number of sections, each with its own timer.
- Admins can grab a ready-to-edit sample of this format from the app: **Import a test → Download JSON template**.

## Math notation

Test JSON arrives from several sources that don't agree on how to encode math, so the app normalizes it **once at load time** (never during a timed section) and renders it with KaTeX.

Supported in question stems, answer choices, and explanations:

| Written as | Example | Result |
| --- | --- | --- |
| Plain Unicode / ASCII | `x² − 6x + 8`, `5x^7` | left exactly as-is |
| Inline LaTeX | `$\frac{3}{4}x$` | rendered inline |
| Display LaTeX | `$$ky - 4x = 7$$` | rendered on its own line |
| Bare LaTeX in a choice | `\frac{8}{3}`, `25\pi` | rendered |
| Currency | `$10 signup fee plus $25` | left as literal dollars |
| Escaped dollar in math | `$\$250$` | renders as `$250` |

Rules worth knowing:

- **Currency is never mistaken for math.** An odd number of `$` in a string means all of them are literal; a `$…$` pair is only treated as math if the span is short, prose-free, and actually looks symbolic.
- **Math is decided per question, not per string.** A question renders as math only if it shows real LaTeX intent (a `\command` or `^{...}`). A test written with plain `x^3` stays plain throughout, so you never get a half-rendered item.
- **Grid-in answers are never normalized.** Grading compares raw text (plus numeric equivalence), so LaTeX can't leak into the comparison. A `\` in a grid answer is reported as an authoring error.
- **A question can never fail to display.** If KaTeX can't compile a span, it degrades to a flagged `<code class="math-error">` showing the raw source — no blank stems, nothing thrown mid-section.
- Corrupted single-backslash escapes (`\frac` mangled into formfeed + `rac` by JSON escaping) are repaired where unambiguous, and reported where not.

## Results JSON schema (what each attempt stores and exports)

```json
{
  "kind": "sat-runner-results",
  "id": "a-1783562657611-ipxzlb",
  "testId": "sat-practice-1",
  "testTitle": "SAT practice test 1",
  "student": "Alex",
  "completedAt": "2026-07-07T18:30:00.000Z",
  "totalScore": 29,
  "totalQuestions": 36,
  "estScore": 1310,
  "topicStats": [
    { "topic": "Geometry", "correct": 1, "total": 3 },
    { "topic": "Linear equations", "correct": 2, "total": 2 }
  ],
  "sections": [
    {
      "name": "Math",
      "score": 14,
      "total": 16,
      "answers": [
        { "n": 1, "q": "...", "topic": "Linear equations", "given": "B. 5", "correct": "B. 5", "right": true, "explanation": "..." }
      ]
    }
  ]
}
```

- `estScore` is the estimated 400–1600 SAT score (heuristic). `topicStats` aggregates correct/total per `topic` (weakest first) — handy for a study plan. Both are computed locally at grade time.
- The `id` (added by the server when the attempt is saved) is also the filename in `data/attempts/`. This same object is what **Download results JSON** exports.
