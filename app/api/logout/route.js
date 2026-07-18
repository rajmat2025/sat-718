import { logout } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  logout();
  return Response.json({ ok: true });
}
