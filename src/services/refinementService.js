export function createRefinementBundle({ gamePackage, request, refinementLevel }) {
  if (!gamePackage) {
    const error = new Error("gamePackage is required");
    error.status = 400;
    throw error;
  }

  return {
    jobId: `refine_${Date.now().toString(36)}`,
    eta: "2-3 minutes",
    costProfile: "paid-llm-call",
    refinementLevel: refinementLevel ?? "medium",
    promptBundle: {
      system: [
        "You are an expert Phaser 3 game developer.",
        "Generate a fully playable browser game.",
        "Output only executable JavaScript.",
        "Do not use external image CDN assets.",
        "Maintain 60 FPS and mobile plus desktop input."
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
        `Creator request: ${request}`,
        "Return complete JavaScript game code with BOOT, PLAY, and GAMEOVER states where appropriate."
      ].join("\n")
    },
    validation: [
      "Syntax validates",
      "Runs immediately in browser",
      "Pointer and keyboard input works",
      "No external images",
      "Performance target is 60 FPS"
    ]
  };
}
