# KULT Creator Studio Backend

Express API for the KULT Creator Studio template-first game creation flow.

## Requirements

- Node.js 18 or newer
- npm

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:3001` by default.

## Scripts

- `npm run dev` starts the API with nodemon.
- `npm start` starts the API with Node.

## Environment

```text
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
OPENAI_API_KEY=
LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
MONGODB_URI=mongodb://localhost:27017/kult-creator-studio
REDIS_URL=redis://localhost:6379
IPFS_API_URL=
IPFS_API_KEY=
IPFS_API_SECRET=
WEB3_PROVIDER_URL=
CONTRACT_ADDRESS=
JWT_SECRET=change-this-local-secret
```

## API Routes

- `GET /api/health`
- `GET /api/templates`
- `GET /api/templates/export`
- `POST /api/games`
- `POST /api/games/refine`
- `GET /api/dashboard`

## Notes

If `npm run dev` reports that port `3001` is already in use, find the running process:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Then stop the listed PID or change `PORT` in `.env`.
