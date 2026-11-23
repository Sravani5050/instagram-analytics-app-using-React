// Local storage for multiple saved Instagram account credentials, so
// the app can switch between accounts. Direct port of the Python
// accounts.py. Stored server-side only -- server.js is careful never
// to send access_token/app_secret back to the frontend.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "accounts.json");

function load() {
  if (!fs.existsSync(STORE_PATH)) return { accounts: {}, active: null };
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    data.accounts = data.accounts || {};
    data.active = data.active ?? null;
    return data;
  } catch {
    return { accounts: {}, active: null };
  }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export function addAccount(name, accessToken, accountId, appId = "", appSecret = "", profile = {}) {
  if (!name) throw new Error("Account name is required");
  const data = load();
  data.accounts[name] = {
    access_token: accessToken,
    account_id: accountId,
    app_id: appId,
    app_secret: appSecret,
    // Cached at add-time so the account switcher can show a real
    // username/profile picture without an extra API call every time
    // the dropdown opens.
    username: profile.username || null,
    profile_picture_url: profile.profile_picture_url || null,
  };
  data.active = name;
  save(data);
}

export function deleteAccount(name) {
  const data = load();
  if (data.accounts[name]) {
    delete data.accounts[name];
    if (data.active === name) {
      data.active = Object.keys(data.accounts)[0] || null;
    }
    save(data);
  }
}

export function listAccounts() {
  return Object.keys(load().accounts);
}

export function getAccount(name) {
  return load().accounts[name] || null;
}

export function getActiveAccountName() {
  return load().active;
}

export function setActiveAccount(name) {
  const data = load();
  if (data.accounts[name]) {
    data.active = name;
    save(data);
  }
}

export function clearActiveAccount() {
  const data = load();
  data.active = null;
  save(data);
}
