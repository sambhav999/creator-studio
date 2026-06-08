const DEFAULT_0G_BASE_URL = "https://router-api.0g.ai/v1";

export const zeroGModels = {
  get general() {
    return process.env.LLM_MODEL || "0GM-1.0-35B-A3B";
  },
  get orchestrator() {
    return process.env.ZERO_G_ORCHESTRATOR_MODEL || "glm-5.1";
  },
  get coding() {
    return process.env.ZERO_G_CODING_MODEL || "deepseek-v4-pro";
  },
  get background() {
    return process.env.ZERO_G_BACKGROUND_MODEL || "deepseek-v4-flash";
  },
  get image() {
    return process.env.ZERO_G_IMAGE_MODEL || "z-image";
  },
  get vision() {
    return process.env.ZERO_G_VISION_MODEL || "qwen/qwen3-vl-30b-a3b-instruct";
  },
  get speech() {
    return process.env.ZERO_G_SPEECH_MODEL || "openai/whisper-large-v3";
  }
};

export function getZeroGConfig() {
  return {
    provider: process.env.LLM_PROVIDER || "0g",
    baseUrl: process.env["0G_BASE_URL"] || DEFAULT_0G_BASE_URL,
    hasApiKey: Boolean(process.env["0G_API_KEY"]),
    models: zeroGModels
  };
}

function getClientConfig() {
  const apiKey = process.env["0G_API_KEY"];
  if (!apiKey) {
    const error = new Error("0G_API_KEY is required for 0G agent calls");
    error.status = 503;
    throw error;
  }

  return {
    apiKey,
    baseUrl: (process.env["0G_BASE_URL"] || DEFAULT_0G_BASE_URL).replace(/\/$/, "")
  };
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};

  if (!response.ok) {
    const error = new Error(data?.error?.message || `0G API request failed with status ${response.status}`);
    error.status = response.status;
    error.details = data?.error ?? null;
    throw error;
  }

  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetriableError(error) {
  return !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
}

function errorCauseDetails(error) {
  const cause = error?.cause;
  if (!cause) return null;

  return {
    name: cause.name,
    message: cause.message,
    code: cause.code,
    errno: cause.errno,
    syscall: cause.syscall,
    hostname: cause.hostname
  };
}

export async function callZeroGChat({
  model,
  messages,
  temperature = 0.3,
  maxTokens = 2000,
  timeoutMs = 120000,
  retries = 2,
  retryBaseDelayMs = 1000
}) {
  const { apiKey, baseUrl } = getClientConfig();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens
        })
      });

      const data = await parseJsonResponse(response);
      const content = data?.choices?.[0]?.message?.content;

      if (!content) {
        const error = new Error("0G API returned no message content");
        error.status = 502;
        throw error;
      }

      return {
        provider: "0g",
        model,
        content,
        usage: data.usage ?? null
      };
    } catch (originalError) {
      let error = originalError;
      if (error.name === "AbortError") {
        error = new Error("0G API request timed out", { cause: originalError });
        error.status = 504;
      } else if (error instanceof SyntaxError) {
        error = new Error("0G API returned an unreadable response", { cause: originalError });
        error.status = 502;
      }

      console.error("0G chat request failed", {
        model,
        attempt: attempt + 1,
        maxAttempts: retries + 1,
        status: error.status ?? null,
        message: error.message,
        cause: errorCauseDetails(error)
      });

      if (attempt >= retries || !isRetriableError(error)) throw error;
      await sleep(retryBaseDelayMs * (2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function createOrchestrationPlan({ prompt, context }) {
  return callZeroGChat({
    model: zeroGModels.orchestrator,
    temperature: 0.25,
    maxTokens: 1800,
    messages: [
      {
        role: "system",
        content: [
          "You are the main orchestrator for a game creation backend.",
          "Turn user intent into a concise build plan.",
          "Route tasks to coding, image, vision, speech, or background agents when useful.",
          "Return practical JSON-like sections: intent, templateFit, steps, agents, risks."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ prompt, context: context ?? null }, null, 2)
      }
    ]
  });
}

export async function runBackgroundTask({ task, input }) {
  return callZeroGChat({
    model: zeroGModels.background || zeroGModels.general,
    temperature: 0.2,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "You handle cheap background work for a game creation platform.",
          "Use short, structured output.",
          "Good tasks: metadata, tags, summaries, validation, naming, categorization."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ task, input }, null, 2)
      }
    ]
  });
}

export async function generateImageAsset({ prompt, size = "1024x1024", n = 1 }) {
  const { apiKey, baseUrl } = getClientConfig();

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: zeroGModels.image,
      prompt,
      size,
      n
    })
  });

  const data = await parseJsonResponse(response);
  return {
    provider: "0g",
    model: zeroGModels.image,
    images: data.data ?? [],
    usage: data.usage ?? null
  };
}

export async function analyzeReferenceImage({ prompt, imageUrl, imageBase64, mimeType = "image/png" }) {
  const imagePayload = imageUrl || `data:${mimeType};base64,${imageBase64}`;

  return callZeroGChat({
    model: zeroGModels.vision,
    temperature: 0.2,
    maxTokens: 1600,
    messages: [
      {
        role: "system",
        content: [
          "You analyze visual references for a game creation platform.",
          "Extract art direction, UI style, color palette, asset ideas, and implementation notes."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt || "Analyze this reference for a game build." },
          { type: "image_url", image_url: { url: imagePayload } }
        ]
      }
    ]
  });
}

function base64ToBlob(base64, mimeType) {
  const buffer = Buffer.from(base64, "base64");
  return new Blob([buffer], { type: mimeType });
}

export async function transcribeAudio({ audioBase64, mimeType = "audio/webm", language }) {
  const { apiKey, baseUrl } = getClientConfig();
  const formData = new FormData();
  formData.set("model", zeroGModels.speech);
  formData.set("file", base64ToBlob(audioBase64, mimeType), "voice-input.webm");
  if (language) formData.set("language", language);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: formData
  });

  const data = await parseJsonResponse(response);
  return {
    provider: "0g",
    model: zeroGModels.speech,
    text: data.text ?? "",
    raw: data
  };
}
