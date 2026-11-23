// Thin wrapper around the backend REST API. No credentials live here
// or anywhere else in the frontend -- the backend holds the token and
// only ever returns data.

const BASE = import.meta.env.VITE_API_BASE_URL || "";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const api = {
  getAccounts: () => request("/api/accounts"),
  addAccount: (payload) =>
    request("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  removeAccount: (name) => request(`/api/accounts/${encodeURIComponent(name)}`, { method: "DELETE" }),
  setActiveAccount: (name) =>
    request("/api/accounts/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  testConnection: () => request("/api/test-connection"),
  getAccountInfo: () => request("/api/account"),
  getInsights: () => request("/api/insights"),
  getInsightsDaily: () => request("/api/insights/daily"),
  getPosts: (limit = 25) => request(`/api/posts?limit=${limit === null ? "all" : limit}`),
  discover: (username) => request(`/api/discover?username=${encodeURIComponent(username)}`),
};
