import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { cookies } from "next/headers";

const DATA = path.join(process.cwd(), "data");
const AUTH_FILE = path.join(DATA, "auth.json");
const COOKIE = "sat_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `${salt}:${h}`;
}

function verifyPassword(pw, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const test = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  const a = Buffer.from(h, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Seed the two starter accounts on first run. Passwords are stored hashed.
async function getAuth() {
  try {
    return JSON.parse(await fs.readFile(AUTH_FILE, "utf8"));
  } catch {
    const auth = {
      secret: crypto.randomBytes(32).toString("hex"),
      users: [
        { username: "admin", role: "admin", displayName: "Admin", pass: hashPassword("admin") },
        { username: "sofia", role: "student", displayName: "Sofia", pass: hashPassword("password") },
      ],
    };
    await fs.mkdir(DATA, { recursive: true });
    await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), "utf8");
    return auth;
  }
}

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function login(username, password) {
  const auth = await getAuth();
  const user = auth.users.find(
    (u) => u.username.toLowerCase() === String(username || "").trim().toLowerCase()
  );
  if (!user || !verifyPassword(password, user.pass)) return null;
  const token = sign({ username: user.username, t: Date.now() }, auth.secret);
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return { username: user.username, role: user.role, displayName: user.displayName };
}

export function logout() {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const auth = await getAuth();
  const payload = unsign(token, auth.secret);
  if (!payload) return null;
  const user = auth.users.find((u) => u.username === payload.username);
  if (!user) return null;
  return { username: user.username, role: user.role, displayName: user.displayName };
}
