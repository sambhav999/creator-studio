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
  const [engine, ui] = await Promise.all([
    callCodingStage({
      model,
      system: [
        "You are implementing the game-state and rules layer for a browser game.",
        "Return only JavaScript source without markdown fences.",
        "Do not access the DOM or Canvas.",
        "Expose the engine as globalThis.createGameEngine = function createGameEngine(config) { ... }.",
        "The returned engine must provide state, reset(), select(), move(), legalMoves(), update(), and status().",
        "For chess, implement legal movement, turns, captures, check, checkmate, stalemate, castling, en passant, and promotion."
      ].join("\n"),
      user: promptBundle.user
    }),
    callCodingStage({
      model,
      system: [
        "You are implementing the Canvas renderer and input layer for a browser game.",
        "Return only JavaScript source without markdown fences.",
        "Assume globalThis.createGameEngine(config) already exists.",
        "Expose globalThis.mountGameUI = function mountGameUI({ canvas, engine, gamePackage }) { ... }.",
        "Implement responsive Canvas rendering, pointer/touch and keyboard input, status display, restart, move history, and legal-move highlights.",
        "Do not import libraries or create another game engine."
      ].join("\n"),
      user: promptBundle.user
    })
  ]);

  const engineCode = stripMarkdownFence(engine.content);
  const uiCode = stripMarkdownFence(ui.content);
  let integration = await callCodingStage({
    model,
    maxTokens: 4000,
    system: [
      promptBundle.system,
      "Integrate the supplied engine and UI drafts into one complete src/main.js module.",
      "Preserve their capabilities, repair interface mismatches, and remove duplicate declarations.",
      "Return only the final executable JavaScript module without markdown fences."
    ].join("\n"),
    user: [
      promptBundle.user,
      "\nENGINE DRAFT:\n",
      engineCode,
      "\nUI DRAFT:\n",
      uiCode
    ].join("\n")
  });
  let generatedCode = stripMarkdownFence(integration.content);
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
    remainingMissing = missingRuntimeFeatures(generatedCode);
  }

  if (remainingMissing.length > 0) {
    const error = new Error(`0G generated incomplete game runtime: ${remainingMissing.join(", ")}`);
    error.status = 502;
    throw error;
  }

  return {
    provider: integration.provider,
    model: integration.model,
    generatedCode,
    usage: sumUsage([engine.usage, ui.usage, integration.usage]),
    stages: {
      engine: { model: engine.model, usage: engine.usage },
      ui: { model: ui.model, usage: ui.usage },
      integration: { model: integration.model, usage: integration.usage }
    }
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

export async function createRefinementBundle({ gamePackage, request, refinementLevel }) {
  if (!gamePackage) {
    const error = new Error("gamePackage is required");
    error.status = 400;
    throw error;
  }

  const promptBundle = buildPromptBundle({ gamePackage, request });
  const generated = await call0GAgent(promptBundle);

  return {
    jobId: `refine_${Date.now().toString(36)}`,
    eta: "complete",
    costProfile: "0g-router-call",
    refinementLevel: refinementLevel ?? "medium",
    promptBundle,
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
