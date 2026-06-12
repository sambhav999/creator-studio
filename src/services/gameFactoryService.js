import { nanoid } from "nanoid";
import { themePresets } from "../data/templates.js";
import { getTemplate } from "./templateService.js";

export function createGamePackage(input) {
  const template = getTemplate(input.templateId);
  if (!template) {
    const error = new Error(`Unknown template: ${input.templateId}`);
    error.status = 404;
    throw error;
  }

  const theme = themePresets[input.theme] ?? themePresets.neon;
  const difficulty = input.difficulty ?? "normal";
  const tuning = template.difficulty[difficulty] ?? template.difficulty.normal;
  const title = `${theme.label} ${template.name}`;

  return {
    id: nanoid(12),
    tier: "template",
    title,
    templateId: template.id,
    templateName: template.name,
    category: template.category,
    createdIn: `${template.estimatedSeconds}s`,
    apiCost: 0,
    reliability: `${Math.round(template.reliability * 100)}%`,
    customization: {
      prompt: input.prompt ?? "",
      theme: theme.label,
      difficulty,
      level: input.customization ?? "light",
      extra: input.extra ?? "none"
    },
    gameplay: {
      mechanic: template.mechanic,
      controls: template.controls,
      tuning,
      states: template.specs.states,
      scoring: template.specs.scoring,
      collision: template.specs.collision
    },
    visuals: {
      mood: theme.mood,
      colors: theme.colors,
      assets: template.assets,
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
      published: false,
      status: "draft",
      ipfsReady: true,
      nftMetadataReady: true,
      marketplaceReady: true
    },
    checklist: [
      "Template loaded",
      "Difficulty tuning applied",
      "Theme injected",
      "Canvas-only asset plan selected",
      "Package ready for play and publish"
    ]
  };
}
