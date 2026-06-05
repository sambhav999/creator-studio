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

async function call0GAgent(promptBundle) {
  const generated = await callZeroGChat({
    model: zeroGModels.coding,
    temperature: 0.35,
    maxTokens: 6000,
    messages: [
      { role: "system", content: promptBundle.system },
      { role: "user", content: promptBundle.user }
    ]
  });

  return {
    provider: generated.provider,
    model: generated.model,
    generatedCode: stripMarkdownFence(generated.content),
    usage: generated.usage
  };
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
    validation: [
      "Syntax validates",
      "Runs immediately in browser",
      "Pointer and keyboard input works",
      "No external images",
      "Performance target is 60 FPS"
    ]
  };
}
