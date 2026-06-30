import { app } from "./app.js";
import { syncCreatorKpToBrowserBalances } from "./services/pointsService.js";

const port = process.env.PORT || 3001;

const server = app.listen(port, () => {
  console.log(`KULT Creator Studio API running on http://localhost:${port}`);
});

// Node defaults requestTimeout to 5 minutes, which killed long synchronous
// generation requests. Long work now runs through the async job store, but
// keep the server from aborting any remaining slow request.
server.requestTimeout = 0;
server.headersTimeout = 120000;
server.keepAliveTimeout = 75000;

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(
      [
        `Port ${port} is already in use.`,
        `Find the existing process with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        "Then stop the listed PID, or change PORT in backend/.env and update the frontend API/proxy port to match."
      ].join("\n")
    );
    process.exit(1);
  }

  throw error;
});

if (process.env.DISABLE_BROWSER_KP_STARTUP_SYNC !== "true") {
  setTimeout(() => {
    syncCreatorKpToBrowserBalances()
      .then(result => {
        if (result.processed > 0) {
          console.log("KULT Browser KP sync complete", result);
        }
      })
      .catch(error => {
        console.error("KULT Browser KP sync failed", error);
      });
  }, 1000);
}
