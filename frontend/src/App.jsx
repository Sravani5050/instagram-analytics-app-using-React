import React, { useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { RefreshCw, Users, ChevronDown, X } from "lucide-react";
import { api } from "./api.js";

// ---- Design tokens, carried over 1:1 from the tkinter app's palette ----
const COLORS = {
  bgApp: "#0f1117",
  bgPanel: "#161821",
  bgCard: "#1b1e29",
  bgTile: "#20232f",
  textPrimary: "#f5f6fa",
  textMuted: "#8b8fa3",
  textFaint: "#5b5f70",
  accentBlue: "#5b8def",
  accentTeal: "#2dd4bf",
  accentPurple: "#a78bfa",
  accentGreen: "#34d399",
  accentOrange: "#fbbf24",
  accentPink: "#f472b6",
  accentRed: "#f87171",
};

const METRICS = [
  { key: "likes", label: "Likes", color: COLORS.accentBlue },
  { key: "comments", label: "Comments", color: COLORS.accentTeal },
  { key: "reach", label: "Reach", color: COLORS.accentPurple },
  { key: "saved", label: "Saved", color: COLORS.accentGreen },
  { key: "shares", label: "Shares", color: COLORS.accentOrange },
  { key: "views", label: "Views", color: COLORS.accentPink },
  { key: "engagement", label: "Engagement", color: COLORS.accentRed },
];

const AUTO_REFRESH_MS = 60000; // keep in sync with backend/.env AUTO_REFRESH_INTERVAL

// ---- Data shaping helpers: backend field names -> UI metric keys ----

function shapePost(raw, index) {
  const metrics = {
    likes: raw.like_count || 0,
    comments: raw.comments_count || 0,
    reach: raw.reach || 0,
    saved: raw.saved || 0,
    shares: raw.shares || 0,
    views: raw.video_views || 0,
  };
  metrics.engagement = metrics.likes + metrics.comments + metrics.saved + metrics.shares;

  let history = (raw.history || []).map((snap) => ({
    likes: snap.like_count || 0,
    comments: snap.comments_count || 0,
    reach: snap.reach || 0,
    saved: snap.saved || 0,
    shares: snap.shares || 0,
    views: snap.video_views || 0,
    engagement: snap.engagement || 0,
  }));
  if (history.length === 0) history = [metrics];
  if (history.length === 1) history = [history[0], history[0]];

  return {
    id: raw.id,
    number: index + 1,
    caption: raw.caption || "(no caption)",
    mediaType: raw.media_type,
    date: raw.timestamp ? raw.timestamp.slice(0, 10) : "",
    permalink: raw.permalink || null,
    metrics,
    history,
  };
}

function shapeInsights(raw) {
  const flat = {};
  for (const metric of raw?.data || []) {
    flat[metric.name] = metric.values?.[0]?.value ?? 0;
  }
  return flat;
}

function shapeDailyInsights(raw) {
  // Merges reach / total_interactions / accounts_engaged (each its own
  // array of {value, end_time}) into one row per date, sorted oldest
  // to newest, for a real day-by-day trend chart.
  const byDate = {};
  for (const metric of raw?.data || []) {
    for (const v of metric.values || []) {
      const date = (v.end_time || "").slice(0, 10);
      if (!date) continue;
      if (!byDate[date]) byDate[date] = { date, reach: 0, total_interactions: 0, accounts_engaged: 0 };
      byDate[date][metric.name] = v.value || 0;
    }
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function pctChange(history, key) {
  const first = history[0][key];
  const last = history[history.length - 1][key];
  if (first === 0) return last === 0 ? 0 : 100;
  return Math.round(((last - first) / first) * 100);
}

// ---- Small presentational pieces ----

function Sparkline({ data, dataKey, color }) {
  const gradId = `grad-${dataKey}-${color.replace("#", "")}`;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5}
              fill={`url(#${gradId})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StatTile({ metric, value, changePct }) {
  const isUp = changePct > 0;
  return (
    <div style={{ background: COLORS.bgTile, borderRadius: 8, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: metric.color, display: "inline-block" }} />
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>{metric.label}</span>
        </div>
        {changePct !== 0 && (
          <span style={{ fontSize: 10, color: isUp ? COLORS.accentGreen : COLORS.accentRed }}>
            {isUp ? "▲" : "▼"} {Math.abs(changePct)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function PostCard({ post }) {
  return (
    <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>Post {post.number} · {post.mediaType}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: COLORS.accentBlue, textDecoration: "none" }}>
              View on Instagram ↗
            </a>
          )}
          <div style={{ fontSize: 11, color: COLORS.textFaint }}>{post.date}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 12, maxHeight: 36, overflow: "hidden" }}>
        {post.caption}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
        {METRICS.map((m) => (
          <Sparkline key={m.key} data={post.history} dataKey={m.key} color={m.color} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {METRICS.map((m) => (
          <StatTile key={m.key} metric={m} value={post.metrics[m.key]} changePct={pctChange(post.history, m.key)} />
        ))}
      </div>
    </div>
  );
}

function AddAccountModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", access_token: "", account_id: "", app_id: "", app_secret: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const trimmed = {
      name: form.name.trim(),
      access_token: form.access_token.trim(),
      account_id: form.account_id.trim(),
      app_id: form.app_id.trim(),
      app_secret: form.app_secret.trim(),
    };
    if (!trimmed.name || !trimmed.access_token || !trimmed.account_id) {
      setError("Name, Access Token, and Account ID are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.addAccount(trimmed);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: COLORS.bgPanel, borderRadius: 12, padding: 24, width: 420, maxWidth: "90vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: COLORS.textPrimary }}>Add / Switch Account</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} color={COLORS.textMuted} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 14, lineHeight: 1.5 }}>
          These credentials are sent straight to your own backend and stored there only — never exposed to the browser again after this.
        </div>
        {[
          ["name", "Account Name (label)", false],
          ["access_token", "Access Token", true],
          ["account_id", "Instagram Account ID", false],
          ["app_id", "App ID (optional)", false],
          ["app_secret", "App Secret (optional)", true],
        ].map(([field, label, secret]) => (
          <div key={field} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11.5, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>{label}</label>
            <input
              type={secret ? "password" : "text"}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{ width: "100%", boxSizing: "border-box", background: COLORS.bgTile, border: "none",
                borderRadius: 6, padding: "8px 10px", color: COLORS.textPrimary, fontSize: 13 }}
            />
          </div>
        ))}
        {error && <div style={{ color: COLORS.accentRed, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ background: COLORS.bgTile, border: "none", borderRadius: 6,
            padding: "8px 14px", color: COLORS.textMuted, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ background: COLORS.accentBlue, border: "none",
            borderRadius: 6, padding: "8px 14px", color: "#0f1117", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            {saving ? "Saving..." : "Save & Switch"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmRemoveModal({ accountName, onCancel, onConfirm }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div style={{ background: COLORS.bgPanel, borderRadius: 12, padding: 24, width: 360, maxWidth: "90vw" }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: 16, color: COLORS.textPrimary }}>Remove account?</h3>
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20, lineHeight: 1.5 }}>
          Do you really want to remove <strong style={{ color: COLORS.textPrimary }}>{accountName}</strong>?
          This only removes it from this app — nothing changes on Instagram itself.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ background: COLORS.bgTile, border: "none", borderRadius: 6,
            padding: "8px 16px", color: COLORS.textMuted, cursor: "pointer", fontSize: 13 }}>No</button>
          <button onClick={onConfirm} style={{ background: COLORS.accentRed, border: "none", borderRadius: 6,
            padding: "8px 16px", color: "#0f1117", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Yes, remove</button>
        </div>
      </div>
    </div>
  );
}

const TABS = ["Account Overview", "Posts Analysis"];

export default function App() {
  const [activeTab, setActiveTab] = useState("Posts Analysis");
  const [accountsList, setAccountsList] = useState([]);
  const [activeLabel, setActiveLabel] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // account name pending removal confirmation

  const [accountInfo, setAccountInfo] = useState(null);
  const [insights, setInsights] = useState({});
  const [dailyInsights, setDailyInsights] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("Loading...");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [, forceTick] = useState(0);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshAccountsList = useCallback(async () => {
    try {
      const res = await api.getAccounts();
      if (!mounted.current) return res;
      setAccountsList(res.accounts);
      setActiveLabel(res.label);
      return res;
    } catch {
      // Backend not reachable -- surfaced by the main data fetch below too.
      return { accounts: [], active: null, label: null };
    }
  }, []);

  const loadAll = useCallback(async (label) => {
    // label is passed explicitly rather than read from state, since
    // state updates from the account switch haven't necessarily
    // committed yet when this runs right after switching.
    if (!label) {
      setAccountInfo(null);
      setInsights({});
      setDailyInsights([]);
      setPosts([]);
      setLoading(false);
      setStatusMsg("No account selected");
      return;
    }
    setStatusMsg("Fetching data...");
    try {
      const [info, ins, dailyIns, postsRes] = await Promise.all([
        api.getAccountInfo(),
        api.getInsights(),
        api.getInsightsDaily().catch(() => null),
        api.getPosts(25),
      ]);
      if (!mounted.current) return;
      setAccountInfo(info);
      setInsights(shapeInsights(ins));
      setDailyInsights(shapeDailyInsights(dailyIns));
      setPosts((postsRes.data || []).map((p, i) => shapePost(p, i)));
      setLastUpdated(new Date());
      setStatusMsg("Ready");
    } catch (err) {
      if (!mounted.current) return;
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let dataInterval;
    (async () => {
      const res = await refreshAccountsList();
      // Only auto-fetch on page load if an account was already active
      // from a previous session (persisted server-side). A fresh setup
      // with nothing selected yet shows the picker instead of silently
      // loading anything.
      await loadAll(res.label);
      dataInterval = setInterval(() => loadAll(res.label), AUTO_REFRESH_MS);
    })();
    const tickInterval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => {
      if (dataInterval) clearInterval(dataInterval);
      clearInterval(tickInterval);
    };
  }, [loadAll, refreshAccountsList]);

  const switchAccount = async (name) => {
    setAccountOpen(false);
    setLoading(true);
    await api.setActiveAccount(name);
    const res = await refreshAccountsList();
    await loadAll(res.label);
  };

  const performRemoveAccount = async (name) => {
    setConfirmRemove(null);
    await api.removeAccount(name);
    const res = await refreshAccountsList();
    await loadAll(res.label);
  };

  const testConnection = async () => {
    setStatusMsg("Testing connection...");
    try {
      const res = await api.testConnection();
      setStatusMsg(res.ok ? `Connected (${res.label})` : `Failed: ${res.error}`);
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`);
    }
  };

  const agoLabel = (() => {
    if (!lastUpdated) return "not yet";
    const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  })();

  const engagementByPost = [...posts].reverse().map((p) => ({ name: p.date, engagement: p.metrics.engagement }));
  const totalEngagement = posts.reduce((sum, p) => sum + p.metrics.engagement, 0);
  const engagementByType = Object.entries(
    posts.reduce((acc, p) => {
      const type = p.mediaType || "UNKNOWN";
      acc[type] = (acc[type] || 0) + p.metrics.engagement;
      return acc;
    }, {})
  )
    .map(([type, engagement]) => ({
      type,
      engagement,
      pct: totalEngagement ? Math.round((engagement / totalEngagement) * 100) : 0,
    }))
    .sort((a, b) => b.engagement - a.engagement);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bgApp, fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.textPrimary }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Instagram Analytics</h1>
            <div style={{ fontSize: 12, color: COLORS.textFaint, marginTop: 4 }}>{statusMsg}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setAccountOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.bgPanel, border: "none",
                  borderRadius: 8, padding: "6px 12px", color: COLORS.textPrimary, fontSize: 13, cursor: "pointer" }}>
                {accountInfo?.profile_picture_url ? (
                  <img src={accountInfo.profile_picture_url} alt=""
                    style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", display: "block" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <Users size={14} color={COLORS.textMuted} />
                )}
                {accountInfo?.username ? `@${accountInfo.username}` : (activeLabel || "Select account")}
                <ChevronDown size={14} color={COLORS.textMuted} />
              </button>
              {accountOpen && (
                <div style={{ position: "absolute", top: "110%", right: 0, background: COLORS.bgPanel, borderRadius: 8,
                  overflow: "hidden", zIndex: 10, minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                  {accountsList.length === 0 && (
                    <div style={{ padding: "9px 14px", fontSize: 12.5, color: COLORS.textFaint }}>No accounts added yet</div>
                  )}
                  {accountsList.map((acc) => (
                    <div key={acc.name} onClick={() => switchAccount(acc.name)}
                      style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex",
                        justifyContent: "space-between", alignItems: "center", gap: 8,
                        background: activeLabel === acc.name ? COLORS.bgTile : "transparent",
                        color: activeLabel === acc.name ? COLORS.textPrimary : COLORS.textMuted }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        {acc.profile_picture_url ? (
                          <img src={acc.profile_picture_url} alt=""
                            style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                            onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        ) : (
                          <Users size={14} color={COLORS.textFaint} style={{ flexShrink: 0 }} />
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {acc.username ? `@${acc.username}` : acc.name}
                        </span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setAccountOpen(false); setConfirmRemove(acc.name); }}
                        style={{ background: "none", border: "none", color: COLORS.textFaint, fontSize: 11,
                          cursor: "pointer", padding: "2px 6px", flexShrink: 0 }}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div onClick={() => { setAccountOpen(false); setShowAddModal(true); }}
                    style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: COLORS.accentBlue,
                      borderTop: `1px solid ${COLORS.bgTile}` }}>
                    + Add account
                  </div>
                </div>
              )}
            </div>

            <button onClick={testConnection}
              style={{ background: COLORS.bgPanel, border: "none", borderRadius: 8, padding: "8px 14px",
                color: COLORS.textMuted, fontSize: 13, cursor: "pointer" }}>
              Test Connection
            </button>

            <button onClick={() => loadAll(activeLabel)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.accentBlue, border: "none",
                borderRadius: 8, padding: "8px 14px", color: "#0f1117", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${COLORS.bgPanel}` }}>
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ background: "none", border: "none", padding: "10px 16px", fontSize: 13.5, cursor: "pointer",
                color: activeTab === tab ? COLORS.textPrimary : COLORS.textFaint,
                borderBottom: activeTab === tab ? `2px solid ${COLORS.accentBlue}` : "2px solid transparent",
                fontWeight: activeTab === tab ? 600 : 400 }}>
              {tab}
            </button>
          ))}
        </div>

        {!activeLabel && !loading ? (
          <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No account selected</div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20 }}>
              Add an Instagram account to see its analytics here.
            </div>
            <button onClick={() => setShowAddModal(true)}
              style={{ background: COLORS.accentBlue, border: "none", borderRadius: 8, padding: "10px 18px",
                color: "#0f1117", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              + Add account
            </button>
          </div>
        ) : loading && posts.length === 0 ? (
          <div style={{ color: COLORS.textMuted, padding: 40, textAlign: "center" }}>Loading...</div>
        ) : (
          <>
            {activeTab === "Account Overview" && accountInfo && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    ["Followers", accountInfo.followers_count, COLORS.accentBlue],
                    ["Following", accountInfo.follows_count, COLORS.accentTeal],
                    ["Media Count", accountInfo.media_count, COLORS.accentPurple],
                    ["Reach (30d)", insights.reach, COLORS.accentGreen],
                    ["Views (30d)", insights.views, COLORS.accentOrange],
                    ["Accounts Engaged (30d)", insights.accounts_engaged, COLORS.accentPink],
                    ["New Followers (30d)", insights.follower_count, COLORS.accentTeal],
                    ["Total Interactions (30d)", insights.total_interactions, COLORS.accentRed],
                    ["Overall Engagement (fetched posts)", totalEngagement, COLORS.accentGreen],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>{label}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color }}>{(value ?? 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>@{accountInfo.username}</div>
                  <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>{accountInfo.biography}</div>
                </div>

                <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>Engagement by channel</div>
                  <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 14 }}>
                    {totalEngagement.toLocaleString()} total across fetched posts, split by content type
                  </div>
                  {engagementByType.map(({ type, engagement, pct }) => (
                    <div key={type} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: COLORS.textMuted }}>{type}</span>
                        <span style={{ color: COLORS.textFaint }}>{engagement.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div style={{ background: COLORS.bgTile, borderRadius: 4, height: 8, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: COLORS.accentPink, borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>Daily reach (last 30 days)</div>
                  <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 14 }}>
                    Account-wide reach per calendar day, straight from Instagram's own daily data.
                    Meta's API doesn't return a comparable day-by-day breakdown for total interactions/engagement
                    (only an aggregated total, shown above) -- reach is the metric it reliably provides per day.
                  </div>
                  {dailyInsights.length === 0 ? (
                    <div style={{ color: COLORS.textFaint, fontSize: 12, padding: "20px 0" }}>No daily data available.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dailyInsights} margin={{ bottom: 60 }}>
                        <CartesianGrid stroke={COLORS.bgTile} vertical={false} />
                        <XAxis dataKey="date" stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={false}
                          angle={-45} textAnchor="end" interval={0} height={70} />
                        <YAxis stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: COLORS.bgTile, border: "none", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="reach" name="Reach" fill={COLORS.accentGreen} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div style={{ background: COLORS.bgCard, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 12 }}>Engagement by post date</div>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={engagementByPost} margin={{ bottom: 60 }}>
                      <CartesianGrid stroke={COLORS.bgTile} vertical={false} />
                      <XAxis dataKey="name" stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={false}
                        angle={-45} textAnchor="end" interval={0} height={70} />
                      <YAxis stroke={COLORS.textFaint} fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: COLORS.bgTile, border: "none", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="engagement" fill={COLORS.accentRed} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === "Posts Analysis" && (
              <div>
                {posts.length === 0 && <div style={{ color: COLORS.textMuted }}>No posts yet.</div>}
                {posts.map((post) => <PostCard key={post.id} post={post} />)}
              </div>
            )}
          </>
        )}

        {/* Status bar */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, padding: "10px 4px",
          borderTop: `1px solid ${COLORS.bgPanel}`, fontSize: 11.5, color: COLORS.textFaint }}>
          <span>{statusMsg}</span>
          <span>Updated {agoLabel}</span>
        </div>
      </div>

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSaved={async () => {
            setShowAddModal(false);
            const res = await refreshAccountsList();
            await loadAll(res.label);
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmRemoveModal
          accountName={confirmRemove}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => performRemoveAccount(confirmRemove)}
        />
      )}
    </div>
  );
}
