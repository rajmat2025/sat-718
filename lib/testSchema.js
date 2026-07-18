// Shared test-JSON validator used by both the client UI and the server tests API.
export function validateTest(t) {
  if (!t || typeof t !== "object") return "Not a JSON object.";
  if (!t.id || !t.title) return "Missing id or title.";
  if (!Array.isArray(t.sections) || t.sections.length === 0) return "Missing sections array.";
  for (const s of t.sections) {
    if (!s.name || !s.minutes || !Array.isArray(s.questions) || s.questions.length === 0)
      return `Section "${s.name || "?"}" needs name, minutes, and questions.`;
    for (const q of s.questions) {
      if (!q.q) return "A question is missing its q text.";
      if (q.type === "grid") {
        if (q.answer === undefined) return "A grid-in question is missing its answer.";
      } else {
        if (!Array.isArray(q.choices) || typeof q.answer !== "number")
          return "A multiple-choice question needs choices and a numeric answer index.";
      }
    }
  }
  return null;
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
