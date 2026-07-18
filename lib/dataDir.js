import path from "path";
import os from "os";
import fs from "fs";

// Single source of truth for where persistent app data lives: accounts
// (auth.json), imported tests, and score history (attempts).
//
// WHY THIS ISN'T <project>/data by default:
// When the app is redeployed (git checkout / re-upload / rebuild), anything
// inside the deploy directory can be wiped — which is how score history was
// getting lost after each deployment. So by default we store data in the
// user's HOME directory (which persists across deployments), OUTSIDE the app
// folder. Override with SAT_DATA_DIR if you want an explicit location.
function resolveDataDir() {
  if (process.env.SAT_DATA_DIR) return path.resolve(process.env.SAT_DATA_DIR);
  return path.join(os.homedir(), "sat-prep-data");
}

export const DATA_DIR = resolveDataDir();
export const ATTEMPTS_DIR = path.join(DATA_DIR, "attempts");
export const TESTS_DIR = path.join(DATA_DIR, "tests");
export const AUTH_FILE = path.join(DATA_DIR, "auth.json");

// One-time migration: if the persistent data dir doesn't exist yet but an old
// in-project ./data folder does, copy its contents over so existing accounts,
// tests, and attempts aren't left behind. Runs once at server startup; never
// deletes the source.
(function migrateLegacyDataOnce() {
  try {
    const legacy = path.join(process.cwd(), "data");
    if (legacy === DATA_DIR) return; // nothing to migrate
    if (fs.existsSync(DATA_DIR)) return; // already have persistent data
    if (!fs.existsSync(legacy)) return; // no legacy data to move
    fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
    fs.cpSync(legacy, DATA_DIR, { recursive: true });
  } catch {
    // Best effort — if migration fails, the app still starts with a fresh store.
  }
})();
