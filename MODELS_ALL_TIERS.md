# Model Configuration — All Tiers (Generation & Editing)

All models run on the **0G compute router** (`https://router-api.0g.ai/v1`).
This reflects the **current `.env`** values. No pricing here — model info only.

Tier is chosen by the user in the UI:

| Button | Tier | Strategy |
|--------|------|----------|
| **HYBRID** | 1 | hybrid (template seed + edits) |
| **PRO** | 2 | pure-agent (built from scratch) |
| **ULTRA** | 3 | pure-agent (best models) |

**Role meanings:** `general` = prompt understanding · `orchestrator` = build plan ·
`coding` = writes the game code · `repair` = fixes syntax/runtime errors ·
`background` = lightweight tasks (variations/metadata) · `image` = cover art ·
`asset` = in-game sprites · `vision` = reads reference images · `speech` = voice input.

Overridable via `.env`: `TIER{n}_*_MODEL` (generation), `EDIT_TIER{n}_*_MODEL` (editing).

---

## Prompt enhancement (before generation)

| Setting | Value |
|---------|-------|
| Model (`PROMPT_ENHANCEMENT`) | `gpt-5.6-terra` |
| Output target | ~300 words |

---

## 1) Generation models (`TIER{n}_*`)

| Role | Tier 1 — HYBRID | Tier 2 — PRO | Tier 3 — ULTRA |
|------|-----------------|--------------|----------------|
| **strategy** | hybrid | pure-agent | pure-agent |
| general | `0GM-1.0-35B-A3B` | `MiniMax-M3` | `MiniMax-M3` |
| orchestrator | `glm-5` | `gpt-5.6-terra` | `claude-opus-4-8` |
| coding | `gpt-5.6-terra` | `claude-opus-4-8` | `claude-opus-5` |
| repair | `gpt-5.6-sol` | `gpt-5.6-sol` | `gpt-5.6-terra` |
| background | `deepseek-v4-flash` | `deepseek-v4-flash` | `deepseek-v4-pro` |
| image (cover) | `z-image-turbo` | `z-image-turbo` | `z-image-turbo` |
| asset (sprites) | `z-image-turbo` | `z-image-turbo` | `z-image-turbo` |
| vision | `qwen/qwen3-vl-30b-a3b-instruct` | `qwen3.7-plus` | `kimi-k3` |
| speech | `openai/whisper-large-v3` | `openai/whisper-large-v3` | `openai/whisper-large-v3` |

## 2) Editing models (`EDIT_TIER{n}_*`)

Editing is independent of generation. By design, **Edit Tier 2 and Edit Tier 3
use the same set** (edits are seed-edits, so the mid model is enough).

| Role | Edit Tier 1 | Edit Tier 2 | Edit Tier 3 |
|------|-------------|-------------|-------------|
| **strategy** | hybrid | pure-agent | pure-agent |
| general | `0GM-1.0-35B-A3B` | `MiniMax-M3` | `MiniMax-M3` |
| orchestrator | `glm-5` | `glm-5.2` | `glm-5.2` |
| coding | `gpt-5.6-sol` | `gpt-5.6-terra` | `gpt-5.6-terra` |
| repair* | `glm-5` | `gpt-5.6-terra` | `gpt-5.6-terra` |
| background | `deepseek-v4-flash` | `deepseek-v4-flash` | `deepseek-v4-flash` |
| image | `z-image-turbo` | `z-image-turbo` | `z-image-turbo` |
| asset | `z-image-turbo` | `z-image-turbo` | `z-image-turbo` |
| vision | `qwen/qwen3-vl-30b-a3b-instruct` | `qwen3.7-plus` | `qwen3.7-plus` |
| speech | `openai/whisper-large-v3` | `openai/whisper-large-v3` | `openai/whisper-large-v3` |

\* `EDIT_TIER{n}_REPAIR_MODEL` is not set in `.env`, so editing repair **inherits
the built-in default**: `glm-5` for Edit Tier 1, `gpt-5.6-terra` for Edit Tier 2/3.
Set the env var to override.

---

## Env format — Generation

```env
# ---- Tier 1 — HYBRID ----
TIER1_STRATEGY=hybrid
TIER1_LLM_MODEL=0GM-1.0-35B-A3B
TIER1_ORCHESTRATOR_MODEL=glm-5
TIER1_CODING_MODEL=gpt-5.6-terra
TIER1_REPAIR_MODEL=gpt-5.6-sol
TIER1_BACKGROUND_MODEL=deepseek-v4-flash
TIER1_IMAGE_MODEL=z-image-turbo
TIER1_ASSET_MODEL=z-image-turbo
TIER1_VISION_MODEL=qwen/qwen3-vl-30b-a3b-instruct
TIER1_SPEECH_MODEL=openai/whisper-large-v3

# ---- Tier 2 — PRO ----
TIER2_STRATEGY=pure-agent
TIER2_LLM_MODEL=MiniMax-M3
TIER2_ORCHESTRATOR_MODEL=gpt-5.6-terra
TIER2_CODING_MODEL=claude-opus-4-8
TIER2_REPAIR_MODEL=gpt-5.6-sol
TIER2_BACKGROUND_MODEL=deepseek-v4-flash
TIER2_IMAGE_MODEL=z-image-turbo
TIER2_ASSET_MODEL=z-image-turbo
TIER2_VISION_MODEL=qwen3.7-plus
TIER2_SPEECH_MODEL=openai/whisper-large-v3

# ---- Tier 3 — ULTRA ----
TIER3_STRATEGY=pure-agent
TIER3_LLM_MODEL=MiniMax-M3
TIER3_ORCHESTRATOR_MODEL=claude-opus-4-8
TIER3_CODING_MODEL=claude-opus-5
TIER3_REPAIR_MODEL=gpt-5.6-terra
TIER3_BACKGROUND_MODEL=deepseek-v4-pro
TIER3_IMAGE_MODEL=z-image-turbo
TIER3_ASSET_MODEL=z-image-turbo
TIER3_VISION_MODEL=kimi-k3
TIER3_SPEECH_MODEL=openai/whisper-large-v3
```

## Env format — Editing

```env
# ---- Edit Tier 1 ----
EDIT_TIER1_STRATEGY=hybrid
EDIT_TIER1_LLM_MODEL=0GM-1.0-35B-A3B
EDIT_TIER1_ORCHESTRATOR_MODEL=glm-5
EDIT_TIER1_CODING_MODEL=gpt-5.6-sol
EDIT_TIER1_BACKGROUND_MODEL=deepseek-v4-flash
EDIT_TIER1_IMAGE_MODEL=z-image-turbo
EDIT_TIER1_ASSET_MODEL=z-image-turbo
EDIT_TIER1_VISION_MODEL=qwen/qwen3-vl-30b-a3b-instruct
EDIT_TIER1_SPEECH_MODEL=openai/whisper-large-v3

# ---- Edit Tier 2 ----
EDIT_TIER2_STRATEGY=pure-agent
EDIT_TIER2_LLM_MODEL=MiniMax-M3
EDIT_TIER2_ORCHESTRATOR_MODEL=glm-5.2
EDIT_TIER2_CODING_MODEL=gpt-5.6-terra
EDIT_TIER2_BACKGROUND_MODEL=deepseek-v4-flash
EDIT_TIER2_IMAGE_MODEL=z-image-turbo
EDIT_TIER2_ASSET_MODEL=z-image-turbo
EDIT_TIER2_VISION_MODEL=qwen3.7-plus
EDIT_TIER2_SPEECH_MODEL=openai/whisper-large-v3

# ---- Edit Tier 3 (same set as Edit Tier 2) ----
EDIT_TIER3_STRATEGY=pure-agent
EDIT_TIER3_LLM_MODEL=MiniMax-M3
EDIT_TIER3_ORCHESTRATOR_MODEL=glm-5.2
EDIT_TIER3_CODING_MODEL=gpt-5.6-terra
EDIT_TIER3_BACKGROUND_MODEL=deepseek-v4-flash
EDIT_TIER3_IMAGE_MODEL=z-image-turbo
EDIT_TIER3_ASSET_MODEL=z-image-turbo
EDIT_TIER3_VISION_MODEL=qwen3.7-plus
EDIT_TIER3_SPEECH_MODEL=openai/whisper-large-v3
```

---

## Notes
- `claude-*` models (`claude-opus-5`, `claude-opus-4-8`) run via the **Anthropic
  Messages** format on the router; all others use the OpenAI-compatible format.
- `z-image-turbo` is 0G's only image model — used for **both** covers and sprites.
- `openai/whisper-large-v3` handles **all** voice input.
- Internal/no-tier paths (thumbnails, standalone agent) default to the **Tier 1** set.
