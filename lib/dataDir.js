import path from "path";

// Single source of truth for where persistent app data lives: accounts
// (auth.json), imported tests, and score history (attempts).
//
// In production, set SAT_DATA_DIR to a path OUTSIDE the deployment directory
// (e.g. /home/<user>/sat-data on Hostinger). Redeploys replace the app code but
// never touch this folder, so tests and attempts are preserved. The app only
// ever adds files or removes them via an admin delete action — it never wipes
// these directories.
//
// If SAT_DATA_DIR is unset, it defaults to <project>/data (fine for local dev).
export const DATA_DIR = process.env.SAT_DATA_DIR
  ? path.resolve(process.env.SAT_DATA_DIR)
  : path.join(process.cwd(), "data");

export const ATTEMPTS_DIR = path.join(DATA_DIR, "attempts");
export const TESTS_DIR = path.join(DATA_DIR, "tests");
export const AUTH_FILE = path.join(DATA_DIR, "auth.json");
