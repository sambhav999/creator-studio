import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Map a template id to the reference module file that the coding agent edits.
// Add archetypes here (runner, match3, shooter, ...) — one seed per mechanic family.
const REFERENCE_FILES = {
  chess: "chess.js",
  flappy: "flappy.js"
};

// Aliases let several template ids reuse the closest archetype seed.
const ALIASES = {
  "unity-flappybird": "flappy"
};

const cache = new Map();

function load(file) {
  if (!cache.has(file)) {
    cache.set(file, readFileSync(join(here, "reference", file), "utf8"));
  }
  return cache.get(file);
}

/**
 * Returns the reference source module for a template id, or null if none exists.
 * The agent edits this working code instead of generating from a blank page.
 */
export function getReferenceGame(templateId) {
  const id = ALIASES[templateId] ?? templateId;
  const file = REFERENCE_FILES[id];
  if (!file) return null;
  try {
    return { templateId: id, code: load(file) };
  } catch {
    return null;
  }
}

export function hasReferenceGame(templateId) {
  const id = ALIASES[templateId] ?? templateId;
  return Boolean(REFERENCE_FILES[id]);
}
