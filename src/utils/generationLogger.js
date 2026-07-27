/** Structured timing logs for the prompt-to-game pipeline. */
export function createGenerationLogger(requestId) {
  const startedAt = Date.now();
  let lastStepAt = startedAt;

  const log = (step, data = {}) => {
    const now = Date.now();
    const payload = {
      requestId,
      step,
      msSinceStart: now - startedAt,
      msSinceLastStep: now - lastStepAt,
      ...data,
    };
    console.info(`[generate-from-prompt] ${step}`, payload);
    lastStepAt = now;
    return payload;
  };

  return {
    requestId,
    startedAt,
    log,
    fail(step, error, extra = {}) {
      console.error(`[generate-from-prompt] ${step}`, {
        requestId,
        msSinceStart: Date.now() - startedAt,
        message: error?.message ?? String(error),
        status: error?.status ?? null,
        stack: error?.stack,
        ...extra,
      });
    },
    done(extra = {}) {
      return log("complete", extra);
    },
  };
}
