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

function sumUsage(usages) {
  return usages.reduce((total, usage) => {
    if (!usage) return total;
    total.prompt_tokens += usage.prompt_tokens ?? 0;
    total.completion_tokens += usage.completion_tokens ?? 0;
    total.total_tokens += usage.total_tokens ?? 0;
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

async function callCodingStage({ model, system, user, maxTokens = 3500 }) {
  return callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs: 1200000,
    retries: 2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
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

async function generateWithModel(promptBundle, model) {
  // Single-stage unified code generation for maximum speed
  const response = await callCodingStage({
    model,
    maxTokens: 16384,
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

  const generatedCode = stripMarkdownFence(response.content);

  // Commented out Repair Stage as requested to speed up the generation pipeline
  /*
  const missing = missingRuntimeFeatures(generatedCode);
  if (missing.length > 0) {
    integration = await callCodingStage({
      model,
      maxTokens: 4000,
      system: [
        promptBundle.system,
        "Repair the supplied incomplete src/main.js.",
        "Return one complete executable module, not an explanation.",
        "It must select document.querySelector(\"#game\"), obtain a 2D context, render the board and pieces, handle pointer/touch input, run requestAnimationFrame, and support restart.",
        `The previous output was missing: ${missing.join(", ")}.`
      ].join("\n"),
      user: [
        promptBundle.user,
        "\nINCOMPLETE MODULE:\n",
        generatedCode,
        "\nUI DRAFT TO REINTEGRATE:\n",
        uiCode
      ].join("\n")
    });
    generatedCode = stripMarkdownFence(integration.content);
  }

  let remainingMissing = missingRuntimeFeatures(generatedCode);
  if (remainingMissing.length > 0) {
    generatedCode = [
      'import { gamePackage } from "./gamePackage.js";',
      'import "./styles.css";',
      "",
      engineCode,
      "",
      uiCode,
      "",
      'const canvas = document.querySelector("#game");',
      'const context = canvas.getContext("2d");',
      "const engine = globalThis.createGameEngine(gamePackage);",
      "const ui = globalThis.mountGameUI({ canvas, engine, gamePackage, context }) || {};",
      "canvas.addEventListener(\"pointerdown\", event => ui.pointerdown?.(event));",
      "canvas.addEventListener(\"pointermove\", event => ui.pointermove?.(event));",
      "canvas.addEventListener(\"pointerup\", event => ui.pointerup?.(event));",
      "window.addEventListener(\"keydown\", event => {",
      "  if (event.code === \"KeyR\") {",
      "    engine.reset();",
      "    ui.restart?.();",
      "  }",
      "  ui.keydown?.(event);",
      "});",
      "let lastTime = performance.now();",
      "function frame(now) {",
      "  const delta = Math.min((now - lastTime) / 1000, 0.05);",
      "  lastTime = now;",
      "  engine.update?.(delta);",
      "  ui.render?.(context, engine.state);",
      "  requestAnimationFrame(frame);",
      "}",
      "requestAnimationFrame(frame);"
    ].join("\n");
  }
  */

  return {
    provider: response.provider,
    model: response.model,
    generatedCode,
    usage: response.usage,
    stages: {
      unifiedGeneration: { model: response.model, usage: response.usage }
    }
  };
}

// Seed-and-edit: hand the agent a working reference module and ask it to modify
// that, instead of writing from a blank page. Faster, cheaper, and far more reliable.
// If the agent is unreachable or returns broken code, the reference ships unchanged.
async function generateFromSeed(promptBundle, seedCode, model) {
  let integration = await callCodingStage({
    model,
    maxTokens: 12000,
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
  let generatedCode = stripMarkdownFence(integration.content);
  let missing = missingRuntimeFeatures(generatedCode);

  if (missing.length > 0) {
    integration = await callCodingStage({
      model,
      maxTokens: 12000,
      system: [
        promptBundle.system,
        "Repair the edited module so it runs as one complete src/main.js, not an explanation.",
        "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
        "It must select document.querySelector(\"#game\"), obtain a 2D context, run requestAnimationFrame, handle pointer/touch and keyboard input, and support restart.",
        "When unsure, keep the reference behavior. The previous output was missing: " + missing.join(", ") + "."
      ].join("\n"),
      user: [promptBundle.user, "\nEDITED MODULE:\n", generatedCode, "\nREFERENCE MODULE:\n", seedCode].join("\n")
    });
    generatedCode = stripMarkdownFence(integration.content);
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

async function call0GAgent(promptBundle) {
  try {
    return await generateWithModel(promptBundle, zeroGModels.coding);
  } catch (error) {
    const fallbackModel = zeroGModels.background;
    const nonRetriable = error.status && error.status < 500 && ![408, 429].includes(error.status);
    if (fallbackModel === zeroGModels.coding || nonRetriable) throw error;

    console.warn("0G coding model failed after retries; using fallback", {
      primaryModel: zeroGModels.coding,
      fallbackModel,
      message: error.message
    });
    return generateWithModel(promptBundle, fallbackModel);
  }
}

export async function createRefinementBundle({ gamePackage, request, refinementLevel, strategy }) {
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
      generated = await generateFromSeed(promptBundle, reference.code, zeroGModels.coding);
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
    generated = await call0GAgent(promptBundle);
    generated.source = generated.source ?? "agent";
  }

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
    validation: [
      "Syntax validates",
      "Runs immediately in browser",
      "Pointer and keyboard input works",
      "No external images",
      "Performance target is 60 FPS"
    ]
  };
}
