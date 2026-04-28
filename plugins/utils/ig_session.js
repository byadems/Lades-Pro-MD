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

module.exports = {
  getUserIdByUsername,
  fetchUserStories,
};
