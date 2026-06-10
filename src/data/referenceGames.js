import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Map a template id to the reference module file that the coding agent edits.
// Add archetypes here (runner, match3, shooter, ...) — one seed per mechanic family.
const REFERENCE_FILES = {
  chess: "chess.js",
  flappy: "flappy.js",
  runner: "runner.js",
  match3: "match3.js",
  shooter: "shooter.js",
  arena: "arena.js",
  clicker: "clicker.js",
  memory: "memory.js",
  quiz: "quiz.js",
  racing: "racing.js",
  snake: "snake.js",
  pong: "pong.js",
  tetris: "tetris.js",
  bubble: "bubble.js",
  breakout: "breakout.js",
  soccer: "soccer.js",
  crossy: "crossy.js",
  merge2048: "merge2048.js"
};

// Aliases let several template ids reuse the closest archetype seed. Every
// template id — backend templates and all frontend/public-folder games —
// must resolve to a seed so hybrid generation always edits working code
// instead of writing a game from a blank page.
const ALIASES = {
  // flappy family
  "unity-flappybird": "flappy",
  "stick-panda": "flappy",

  // runner / platformer family
  "cyber-runner": "runner",
  "unity-runner": "runner",
  "unity-platformer": "runner",
  "minigames": "runner",
  "goof-runner": "runner",
  "scary-run": "runner",

  // falling-blocks puzzles
  "unity-tetris": "tetris",

  // match-3 family (the 36-games bundle ships many reskins)
  "blocks-match3": "match3",
  "animals-crash-match3": "match3",
  "candy-match3": "match3",
  "christmas-balls": "match3",
  "christmas-candy": "match3",
  "christmas-gifts": "match3",
  "christmas-match3": "match3",
  "crazy-match3": "match3",
  "funny-faces-match3": "match3",
  "halloween-match3": "match3",
  "happy-halloween-match3": "match3",
  "jewels-match": "match3",
  "lollipops-match3": "match3",
  "monster-match3": "match3",
  "sea-animals": "match3",
  "smiles-match3": "match3",
  "space-match3": "match3",
  "summer-match3": "match3",
  "sweet-match3": "match3",
  "valentines-match3": "match3",

  // bubble shooter family
  "bubble-shooter": "bubble",
  "frog-super-bubbles": "bubble",
  "happy-chef-bubble-shooter": "bubble",
  "christmas-bubbles": "bubble",

  // shooter family
  "space-shooter": "shooter",
  "unity-spaceinvaders": "shooter",
  "unity-towerdefense": "shooter",

  // top-down arena / combat family
  "ai-arena": "arena",
  "fps-survival": "arena",
  "unity-fps": "arena",
  "unity-zombiesmasher": "arena",

  // idle / tap family
  "idle": "clicker",
  "spin-wheel-royale": "clicker",
  "plinko-pro": "clicker",

  // card / grid-reveal family
  "unity-solitaire": "memory",
  "cratch-royale": "memory",
  "stake-mines": "memory",

  // trivia / creative family
  "drawing": "quiz",
  "math-game-kids": "quiz",

  // racing / driving family
  "realistic-driving": "racing",
  "unity-karting": "racing",
  "flight-sim": "racing",
  "mini-racer": "racing",
  "race-kings": "racing",
  "cars": "racing",
  "crazy-car": "racing",
  "road-racer": "racing",
  "speed-racer": "racing",
  "truck-racer": "racing",

  // grid-movement family
  "unity-snake": "snake",
  "unity-pacman": "snake",

  // ball-and-paddle family
  "unity-pong": "pong",
  "billiards": "pong",
  "pops-billiards": "pong",
  "neon-bounce": "breakout",

  // sports family
  "head-soccer-2026": "soccer",

  // road-crossing family
  "chicken-cross": "crossy"
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
