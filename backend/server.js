import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { InstagramAPI } from "./instagramApi.js";
import * as accounts from "./accounts.js";
import * as history from "./historyStore.js";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

// Simple request logger -- lets us see in the terminal exactly what's
// being requested and when, which is essential for diagnosing a slow
// or stuck request.
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`→ ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    console.log(`← ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

const PORT = process.env.PORT || 5000;

// --- Build an API client for whichever account is currently active ---
// No hardcoded fallback to .env credentials anymore -- every account,
// including the one that used to auto-load from .env, must be added
// explicitly via "+ Add account" and saved to accounts.json like any
// other. Nothing is pre-selected on first run.
function getActiveApi() {
  const activeName = accounts.getActiveAccountName();
  if (!activeName) return null;
  const creds = accounts.getAccount(activeName);
  if (!creds) return null;
  return new InstagramAPI({
    baseUrl: process.env.GRAPH_API_BASE_URL,
    accessToken: creds.access_token,
    accountId: creds.account_id,
    label: activeName,
  });
}

function requireApi(req, res) {
  const api = getActiveApi();
  if (!api) {
    res.status(400).json({ error: "No account selected. Add or select an account first." });
    return null;
  }
  return api;
}

// --- Accounts ---

// Never sends access_token / app_secret to the frontend -- only names,
// cached profile info (username/picture), and which one is active.
app.get("/api/accounts", (req, res) => {
  const active = accounts.getActiveAccountName();
  const list = accounts.listAccounts().map((name) => {
    const acc = accounts.getAccount(name);
    return { name, username: acc?.username || null, profile_picture_url: acc?.profile_picture_url || null };
  });
  res.json({
    accounts: list,
    active: active || null,
    label: active || null,
  });
});

app.post("/api/accounts", async (req, res) => {
  const { name, access_token, account_id, app_id, app_secret } = req.body || {};
  if (!name || !access_token || !account_id) {
    return res.status(400).json({ error: "name, access_token, and account_id are required" });
  }
  try {
    // Fetch the real username/profile picture once at add-time so the
    // switcher can display them without hitting Meta's API every time
    // the dropdown opens.
    const probeApi = new InstagramAPI({ baseUrl: process.env.GRAPH_API_BASE_URL, accessToken: access_token, accountId: account_id });
    const info = await probeApi.getAccountInfo();
    const profile = info ? { username: info.username, profile_picture_url: info.profile_picture_url } : {};

    accounts.addAccount(name, access_token, account_id, app_id, app_secret, profile);
    res.json({ ok: true, active: name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/accounts/:name", (req, res) => {
  accounts.deleteAccount(req.params.name);
  res.json({ ok: true, active: accounts.getActiveAccountName() });
});

app.post("/api/accounts/active", (req, res) => {
  const { name } = req.body || {};
  if (!name) accounts.clearActiveAccount();
  else accounts.setActiveAccount(name);
  res.json({ ok: true, active: accounts.getActiveAccountName() });
});

// --- Connection test ---

app.get("/api/test-connection", async (req, res) => {
  const api = requireApi(req, res);
  if (!api) return;
  const ok = await api.validateToken();
  res.json({ ok, label: api.label, error: ok ? null : api.lastError });
});

// --- Account overview ---

app.get("/api/account", async (req, res) => {
  const api = requireApi(req, res);
  if (!api) return;
  const info = await api.getAccountInfo();
  if (!info) return res.status(502).json({ error: api.lastError || "Failed to fetch account info" });
  res.json(info);
});

app.get("/api/insights", async (req, res) => {
  const api = requireApi(req, res);
  if (!api) return;
  const { period, since, until } = req.query;

  // Default to the last 30 days instead of a single day -- account-
  // level activity metrics (views, accounts_engaged, etc.) otherwise
  // only reflect the single most recent day, which often looks like 0
  // even when there's been real recent activity.
  const untilTs = until || Math.floor(Date.now() / 1000);
  const sinceTs = since || (untilTs - 30 * 24 * 60 * 60);

  const result = await api.getAccountInsights(period || "day", sinceTs, untilTs);
  if (!result) return res.status(502).json({ error: api.lastError || "Failed to fetch account insights" });
  res.json(result);
});

// Actual day-by-day trend, for charting -- distinct from /api/insights
// above, which returns one aggregated 30-day total per metric.
app.get("/api/insights/daily", async (req, res) => {
  const api = requireApi(req, res);
  if (!api) return;
  const { since, until } = req.query;
  const untilTs = until || Math.floor(Date.now() / 1000);
  const sinceTs = since || (untilTs - 30 * 24 * 60 * 60);

  const result = await api.getAccountInsightsDaily(sinceTs, untilTs);
  if (!result) return res.status(502).json({ error: api.lastError || "Failed to fetch daily insights" });
  res.json(result);
});

// --- Posts ---

app.get("/api/posts", async (req, res) => {
  const api = requireApi(req, res);
  if (!api) return;
  const limitParam = req.query.limit;
  const limit = limitParam === "all" ? null : parseInt(limitParam, 10) || 25;

  const media = await api.getRecentMedia(limit);
  if (!media) return res.status(502).json({ error: api.lastError || "Failed to fetch posts" });

  // Save a snapshot per post and attach its trend history, which is
  // exactly what the frontend's sparkline charts need.
  for (const post of media.data) {
    history.saveSnapshot(api.accountId, post);
    post.history = history.getPostHistory(api.accountId, post.id);
  }

  res.json(media);
});

// --- Business Discovery: public data on other accounts, no auth from them needed ---

app.get("/api/discover", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username query param is required" });
  const api = requireApi(req, res);
  if (!api) return;
  const result = await api.getBusinessDiscovery(username);
  if (!result) return res.status(502).json({ error: api.lastError || "Failed to look up account" });
  res.json(result);
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Instagram Analytics backend running on http://localhost:${PORT}`);
});
