import { login } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const user = await login(body.username, body.password);
  if (!user) return Response.json({ error: "Invalid username or password." }, { status: 401 });
  return Response.json({ user });
}
