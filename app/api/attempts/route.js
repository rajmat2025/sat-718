import { promises as fs } from "fs";
import path from "path";
import { getSession } from "../../../lib/auth";
import { ATTEMPTS_DIR as DIR } from "../../../lib/dataDir";

export const dynamic = "force-dynamic";

async function readAll() {
  let files;
  try {
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DIR, f), "utf8");
      out.push(JSON.parse(raw));
    } catch {}
  }
  out.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const all = await readAll();
  // Students only ever see their own attempts; admins see everyone's.
  const visible = session.role === "admin" ? all : all.filter((r) => r.username === session.username);
  const attempts = visible.map((r) => ({
    id: r.id,
    username: r.username || null,
    testId: r.testId,
    testTitle: r.testTitle,
    student: r.student,
    completedAt: r.completedAt,
    totalScore: r.totalScore,
    totalQuestions: r.totalQuestions,
    legacy: !!r.legacy,
    demo: !!r.demo,
    sections: (r.sections || []).map((s) => ({ name: s.name, score: s.score, total: s.total })),
  }));
  return Response.json({ attempts });
}

export async function POST(req) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body || body.kind !== "sat-runner-results" || !body.completedAt) {
    return Response.json({ error: "Not a results object." }, { status: 400 });
  }
  const id =
    typeof body.id === "string" && /^[a-z0-9-]+$/i.test(body.id)
      ? body.id
      : `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // The server owns identity: the attempt is always attributed to the signed-in user.
  const student =
    typeof body.student === "string" && body.student.trim() ? body.student.trim() : session.displayName;
  const record = {
    ...body,
    id,
    username: session.username,
    student,
    savedAt: new Date().toISOString(),
  };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
  return Response.json({ id });
}
