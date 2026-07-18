import { promises as fs } from "fs";
import path from "path";
import { getSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "data", "attempts");

function safeId(id) {
  return typeof id === "string" && /^[a-z0-9-]+$/i.test(id);
}

async function readOne(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function GET(_req, { params }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!safeId(params.id)) return Response.json({ error: "Bad id." }, { status: 400 });
  const record = await readOne(params.id);
  if (!record) return Response.json({ error: "Not found." }, { status: 404 });
  // A student may only open their own attempts.
  if (session.role !== "admin" && record.username !== session.username) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  return Response.json(record);
}

// Only an admin may delete an attempt.
export async function DELETE(_req, { params }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  if (!safeId(params.id)) return Response.json({ error: "Bad id." }, { status: 400 });
  try {
    await fs.unlink(path.join(DIR, `${params.id}.json`));
  } catch {}
  return Response.json({ ok: true });
}
