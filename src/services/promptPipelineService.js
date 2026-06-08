import { templates, themePresets } from "../data/templates.js";
import { createGamePackage } from "./gameFactoryService.js";
import { createRefinementBundle } from "./refinementService.js";
import { createOrchestrationPlan, generateImageAsset, runBackgroundTask } from "./zeroGService.js";

const defaultOptions = {
  theme: "neon",
  difficulty: "normal",
  customization: "medium",
  extra: "none"
};

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreTemplate(prompt, template) {
  const promptTokens = new Set(tokenize(prompt));
  const searchable = [
    template.id,
    template.name,
    template.category,
    template.mechanic,
    template.controls,
    template.assets
  ].join(" ");
  const templateTokens = tokenize(searchable);

  return templateTokens.reduce((score, token) => score + (promptTokens.has(token) ? 1 : 0), 0);
}

function localTemplateSelection(prompt) {
  const ranked = templates
    .map(template => ({ template, score: scoreTemplate(prompt, template) }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0]?.template ?? templates[0];

  return {
    templateId: selected.id,
    theme: defaultOptions.theme,
    difficulty: defaultOptions.difficulty,
    customization: defaultOptions.customization,
    extra: defaultOptions.extra,
    reason: ranked[0]?.score > 0 ? "Matched prompt keywords to template metadata." : "Defaulted to strongest starter template."
  };
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeSelection(selection, prompt) {
  const fallback = localTemplateSelection(prompt);
  const templateId = templates.some(template => template.id === selection?.templateId)
    ? selection.templateId
    : fallback.templateId;
  const theme = themePresets[selection?.theme] ? selection.theme : fallback.theme;
  const difficulty = ["easy", "normal", "hard", "insane"].includes(selection?.difficulty)
    ? selection.difficulty
    : fallback.difficulty;
  const customization = ["light", "medium", "heavy"].includes(selection?.customization)
    ? selection.customization
    : fallback.customization;
  const extra = ["none", "powerups", "leaderboard", "boss"].includes(selection?.extra)
    ? selection.extra
    : fallback.extra;

  return {
    templateId,
    theme,
    difficulty,
    customization,
    extra,
    reason: selection?.reason || fallback.reason
  };
}

async function chooseTemplateWithAgent(prompt, context) {
  const templateSummaries = templates.map(template => ({
    id: template.id,
    name: template.name,
    category: template.category,
    mechanic: template.mechanic,
    controls: template.controls,
    assets: template.assets,
    engine: template.engine ?? "threejs"
  }));

  const result = await runBackgroundTask({
    task: "Choose the best game template and configuration. Return only JSON with templateId, theme, difficulty, customization, extra, reason.",
    input: {
      prompt,
      context: context ?? null,
      allowedThemes: Object.keys(themePresets),
      allowedDifficulties: ["easy", "normal", "hard", "insane"],
      allowedCustomization: ["light", "medium", "heavy"],
      allowedExtra: ["none", "powerups", "leaderboard", "boss"],
      templates: templateSummaries
    }
  });

  return {
    agent: result,
    selection: normalizeSelection(extractJsonObject(result.content), prompt)
  };
}

async function generateSpecsWithAgent(prompt, context) {
  const result = await runBackgroundTask({
    task: "Design complete custom browser game specifications from scratch based on the user prompt. Do NOT use templates. Decide the title, category, mechanic, controls, tuning (parameters object), mood, colors (array of hex colors), assets. Return ONLY a JSON object containing: title, category, mechanic, controls, tuning, mood, colors, assets.",
    input: {
      prompt,
      context: context ?? null
    }
  });

  const parsed = extractJsonObject(result.content);
  return {
    agent: result,
    specs: parsed || {
      title: "AI Custom Game",
      category: "Arcade",
      mechanic: "Endless scrolling runner with custom obstacles",
      controls: "Tap or Spacebar to jump",
      tuning: { speed: 5, gravity: 15 },
      mood: "retro future cyberpunk",
      colors: ["#ff0055", "#00ffcc", "#110022"],
      assets: "Runner character, moving laser beams, floating gold pixels"
    }
  };
}

export async function generateGameFromPrompt({
  prompt,
  context,
  theme,
  difficulty,
  customization,
  extra,
  includePlan = true,
  includeCode = true,
  includeAssets = true,
  strategy = "hybrid"
}) {
  const warnings = [];
  let routing = null;
  let selection = null;
  let game = null;

  if (strategy === "pure-agent") {
    try {
      const design = await generateSpecsWithAgent(prompt, context);
      const specs = design.specs;
      
      game = {
        id: Math.random().toString(36).substring(2, 14),
        tier: "prompt-agent",
        title: specs.title || "AI Custom Game",
        templateId: "pure-agent",
        templateName: "Pure AI Agent Game",
        category: specs.category || "Casual",
        createdIn: "15s",
        apiCost: 0.05,
        reliability: "90%",
        customization: {
          prompt,
          theme: specs.mood || "Custom",
          difficulty: difficulty || "normal",
          level: customization || "heavy",
          extra: extra || "none"
        },
        gameplay: {
          mechanic: specs.mechanic || "custom gameplay mechanics",
          controls: specs.controls || "controls",
          tuning: specs.tuning || { speed: 5 },
          states: ["start", "play", "gameover"],
          scoring: "Custom score based on survive duration",
          collision: "Basic rectangle boundary collision"
        },
        visuals: {
          mood: specs.mood || "custom mood",
          colors: specs.colors || ["#ff0055", "#00ffcc"],
          assets: specs.assets || "custom assets",
          externalAssets: false
        },
        build: {
          runtime: "browser",
          renderer: "canvas",
          preview: "playable-canvas",
          targetFps: 60,
          publishReady: true
        },
        publish: {
          ipfsReady: true,
          nftMetadataReady: true,
          marketplaceReady: true
        },
        checklist: [
          "Pure AI Agent specifications generated",
          "Gameplay loops defined by LLM",
          "No template used",
          "Package ready for code generation"
        ]
      };
      
      routing = {
        agent: design.agent,
        selection: {
          templateId: "pure-agent",
          theme: specs.mood || "neon",
          difficulty: difficulty || "normal",
          customization: customization || "heavy",
          extra: extra || "none",
          reason: "Pure Agent design from prompt."
        }
      };
      selection = routing.selection;
    } catch (error) {
      warnings.push(`Pure agent generation failed, falling back to hybrid: ${error.message}`);
      strategy = "hybrid";
    }
  }

  if (strategy !== "pure-agent") {
    selection = normalizeSelection({ theme, difficulty, customization, extra }, prompt);
    try {
      routing = await chooseTemplateWithAgent(prompt, context);
      selection = routing.selection;
    } catch (error) {
      warnings.push(`Background routing fallback: ${error.message}`);
      selection = normalizeSelection({ theme, difficulty, customization, extra }, prompt);
    }

    game = createGamePackage({
      templateId: selection.templateId,
      prompt,
      theme: selection.theme,
      difficulty: selection.difficulty,
      customization: selection.customization,
      extra: selection.extra
    });
  }

  game.tier = includeCode ? "prompt-agent" : "prompt-template";
  game.generation = {
    mode: "prompt-to-game",
    prompt,
    selection,
    routingModel: routing?.agent?.model ?? null
  };

  let plan = null;
  if (includePlan) {
    try {
      plan = await createOrchestrationPlan({
        prompt,
        context: {
          ...(context ?? {}),
          selectedTemplate: selection,
          gamePackage: game
        }
      });
      game.generation.planModel = plan.model;
    } catch (error) {
      warnings.push(`Orchestrator skipped: ${error.message}`);
    }
  }

  let refinement = null;
  let assets = null;
  const codePromise = includeCode
    ? createRefinementBundle({
        gamePackage: game,
        request: prompt,
        refinementLevel: selection.customization
      })
    : null;
  const assetsPromise = includeAssets
    ? generateImageAsset({
        prompt: [
          `${game.title} game thumbnail`,
          game.gameplay?.mechanic,
          game.visuals?.mood,
          "polished colorful game cover art, no text"
        ].filter(Boolean).join(", ")
      })
    : null;

  const [codeResult, assetsResult] = await Promise.allSettled([
    codePromise,
    assetsPromise
  ]);

  if (includeCode) {
    if (codeResult.status === "fulfilled") {
      refinement = codeResult.value;
      game.refinement = refinement;
      game.generation.codeModel = refinement.model;
    } else {
      warnings.push(`Code agent skipped: ${codeResult.reason.message}`);
    }
  }

  if (includeAssets) {
    if (assetsResult.status === "fulfilled") {
      assets = assetsResult.value;
      game.generation.imageModel = assets.model;
      const thumbnail = assets.images?.[0];
      game.thumbnailUrl = thumbnail?.url
        || (thumbnail?.b64_json ? `data:image/png;base64,${thumbnail.b64_json}` : null);
    } else {
      warnings.push(`Image agent skipped: ${assetsResult.reason.message}`);
    }
  }

  return {
    game,
    selection,
    plan,
    refinement,
    assets,
    warnings
  };
}
