import { getSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  return Response.json({ user: user || null });
}
