import { promises as fs } from "fs";
import path from "path";
import { getSession } from "../../../lib/auth";
import { validateTest, slugify } from "../../../lib/testSchema";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "data", "tests");

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
      out.push(JSON.parse(await fs.readFile(path.join(DIR, f), "utf8")));
    } catch {}
  }
  return out;
}

// Any signed-in user can see the imported tests (so students can take them).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ tests: await readAll() });
}

// Only an admin may import a test.
export async function POST(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const err = validateTest(body);
  if (err) return Response.json({ error: err }, { status: 400 });

  const id = /^[a-z0-9-]+$/i.test(body.id || "") ? body.id : slugify(body.title) || `test-${Date.now()}`;
  const record = { ...body, id, importedBy: s.username, importedAt: new Date().toISOString() };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
  return Response.json({ test: record });
}
