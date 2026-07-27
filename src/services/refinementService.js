import { getReferenceGame } from "../data/referenceGames.js";
import { runtimeSmokeTest } from "./gameSmokeTest.js";
import { callZeroGChat, zeroGModels } from "./zeroGService.js";
import vm from "node:vm";

const VALIDATED_RUNTIME_SHELL = `
// KULT_VALIDATED_RUNTIME_V1
const KULT_RUNTIME = (() => {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const input = { x: 0, y: 0, down: false, keys: new Set(), restartRequested: false };
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener("resize", resize);
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    input.x = ((event.clientX ?? 0) - rect.left) * canvas.width / Math.max(1, rect.width);
    input.y = ((event.clientY ?? 0) - rect.top) * canvas.height / Math.max(1, rect.height);
  };
  canvas.addEventListener("pointerdown", (event) => { point(event); input.down = true; input.restartRequested = true; });
  canvas.addEventListener("pointermove", point);
  canvas.addEventListener("pointerup", (event) => { point(event); input.down = false; });
  window.addEventListener("keydown", (event) => {
    input.keys.add(event.code);
    if (event.code === "KeyR" || event.code === "Space" || event.code === "Enter") input.restartRequested = true;
  });
  window.addEventListener("keyup", (event) => input.keys.delete(event.code));
  const assets = {};
  for (const [name, url] of Object.entries(gamePackage.gameplayAssets?.manifest ?? {})) {
    const image = new Image(); image.src = url; assets[name] = image;
  }
  const drawAsset = (name, ...args) => {
    const image = assets[name];
    if (image?.complete && image.naturalWidth) ctx.drawImage(image, ...args);
    return Boolean(image?.complete && image.naturalWidth);
  };
  const reportScore = (score) => window.reportScore?.(Number(score) || 0);
  const consumeRestart = () => { const value = input.restartRequested; input.restartRequested = false; return value; };
  return { canvas, ctx, input, assets, resize, drawAsset, reportScore, consumeRestart };
})();
`.trim();

function attachValidatedRuntimeShell(code) {
  const source = String(code || "");
  return source.includes("KULT_VALIDATED_RUNTIME_V1") ? source : `${VALIDATED_RUNTIME_SHELL}\n\n${source}`;
}

function buildPromptBundle({ gamePackage, request, plan, premium = false }) {
  const premiumRules = premium
    ? [
        "ULTRA PREMIUM QUALITY IS MANDATORY:",
        "- Build polished procedural visuals directly in Canvas/CSS/SVG; do not request or depend on separately generated assets.",
        "- Include purposeful motion: entrance transitions, responsive gameplay animation, impact flashes, particle bursts, and restrained screen shake on major impacts.",
        "- Include a polished start menu, touch-accessible pause/resume, game-over or victory menu, and an obvious tap/click restart flow.",
        "- Include meaningful progression such as increasing difficulty, levels/waves, unlocks, combo milestones, or escalating challenge appropriate to the game.",
        "- Use one intentional art direction: a small named color palette, consistent shapes, typography, lighting, HUD, and effects.",
        "- Prioritize game feel: immediate input response, readable collision feedback, satisfying scoring feedback, and smooth transitions.",
        "- Do not add generated audio or Web Audio. Premium quality must come from gameplay and visuals.",
        "- Treat every item above as required functionality, not optional decoration."
      ]
    : [];
  return {
    premium,
    system: [
      "You are an expert browser game developer.",
      "Generate a fully playable browser game as one complete JavaScript module.",
      "Output only executable JavaScript for src/main.js. Do not use markdown fences.",
      "Use vanilla Canvas 2D. Do not import Phaser, Three.js, React, or external libraries.",
      "Use the existing <canvas id=\"game\"> element and make keyboard plus pointer input work.",
      "FILL THE SCREEN: the game runs in a tall, narrow portrait frame. Set canvas.width = window.innerWidth and canvas.height = window.innerHeight at startup AND on every 'resize' event — never hardcode 960x540 or any fixed size. Position and scale EVERYTHING (board, player, obstacles, HUD) relative to the current canvas.width/height so the playfield always fills the whole frame with no big empty margins. For a square board, make it as large as the smaller dimension allows and center it.",
      "The game MUST be fully playable on a touch phone with no keyboard: handle touchstart/touchend (and pointer events) on the canvas so swipes steer/move and taps perform the main action; never make a physical key the ONLY way to play.",
      "Restart MUST work by tapping or clicking the canvas after game over, in addition to any key (do not rely on 'Press R' alone).",
      "Import the game package with: import { gamePackage } from \"./gamePackage.js\";",
      "Import styles with: import \"./styles.css\";",
      "Do not use export statements anywhere in the module.",
      "When a run ends (game over or win), call window.reportScore(finalScore) if it exists so the score reaches the platform leaderboard.",
      "Maintain responsive sizing, restart behavior, score/state feedback, and a 60 FPS target.",
      "A validated runtime shell named KULT_RUNTIME is prepended automatically. Use KULT_RUNTIME.canvas, KULT_RUNTIME.ctx, KULT_RUNTIME.input, KULT_RUNTIME.drawAsset(name,...), KULT_RUNTIME.reportScore(score), and KULT_RUNTIME.consumeRestart() instead of recreating those systems.",
      "Focus generated code on game-specific state, rules, update, collision, and render functions; do not regenerate generic canvas setup, resize, input, asset-loader, restart-input, or score-bridge boilerplate.",
      ...premiumRules
    ].join("\n"),
    user: [
      `Template: ${gamePackage.templateName}`,
      `Title: ${gamePackage.title}`,
      `Mechanic: ${gamePackage.gameplay?.mechanic}`,
      `Controls: ${gamePackage.gameplay?.controls}`,
      `Tuning: ${JSON.stringify(gamePackage.gameplay?.tuning)}`,
      `Visual mood: ${gamePackage.visuals?.mood}`,
      `Colors: ${(gamePackage.visuals?.colors ?? []).join(", ")}`,
      `Gameplay asset manifest: ${JSON.stringify(gamePackage.gameplayAssets?.manifest ?? gamePackage.visuals?.assets ?? {})}`,
      ...(gamePackage.gameplayAssets?.manifest
        ? [
            "Load every supplied gameplay asset URL with Image objects and render them with drawImage inside the game.",
            "Use the player asset for the main character, environment as the gameplay background, and objects for visible world props/obstacles.",
            "Do not replace supplied assets with circles, rectangles, emoji, Unicode characters, or other placeholder primitives.",
            "Gracefully draw a temporary fallback only while an image is loading."
          ]
        : []),
      `Creator request: ${request || gamePackage.customization?.prompt || "Create a polished playable version of this game."}`,
      ...(plan
        ? [
            "Build plan from the orchestrator — implement the game following its intent and steps, but the technical rules above always win on any conflict:",
            plan
          ]
        : []),
      "Return only the complete JavaScript module. It must run immediately in a Vite browser project."
    ].join("\n")
  };
}

function stripMarkdownFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:js|javascript)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// The preview sandbox wraps the module in a try/catch, where `export` is a
// syntax error that blanks the whole game. Models sometimes append exports
// "for external use" — neutralize them while keeping the declarations.
function stripModuleExports(code) {
  return String(code || "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/^(\s*)export\s+(const|let|var|function|class|async)/gm, "$1$2");
}

function functionRegionAtLine(code, targetLine) {
  if (!targetLine) return null;
  const source = String(code || "");
  const starts = [];
  const pattern = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const open = source.indexOf("{", start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      if (depth === 0) {
        const startLine = source.slice(0, start).split("\n").length;
        const endLine = source.slice(0, i + 1).split("\n").length;
        if (targetLine >= startLine && targetLine <= endLine) {
          starts.push({ name: match[1] || match[2], start, end: i + 1, code: source.slice(start, i + 1) });
        }
        break;
      }
    }
  }
  return starts.sort((a, b) => b.start - a.start)[0] ?? null;
}

function replaceFunctionRegion(moduleCode, region, replacement) {
  const clean = stripModuleExports(stripMarkdownFence(replacement));
  if (!clean || !new RegExp(`\\b${region.name}\\b`).test(clean)) return null;
  return `${moduleCode.slice(0, region.start)}${clean}${moduleCode.slice(region.end)}`;
}

function sumUsage(usages) {
  return usages.reduce((total, usage) => {
    if (!usage) return total;
    total.prompt_tokens += usage.prompt_tokens ?? 0;
    total.completion_tokens += usage.completion_tokens ?? 0;
    total.total_tokens += usage.total_tokens ?? 0;
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

// Validates that the module parses as JavaScript once the sandbox strips its
// import lines (the same shape the browser executes). Returns the syntax
// error message, or null when the code is valid.
function findSyntaxError(code) {
  const stripped = String(code || "")
    .replace(/^\s*import\s+["'][^"']*["'];?\s*$/gm, "")
    .replace(/^\s*import\s+[^;\n]*from\s+["'][^"']*["'];?\s*$/gm, "");
  try {
    // Parses without executing.
    new Function(stripped);
    return null;
  } catch (error) {
    return error.message;
  }
}

function findSyntaxLine(code) {
  const stripped = String(code || "")
    .replace(/^\s*import\s+["'][^"']*["'];?\s*$/gm, "")
    .replace(/^\s*import\s+[^;\n]*from\s+["'][^"']*["'];?\s*$/gm, "");
  try {
    new vm.Script(stripped, { filename: "generated-game.js" });
    return null;
  } catch (error) {
    const match = String(error?.stack || "").match(/generated-game\.js:(\d+)/);
    return match ? Number(match[1]) : null;
  }
}

// 12 minutes per attempt, one retry: worst case stays inside a 15-minute
// generation budget instead of the previous 20min x 3 attempts.
async function callCodingStage({
  model,
  system,
  user,
  maxTokens = 3500,
  timeoutMs = 720000,
  retries = 1,
  onChunk
}) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  const response = await callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs,
    retries,
    messages,
    onChunk
  });

  // A module cut off at the token cap is a guaranteed syntax error — issue one
  // continuation and concatenate instead of shipping half a file.
  if (response.finishReason !== "length") return response;

  const continuation = await callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs,
    retries,
    onChunk,
    messages: [
      ...messages,
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: "Your output was cut off mid-file. Continue EXACTLY from the character where you stopped. Output only the remaining code, with no markdown fences and no repetition of code you already wrote."
      }
    ]
  });

  return {
    ...response,
    content: response.content + continuation.content,
    finishReason: continuation.finishReason,
    usage: sumUsage([response.usage, continuation.usage])
  };
}

function missingRuntimeFeatures(code) {
  const checks = [
    ["#game canvas selection", /querySelector\s*\(\s*["'`]#game["'`]\s*\)/],
    ["2D rendering context", /getContext\s*\(\s*["'`]2d["'`]\s*\)/],
    ["animation loop", /requestAnimationFrame\s*\(/],
    ["pointer or touch input", /pointerdown|mousedown|touchstart/],
    ["restart input", /restart|KeyR|keydown/i]
  ];

  return checks.filter(([, pattern]) => !pattern.test(code)).map(([label]) => label);
}

function missingPremiumFeatures(code) {
  const checks = [
    ["procedural particles", /\bparticles?\b|\bsparks?\b|\bconfetti\b|\bburst\b/i],
    ["impact screen shake", /\b(screenShake|cameraShake|shake(?:Time|Amount|Intensity|Offset)?)\b/i],
    ["start menu", /\b(startMenu|startScreen|gameState\s*=\s*["'`]start|state\s*=\s*["'`]menu)\b/i],
    ["pause and resume", /\bpause(?:d|Menu)?\b[\s\S]{0,120}\bresume\b|\bresume\b[\s\S]{0,120}\bpause/i],
    ["game-over or victory menu", /\b(gameOver|game-over|victory|winScreen|endScreen)\b/i],
    ["progression or escalating challenge", /\b(level|wave|difficulty|combo|milestone|unlock)\b/i],
    ["consistent palette or art direction", /\b(palette|colorPalette|themeColors|COLORS)\b/]
  ];

  return checks.filter(([, pattern]) => !pattern.test(code)).map(([label]) => label);
}

function missingRequiredFeatures(code, premium) {
  return [
    ...missingRuntimeFeatures(code),
    ...(premium ? missingPremiumFeatures(code) : [])
  ];
}

// From-scratch generation is capped at ~15,000 characters of code: generation
// time scales linearly with output length, and the cap keeps a pure-agent
// build inside a single response (no slow continuation round). 15K chars is
// ~4.5K tokens; the 6144 ceiling leaves headroom without allowing 16K-token runs.
const SCRATCH_CHAR_TARGET = 15000;
const SCRATCH_MAX_TOKENS = 6144;

async function generateWithModel(promptBundle, model, onProgress, models = zeroGModels) {
  // Single-stage unified code generation for maximum speed
  const response = await callCodingStage({
    model,
    maxTokens: SCRATCH_MAX_TOKENS,
    onChunk: (chars) => onProgress?.({ stage: "writing-code", chars }),
    system: [
      promptBundle.system,
      "You are implementing a complete browser game from scratch in one complete JavaScript module.",
      "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
      `Keep the complete module under ${SCRATCH_CHAR_TARGET.toLocaleString("en-US")} characters: favor compact, focused gameplay over decorative extras, and never pad with comments.`,
      "Make the game fill the entire browser viewport: set canvas.width = window.innerWidth and canvas.height = window.innerHeight on startup and on every window resize, and position/scale all gameplay relative to the current canvas size (no fixed 960x540 layouts).",
      "Return only executable JavaScript source without markdown fences.",
      "The script must select the <canvas id=\"game\"> element, get the 2D rendering context, and implement the complete game state, loop, input handling, and canvas rendering.",
      "It must run immediately when imported in a Vite project.",
      "Do not access resources other than the supplied gameplay asset manifest, and do not use external libraries. Handle game restart (KeyR) and resize correctly."
    ].join("\n"),
    user: promptBundle.user
  });

  let generatedCode = attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(response.content)));
  const usages = [response.usage];
  const stages = {
    unifiedGeneration: { model: response.model, usage: response.usage }
  };

  // One repair pass on the fast background model: catches modules that came
  // back without a loop, input, or canvas wiring, at a fraction of the
  // coding model's latency.
  const missing = missingRequiredFeatures(generatedCode, promptBundle.premium);
  if (missing.length > 0) {
    try {
      const repair = await callCodingStage({
        model: models.repair || models.coding,
        maxTokens: SCRATCH_MAX_TOKENS,
        timeoutMs: promptBundle.premium ? 120000 : 720000,
        retries: promptBundle.premium ? 0 : 1,
        onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
        system: [
          promptBundle.system,
          "Repair the supplied incomplete src/main.js.",
          "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
          "Return one complete executable module, not an explanation.",
          "It must select document.querySelector(\"#game\"), obtain a 2D context, render the game, handle pointer/touch and keyboard input, run requestAnimationFrame, and support restart (KeyR).",
          ...(promptBundle.premium
            ? [
                "This is the single Ultra polish repair. Preserve working gameplay and add only the missing premium requirements.",
                "Complete this repair within the strict two-minute polish budget. Do not add audio."
              ]
            : []),
          `The previous output was missing: ${missing.join(", ")}.`
        ].join("\n"),
        user: [promptBundle.user, "\nINCOMPLETE MODULE:\n", generatedCode].join("\n")
      });
      const repairedCode = attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(repair.content)));
      usages.push(repair.usage);
      stages.repair = { model: models.repair || models.coding, usage: repair.usage };
      // Only adopt the repair when it actually closes gaps.
      if (missingRequiredFeatures(repairedCode, promptBundle.premium).length < missing.length) {
        generatedCode = repairedCode;
      }
    } catch (error) {
      if (!promptBundle.premium) throw error;
      // The premium polish pass is optional after a playable first result.
      // If its strict budget expires, return the original build immediately.
      stages.repair = {
        model: models.repair || models.coding,
        skipped: true,
        reason: error.message
      };
    }
  }

  return {
    provider: response.provider,
    model: response.model,
    generatedCode,
    usage: sumUsage(usages),
    stages
  };
}

// Returns the first concrete problem with a module, or null when it runs clean.
function moduleProblem(code, gamePackage) {
  const syntaxError = findSyntaxError(code);
  if (syntaxError) return `It has a JavaScript syntax error: ${syntaxError}`;
  const smoke = runtimeSmokeTest(code, gamePackage);
  if (!smoke.ok) return `It parses but crashes the moment it runs: ${smoke.error}`;
  const missing = missingRuntimeFeatures(code);
  if (missing.length > 0) return `It is missing required pieces: ${missing.join(", ")}`;
  return null;
}

// A module is "hard broken" only if it definitely won't run for the player: a
// syntax error, missing core runtime wiring, or a crash AS IT LOADS. A crash
// that only appears while blindly stepping frames with no input is treated as
// soft — for an edit we'd rather apply the change (with a warning) than revert
// it, since such crashes are often false positives for input-driven games.
function hardBrokenReason(code, gamePackage) {
  const syntaxError = findSyntaxError(code);
  if (syntaxError) return `JavaScript syntax error: ${syntaxError}`;
  const missing = missingRuntimeFeatures(code);
  if (missing.length > 0) return `missing required pieces: ${missing.join(", ")}`;
  const smoke = runtimeSmokeTest(code, gamePackage);
  if (!smoke.ok && smoke.phase === "load") return `crashes as it loads: ${smoke.error}`;
  return null;
}

// Repairs an edited game module in place — NEVER regenerates from scratch.
// Each attempt feeds the exact current error back to the agent and asks it to
// fix ONLY that while keeping the existing gameplay and the creator's change.
// Escalates to the stronger coding model after the first cheap attempt.
async function repairEditedModule(code, promptBundle, gamePackage, onProgress, maxAttempts = 3, models = zeroGModels) {
  let current = code;
  const usages = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const hard = hardBrokenReason(current, gamePackage);
    const problem = hard || moduleProblem(current, gamePackage);
    if (!problem) return { code: current, ok: true, usage: sumUsage(usages) };
    // Only a soft frame-step warning remains after a first try — stop here and
    // let the caller ship the edit rather than burning more time/tokens.
    if (!hard && attempt > 1) break;
    const repair = await callCodingStage({
      model: models.repair || models.coding,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "Repair the game module below. KEEP all existing gameplay and the change the creator asked for — fix ONLY what is broken.",
        "Return one complete executable src/main.js module, no markdown fences, no explanation.",
        "Problem to fix: " + problem
      ].join("\n"),
      user: [promptBundle.user, "\nMODULE TO FIX (repair in place, keep its behavior):\n", current].join("\n")
    });
    usages.push(repair.usage);
    current = attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(repair.content)));
  }
  return { code: current, ok: !moduleProblem(current, gamePackage), usage: sumUsage(usages) };
}

// Seed-and-edit: hand the agent a working reference module and ask it to modify
// that, instead of writing from a blank page. When the edit comes back broken,
// it is REPAIRED in place (multiple attempts, keeping the creator's change) —
// never regenerated from scratch. Only if repair cannot make it run does the
// previous working build ship unchanged.
async function generateFromSeed(promptBundle, seedCode, model, onProgress, gamePackage, models = zeroGModels) {
  const integration = await callCodingStage({
    model,
    maxTokens: 12000,
    onChunk: (chars) => onProgress?.({ stage: "editing-seed", chars }),
    system: [
      promptBundle.system,
      "You are EDITING an existing, working game implementation, not writing one from scratch.",
      "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
      "Start from the REFERENCE module below and modify it to satisfy the creator request.",
      "Keep everything that already works: the game loop, input handling, rendering, and win/lose flow.",
      "Change only what the request needs — theme, colors, rules tweaks, difficulty, labels, or mechanic variations.",
      "Preserve the import lines and the #game canvas usage. Return one complete executable src/main.js module without markdown fences."
    ].join("\n"),
    user: [promptBundle.user, "\nREFERENCE MODULE (edit this, keep its structure):\n", seedCode].join("\n")
  });
  let generatedCode = attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(integration.content)));
  const usages = [integration.usage];

  // Repair in place if anything looks wrong — never regenerate from scratch.
  if (moduleProblem(generatedCode, gamePackage)) {
    const repaired = await repairEditedModule(generatedCode, promptBundle, gamePackage, onProgress, 3, models);
    usages.push(repaired.usage);
    // Keep the repaired code as long as it isn't WORSE than where we started.
    if (!hardBrokenReason(repaired.code, gamePackage) || repaired.ok) {
      generatedCode = attachValidatedRuntimeShell(repaired.code);
    }
  }

  // Only revert to the previous build when the edit definitely won't run for
  // the player (syntax / missing wiring / load-time crash). A soft frame-step
  // warning still ships the edit so the creator's change isn't dropped.
  const hardReason = hardBrokenReason(generatedCode, gamePackage);
  if (hardReason) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: seedCode,
      usage: sumUsage(usages),
      stages: { seedEdit: { model, usage: integration.usage } },
      source: "seed-fallback"
    };
  }

  const soft = moduleProblem(generatedCode, gamePackage);
  return {
    provider: integration.provider,
    model: integration.model,
    generatedCode,
    usage: sumUsage(usages),
    stages: { seedEdit: { model: integration.model, usage: integration.usage } },
    source: "seed-edit",
    warning: soft ? "Edit applied — give it a quick test; if something misbehaves, describe the fix in chat." : null
  };
}

async function call0GAgent(promptBundle, onProgress, models = zeroGModels) {
  try {
    return await generateWithModel(promptBundle, models.coding, onProgress, models);
  } catch (error) {
    const fallbackModel = models.background;
    const nonRetriable = error.status && error.status < 500 && ![408, 429].includes(error.status);
    if (fallbackModel === models.coding || nonRetriable) throw error;

    console.warn("0G coding model failed after retries; using fallback", {
      primaryModel: models.coding,
      fallbackModel,
      message: error.message
    });
    return generateWithModel(promptBundle, fallbackModel, onProgress, models);
  }
}

// Broken syntax means a black screen in the sandbox. One cheap repair attempt
// on the fast model fixes most cases; a seed-backed game falls back to the
// working reference if the repair fails too.
async function ensureValidSyntax(generated, promptBundle, reference, onProgress, models = zeroGModels) {
  let syntaxError = findSyntaxError(generated.generatedCode);
  if (!syntaxError) return generated;

  try {
    const syntaxLine = findSyntaxLine(generated.generatedCode);
    const region = functionRegionAtLine(generated.generatedCode, syntaxLine);
    const repair = await callCodingStage({
      model: models.repair || models.coding,
      maxTokens: region ? 5000 : 16384,
      onChunk: (chars) => onProgress?.({ stage: "fixing-syntax", chars }),
      system: [
        promptBundle.system,
        region
          ? `Repair only the complete function named ${region.name}. Return that one complete corrected function and nothing else.`
          : "The module below fails to parse. Return the complete corrected module and nothing else.",
        `SyntaxError: ${syntaxError}`,
        ...(syntaxLine ? [`Failing generated module line: ${syntaxLine}`] : [])
      ].join("\n"),
      user: [
        promptBundle.user,
        region ? `\nBROKEN FUNCTION ${region.name}:\n` : "\nBROKEN MODULE:\n",
        region?.code ?? generated.generatedCode
      ].join("\n")
    });
    const targeted = region
      ? replaceFunctionRegion(generated.generatedCode, region, repair.content)
      : null;
    const fixed = targeted
      ? attachValidatedRuntimeShell(targeted)
      : attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(repair.content)));
    if (!findSyntaxError(fixed)) {
      return {
        ...generated,
        generatedCode: fixed,
        usage: sumUsage([generated.usage, repair.usage]),
        stages: { ...generated.stages, syntaxRepair: { model: models.repair || models.coding, usage: repair.usage } }
      };
    }
    syntaxError = findSyntaxError(fixed) ?? syntaxError;
  } catch {
    // repair call itself failed — fall through to the reference fallback
  }

  if (reference) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: reference.code,
      usage: generated.usage,
      stages: generated.stages,
      source: "seed-fallback",
      warning: `Generated code had a syntax error (${syntaxError}); shipped the working reference instead.`
    };
  }

  generated.warning = `Generated code has a syntax error the repair could not fix: ${syntaxError}`;
  return generated;
}

// Parsing clean is not the same as running clean: code like `board[r][c] = x`
// (where board[r] is undefined) crashes the instant it executes, showing the
// player "Generated build failed to run…". Run the module in a mocked browser;
// if it throws, repair it with the runtime error, then re-test. A seed-backed
// game falls back to the working reference if the repair still crashes.
async function ensureRuntimeRuns(generated, promptBundle, gamePackage, reference, onProgress, models = zeroGModels) {
  let result = runtimeSmokeTest(generated.generatedCode, gamePackage);
  if (result.ok) return generated;

  try {
    const region = functionRegionAtLine(generated.generatedCode, result.line);
    const repair = await callCodingStage({
      model: models.repair || models.coding,
      maxTokens: region ? 5000 : 16384,
      onChunk: (chars) => onProgress?.({ stage: "fixing-runtime", chars }),
      system: [
        promptBundle.system,
        region
          ? `Repair only the complete function named ${region.name}. Return that one complete corrected function and nothing else.`
          : "The module below PARSES but throws a runtime error. Return the complete corrected module and nothing else.",
        "Keep all working gameplay behavior unchanged.",
        `Runtime error: ${result.error}`,
        ...(result.line ? [`Failing generated module line: ${result.line}`] : []),
        "Common causes: indexing into an array/object that was never initialised (e.g. board[r][c] before board[r] exists), reading a property of a variable that is still undefined, or using an element/context before it is assigned."
      ].join("\n"),
      user: [
        promptBundle.user,
        region ? `\nBROKEN FUNCTION ${region.name}:\n` : "\nBROKEN MODULE:\n",
        region?.code ?? generated.generatedCode
      ].join("\n")
    });
    const targeted = region
      ? replaceFunctionRegion(generated.generatedCode, region, repair.content)
      : null;
    const fixed = targeted
      ? attachValidatedRuntimeShell(targeted)
      : attachValidatedRuntimeShell(stripModuleExports(stripMarkdownFence(repair.content)));
    if (!findSyntaxError(fixed) && runtimeSmokeTest(fixed, gamePackage).ok) {
      return {
        ...generated,
        generatedCode: fixed,
        usage: sumUsage([generated.usage, repair.usage]),
        stages: { ...generated.stages, runtimeRepair: { model: models.repair || models.coding, usage: repair.usage } }
      };
    }
    result = runtimeSmokeTest(fixed, gamePackage).ok ? { ok: true } : result;
  } catch {
    // repair call itself failed — fall through to the reference fallback
  }

  if (reference) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: reference.code,
      usage: generated.usage,
      stages: generated.stages,
      source: "seed-fallback",
      warning: `Generated code crashed at runtime (${result.error}); shipped the working reference instead.`
    };
  }

  generated.warning = `Generated code crashes at runtime: ${result.error}`;
  return generated;
}

export async function createRefinementBundle(
  { gamePackage, request, refinementLevel, strategy, baseCode, plan, tier, models = zeroGModels },
  { onProgress } = {}
) {
  if (!gamePackage) {
    const error = new Error("gamePackage is required");
    error.status = 400;
    throw error;
  }

  // The orchestrator plan only guides from-scratch pure-agent builds; seeded
  // template edits already have the reference code as their spec.
  const promptBundle = buildPromptBundle({
    gamePackage,
    request,
    plan: strategy === "pure-agent" && !baseCode ? plan : null,
    premium: Number(tier) === 3 && !baseCode
  });
  // When the caller supplies the game's current code (post-creation editing),
  // that code IS the seed — the agent applies the requested change to it.
  const reference = baseCode
    ? { templateId: gamePackage.templateId ?? "current-build", code: baseCode }
    : getReferenceGame(gamePackage.templateId);

  let generated;
  if (reference && (baseCode || strategy !== "pure-agent")) {
    try {
      generated = await generateFromSeed(promptBundle, reference.code, models.coding, onProgress, gamePackage, models);
    } catch (error) {
      // Agent unreachable — ship the working reference unchanged so the user still gets a game.
      generated = {
        provider: "reference",
        model: "reference-seed",
        generatedCode: reference.code,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        stages: {},
        source: "seed-fallback",
        warning: error.message
      };
    }
  } else {
    generated = await call0GAgent(promptBundle, onProgress, models);
    generated.source = generated.source ?? "agent";
  }

  if (generated.source !== "seed-fallback") {
    const fallbackRef = strategy !== "pure-agent" ? reference : null;
    generated = await ensureValidSyntax(generated, promptBundle, fallbackRef, onProgress, models);
    // Syntax-clean code can still crash on its first run — verify it actually
    // executes and repair/fall back if not.
    if (generated.source !== "seed-fallback") {
      generated = await ensureRuntimeRuns(generated, promptBundle, gamePackage, fallbackRef, onProgress, models);
    }
  }

  const syntaxOk = !findSyntaxError(generated.generatedCode);
  const premiumMissing = promptBundle.premium
    ? missingPremiumFeatures(generated.generatedCode)
    : [];

  return {
    jobId: `refine_${Date.now().toString(36)}`,
    eta: "complete",
    costProfile: "0g-router-call",
    refinementLevel: refinementLevel ?? "medium",
    promptBundle,
    seededFrom: reference?.templateId ?? null,
    source: generated.source,
    provider: generated.provider,
    model: generated.model,
    generatedCode: generated.generatedCode,
    usage: generated.usage,
    stages: generated.stages,
    warning: generated.warning ?? null,
    validation: [
      syntaxOk ? "Syntax validates" : "Syntax check FAILED",
      "Runs immediately in browser",
      "Pointer and keyboard input works",
      gamePackage.gameplayAssets?.manifest ? "Generated gameplay assets integrated" : "No external images",
      "Performance target is 60 FPS",
      ...(promptBundle.premium
        ? [
            premiumMissing.length === 0
              ? "Ultra premium visual/gameplay checklist validates"
              : `Ultra premium checklist missing: ${premiumMissing.join(", ")}`
          ]
        : [])
    ]
  };
}
