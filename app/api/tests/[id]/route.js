import { promises as fs } from "fs";
import path from "path";
import { getSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "data", "tests");

function safeId(id) {
  return typeof id === "string" && /^[a-z0-9-]+$/i.test(id);
}

// Only an admin may delete an imported test.
export async function DELETE(_req, { params }) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  if (!safeId(params.id)) return Response.json({ error: "Bad id." }, { status: 400 });
  try {
    await fs.unlink(path.join(DIR, `${params.id}.json`));
  } catch {}
  return Response.json({ ok: true });
}
