import { app } from "./app.js";

const port = process.env.PORT || 3001;

const server = app.listen(port, () => {
  console.log(`KULT Creator Studio API running on http://localhost:${port}`);
});

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
