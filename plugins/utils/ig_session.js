/**
 * Instagram private API helper.
 * Uses an optional sessionid cookie (env IG_SESSION_ID) to fetch the full
 * authenticated story feed. Without a session, falls back to anonymous
 * web profile lookup (which only exposes basic public data, not stories).
 */
const axios = require("axios");

const IG_APP_ID = "936619743392459";
const UA_WEB =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function buildHeaders({ withSession = false } = {}) {
  const headers = {
    "User-Agent": UA_WEB,
    "X-IG-App-ID": IG_APP_ID,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/",
    "Origin": "https://www.instagram.com",
  };
  if (withSession && process.env.IG_SESSION_ID) {
    const cookies = [`sessionid=${process.env.IG_SESSION_ID}`];
    if (process.env.IG_DS_USER_ID) cookies.push(`ds_user_id=${process.env.IG_DS_USER_ID}`);
    if (process.env.IG_CSRF_TOKEN) {
      cookies.push(`csrftoken=${process.env.IG_CSRF_TOKEN}`);
      headers["X-CSRFToken"] = process.env.IG_CSRF_TOKEN;
    }
    headers["Cookie"] = cookies.join("; ");
  }
  return headers;
}

async function getUserIdByUsername(username) {
  const clean = String(username).trim().replace(/^@/, "");
  try {
    const res = await axios.get(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(clean)}`,
      {
        headers: buildHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    const u = res.data?.data?.user;
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      isPrivate: !!u.is_private,
      fullName: u.full_name,
    };
  } catch (_) {
    return null;
  }
}

function _normalizeIgItem(item) {
  if (!item) return null;
  const isVideo = item.media_type === 2 || (Array.isArray(item.video_versions) && item.video_versions.length);
  if (isVideo && item.video_versions?.length) {
    const best = item.video_versions.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return { url: best.url, isImage: false };
  }
  const candidates = item.image_versions2?.candidates || [];
  if (candidates.length) {
    const best = candidates.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return { url: best.url, isImage: true };
  }
  return null;
}

async function fetchUserStories(username) {
  if (!process.env.IG_SESSION_ID) return null;
  const info = await getUserIdByUsername(username);
  if (!info?.id) return null;

  try {
    const res = await axios.get(
      `https://i.instagram.com/api/v1/feed/user/${info.id}/story/`,
      {
        headers: buildHeaders({ withSession: true }),
        timeout: 20000,
        validateStatus: () => true,
      }
    );
    const items = res.data?.reel?.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    return items.map(_normalizeIgItem).filter(Boolean);
  } catch (_) {
    return null;
  }
}

/**
 * validateSession
 * Verify that the current (or provided) IG cookie still works by calling
 * the authenticated current_user endpoint. Returns { ok, username?, error? }.
 *
 * Accepts optional overrides so the dashboard can test a freshly-pasted
 * cookie BEFORE it's saved to disk.
 */
async function validateSession(overrides = {}) {
  const sessionId = overrides.IG_SESSION_ID || process.env.IG_SESSION_ID;
  if (!sessionId) return { ok: false, error: "sessionid yok" };

  // Build a one-off header set without mutating process.env
  const cookies = [`sessionid=${sessionId}`];
  const dsUid = overrides.IG_DS_USER_ID || process.env.IG_DS_USER_ID;
  const csrf = overrides.IG_CSRF_TOKEN || process.env.IG_CSRF_TOKEN;
  if (dsUid) cookies.push(`ds_user_id=${dsUid}`);
  if (csrf) cookies.push(`csrftoken=${csrf}`);

  const headers = {
    "User-Agent": UA_WEB,
    "X-IG-App-ID": IG_APP_ID,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/",
    "Origin": "https://www.instagram.com",
    "Cookie": cookies.join("; "),
  };
  if (csrf) headers["X-CSRFToken"] = csrf;

  try {
    const res = await axios.get(
      "https://www.instagram.com/api/v1/accounts/current_user/?edit=true",
      {
        headers,
        timeout: 15000,
        // IG bounces unauthenticated/invalid sessions through a login redirect
        // chain. Disable following them so we can detect the bad-cookie case
        // cleanly instead of hitting "Maximum number of redirects exceeded".
        maxRedirects: 0,
        validateStatus: () => true,
      }
    );
    if (res.status === 200 && res.data?.user?.username) {
      return {
        ok: true,
        username: res.data.user.username,
        fullName: res.data.user.full_name || null,
        userId: res.data.user.pk || res.data.user.pk_id || null,
      };
    }
    if (res.status === 301 || res.status === 302) {
      return { ok: false, error: "Çerez geçersiz: Instagram giriş sayfasına yönlendirdi." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Çerez geçersiz veya süresi dolmuş (HTTP " + res.status + ")" };
    }
    if (res.status === 429) {
      return { ok: false, error: "Instagram bu IP'yi geçici olarak kısıtladı (HTTP 429). Birkaç dakika bekle." };
    }
    return { ok: false, error: "Beklenmeyen yanıt (HTTP " + res.status + ")" };
  } catch (e) {
    // axios throws on network errors / DNS / TLS even with validateStatus
    return { ok: false, error: e.message };
  }
}

module.exports = {
  getUserIdByUsername,
  fetchUserStories,
  validateSession,
};
