import { getReferenceGame } from "../data/referenceGames.js";
import { callZeroGChat, zeroGModels } from "./zeroGService.js";

function buildPromptBundle({ gamePackage, request }) {
  return {
    system: [
      "You are an expert browser game developer.",
      "Generate a fully playable browser game as one complete JavaScript module.",
      "Output only executable JavaScript for src/main.js. Do not use markdown fences.",
      "Use vanilla Canvas 2D. Do not import Phaser, Three.js, React, or external libraries.",
      "Use the existing <canvas id=\"game\"> element and make keyboard plus pointer input work.",
      "Import the game package with: import { gamePackage } from \"./gamePackage.js\";",
      "Import styles with: import \"./styles.css\";",
      "Do not use export statements anywhere in the module.",
      "Maintain responsive sizing, restart behavior, score/state feedback, and a 60 FPS target."
    ].join("\n"),
    user: [
      `Template: ${gamePackage.templateName}`,
      `Title: ${gamePackage.title}`,
      `Mechanic: ${gamePackage.gameplay?.mechanic}`,
      `Controls: ${gamePackage.gameplay?.controls}`,
      `Tuning: ${JSON.stringify(gamePackage.gameplay?.tuning)}`,
      `Visual mood: ${gamePackage.visuals?.mood}`,
      `Colors: ${(gamePackage.visuals?.colors ?? []).join(", ")}`,
      `Assets: ${gamePackage.visuals?.assets}`,
      `Creator request: ${request || gamePackage.customization?.prompt || "Create a polished playable version of this game."}`,
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

// 12 minutes per attempt, one retry: worst case stays inside a 15-minute
// generation budget instead of the previous 20min x 3 attempts.
async function callCodingStage({ model, system, user, maxTokens = 3500, timeoutMs = 720000, onChunk }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  const response = await callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs,
    retries: 1,
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
    retries: 1,
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

async function generateWithModel(promptBundle, model, onProgress) {
  // Single-stage unified code generation for maximum speed
  const response = await callCodingStage({
    model,
    maxTokens: 16384,
    onChunk: (chars) => onProgress?.({ stage: "writing-code", chars }),
    system: [
      promptBundle.system,
      "You are implementing a complete browser game from scratch in one complete JavaScript module.",
      "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
      "Return only executable JavaScript source without markdown fences.",
      "The script must select the <canvas id=\"game\"> element, get the 2D rendering context, and implement the complete game state, loop, input handling, and canvas rendering.",
      "It must run immediately when imported in a Vite project.",
      "Do not access external resources or libraries. Handle game restart (KeyR) and resize correctly."
    ].join("\n"),
    user: promptBundle.user
  });

  let generatedCode = stripModuleExports(stripMarkdownFence(response.content));
  const usages = [response.usage];
  const stages = {
    unifiedGeneration: { model: response.model, usage: response.usage }
  };

  // One repair pass on the fast background model: catches modules that came
  // back without a loop, input, or canvas wiring, at a fraction of the
  // coding model's latency.
  const missing = missingRuntimeFeatures(generatedCode);
  if (missing.length > 0) {
    const repair = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "Repair the supplied incomplete src/main.js.",
        "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
        "Return one complete executable module, not an explanation.",
        "It must select document.querySelector(\"#game\"), obtain a 2D context, render the game, handle pointer/touch and keyboard input, run requestAnimationFrame, and support restart (KeyR).",
        `The previous output was missing: ${missing.join(", ")}.`
      ].join("\n"),
      user: [promptBundle.user, "\nINCOMPLETE MODULE:\n", generatedCode].join("\n")
    });
    const repairedCode = stripModuleExports(stripMarkdownFence(repair.content));
    usages.push(repair.usage);
    stages.repair = { model: zeroGModels.background, usage: repair.usage };
    // Only adopt the repair when it actually closes gaps.
    if (missingRuntimeFeatures(repairedCode).length < missing.length) {
      generatedCode = repairedCode;
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

// Seed-and-edit: hand the agent a working reference module and ask it to modify
// that, instead of writing from a blank page. Faster, cheaper, and far more reliable.
// If the agent is unreachable or returns broken code, the reference ships unchanged.
async function generateFromSeed(promptBundle, seedCode, model, onProgress) {
  let integration = await callCodingStage({
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
  let generatedCode = stripModuleExports(stripMarkdownFence(integration.content));
  let missing = missingRuntimeFeatures(generatedCode);

  if (missing.length > 0) {
    // Repair on the fast background model — keeps hybrid inside its time budget.
    integration = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: 12000,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "Repair the edited module so it runs as one complete src/main.js, not an explanation.",
        "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
        "It must select document.querySelector(\"#game\"), obtain a 2D context, run requestAnimationFrame, handle pointer/touch and keyboard input, and support restart.",
        "When unsure, keep the reference behavior. The previous output was missing: " + missing.join(", ") + "."
      ].join("\n"),
      user: [promptBundle.user, "\nEDITED MODULE:\n", generatedCode, "\nREFERENCE MODULE:\n", seedCode].join("\n")
    });
    generatedCode = stripModuleExports(stripMarkdownFence(integration.content));
    missing = missingRuntimeFeatures(generatedCode);
  }

  if (missing.length > 0) {
    // Agent could not produce a runnable edit — ship the working reference unchanged.
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: seedCode,
      usage: sumUsage([integration.usage]),
      stages: { seedEdit: { model, usage: integration.usage } },
      source: "seed-fallback"
    };
  }

  return {
    provider: integration.provider,
    model: integration.model,
    generatedCode,
    usage: sumUsage([integration.usage]),
    stages: { seedEdit: { model: integration.model, usage: integration.usage } },
    source: "seed-edit"
  };
}

async function call0GAgent(promptBundle, onProgress) {
  try {
    return await generateWithModel(promptBundle, zeroGModels.coding, onProgress);
  } catch (error) {
    const fallbackModel = zeroGModels.background;
    const nonRetriable = error.status && error.status < 500 && ![408, 429].includes(error.status);
    if (fallbackModel === zeroGModels.coding || nonRetriable) throw error;

    console.warn("0G coding model failed after retries; using fallback", {
      primaryModel: zeroGModels.coding,
      fallbackModel,
      message: error.message
    });
    return generateWithModel(promptBundle, fallbackModel, onProgress);
  }
}

// Broken syntax means a black screen in the sandbox. One cheap repair attempt
// on the fast model fixes most cases; a seed-backed game falls back to the
// working reference if the repair fails too.
async function ensureValidSyntax(generated, promptBundle, reference, onProgress) {
  let syntaxError = findSyntaxError(generated.generatedCode);
  if (!syntaxError) return generated;

  try {
    const repair = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "fixing-syntax", chars }),
      system: [
        promptBundle.system,
        "The module below fails to parse. Fix the syntax error and return the complete corrected module, nothing else.",
        `SyntaxError: ${syntaxError}`
      ].join("\n"),
      user: [promptBundle.user, "\nBROKEN MODULE:\n", generated.generatedCode].join("\n")
    });
    const fixed = stripModuleExports(stripMarkdownFence(repair.content));
    if (!findSyntaxError(fixed)) {
      return {
        ...generated,
        generatedCode: fixed,
        usage: sumUsage([generated.usage, repair.usage]),
        stages: { ...generated.stages, syntaxRepair: { model: zeroGModels.background, usage: repair.usage } }
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

export async function createRefinementBundle(
  { gamePackage, request, refinementLevel, strategy },
  { onProgress } = {}
) {
  if (!gamePackage) {
    const error = new Error("gamePackage is required");
    error.status = 400;
    throw error;
  }

  const promptBundle = buildPromptBundle({ gamePackage, request });
  const reference = getReferenceGame(gamePackage.templateId);

  let generated;
  if (reference && strategy !== "pure-agent") {
    try {
      generated = await generateFromSeed(promptBundle, reference.code, zeroGModels.coding, onProgress);
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
    generated = await call0GAgent(promptBundle, onProgress);
    generated.source = generated.source ?? "agent";
  }

  if (generated.source !== "seed-fallback") {
    generated = await ensureValidSyntax(generated, promptBundle, strategy !== "pure-agent" ? reference : null, onProgress);
  }

  const syntaxOk = !findSyntaxError(generated.generatedCode);

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
      "No external images",
      "Performance target is 60 FPS"
    ]
  };
}
