# Instagram Analytics (React + Node backend)

Full replacement for the Python/tkinter app: same dark dashboard design,
same features, but running as a real web app with the access token
kept server-side.

## Why a backend at all?

A browser can't safely hold your Instagram access token (visible in dev
tools to anyone) and Meta's API blocks direct calls from browser
origins anyway. The `backend/` folder is a small Express server that
holds the token, talks to Meta's Graph API, and only ever sends *data*
to the React frontend — never credentials.

## Setup

### 1. Backend

```
cd backend
npm install
cp .env.example .env
```

Edit `.env` and fill in the same values you used in the Python app's
`.env`: `META_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`, etc.

```
npm start
```

Runs on http://localhost:5000 by default.

### 2. Frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

Runs on http://localhost:5173 and automatically proxies `/api/*`
requests to the backend (see `vite.config.js`) — no extra config
needed for local use.

Open http://localhost:5173 in your browser.

## Adding more accounts

Use the account switcher (top right) → "+ Add account". Credentials
you enter there go straight to the backend and are stored in
`backend/accounts.json` (gitignored) — never sent back to the browser
again after that point.

## Notes

- `backend/accounts.json` and `backend/history.json` are created
  automatically on first use and hold your saved accounts / post
  history snapshots. Don't commit them or share them — same
  sensitivity as the old `.env` file.
- Auto-refresh polls every 60 seconds (`AUTO_REFRESH_INTERVAL` in
  backend `.env`, and `AUTO_REFRESH_MS` in `frontend/src/App.jsx` —
  keep both in sync if you change it). Going much faster risks hitting
  Instagram's API rate limits.
- "Look up a public account" (Insights tab) uses Meta's Business
  Discovery endpoint — public data only (follower count, media count,
  public post likes/comments) for *other* Business/Creator accounts.
  Private insights (reach, saves, shares, views) are only ever
  available for the account that owns the token — there's no way
  around that, by design on Meta's end.

## Deploying for real use (beyond your own machine)

This setup is for running locally. To deploy:
- Host `backend/` somewhere that can keep `.env` / `accounts.json`
  secret (a small VPS, Render, Railway, etc.).
- Host `frontend/` as a static build (`npm run build` → serve the
  `dist/` folder) and set `VITE_API_BASE_URL` to your backend's public
  URL, or put both behind the same reverse proxy.
- Update `CORS_ORIGIN` in the backend `.env` to your deployed
  frontend's real origin.
