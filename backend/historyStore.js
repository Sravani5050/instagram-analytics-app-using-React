// Snapshot history per post, used to build the sparkline trend charts
// on each post card. Port of post_history.py's SQLite tracker, but
// using a plain JSON file so the backend has zero native-build
// dependencies to install.
//
// Keyed by "<accountId>:<postId>" so switching accounts doesn't mix
// histories together.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "history.json");
const MAX_SNAPSHOTS_PER_POST = 30;

const METRIC_FIELDS = ["like_count", "comments_count", "reach", "saved", "shares", "video_views"];

function load() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export function saveSnapshot(accountId, post) {
  const data = load();
  const key = `${accountId}:${post.id}`;
  if (!data[key]) data[key] = [];

  const snapshot = { fetched_at: new Date().toISOString() };
  for (const field of METRIC_FIELDS) snapshot[field] = post[field] ?? 0;
  const likes = snapshot.like_count;
  const comments = snapshot.comments_count;
  snapshot.engagement = likes + comments + snapshot.saved + snapshot.shares;

  data[key].push(snapshot);
  if (data[key].length > MAX_SNAPSHOTS_PER_POST) {
    data[key] = data[key].slice(-MAX_SNAPSHOTS_PER_POST);
  }
  save(data);
}

export function getPostHistory(accountId, postId) {
  const data = load();
  return data[`${accountId}:${postId}`] || [];
}
