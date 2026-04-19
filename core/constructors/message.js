"use strict";

/**
 * core/constructors/message.js
 * Helper methods attached to message context.
 * Makes plugin writing much simpler.
 */

const { getTempPath, cleanTempFile, getGroupAdmins, loadBaileys } = require("../yardimcilar");
const fs = require("fs");

/**
 * Enrich a message context with helper methods.
 * Used by the handler when invoking plugin.run()
 */
function enrichMessage(ctx, sock) {
  const { jid, senderJid, key, message, groupMetadata, isGroup } = ctx;

  // Standardization: Helper to create the correct 'quoted' object for sendMessage
  const generateQuoted = (targetKey = key, targetMsg = message) => {
    const q = { key: { ...targetKey }, message: targetMsg };
    if (isGroup && !q.key.participant) {
      q.key.participant = senderJid;
    }
    return q;
  };

  return {
    ...ctx,

    // ── Reply helpers ─────────────────────────────────
    reply: async (text, opts = {}) => {
      const q = generateQuoted();
      return sock.sendMessage(jid, { text: String(text) }, { quoted: q, ...opts });
    },

    replyImage: async (buffer, caption = "", opts = {}) => {
      const q = generateQuoted();
      return sock.sendMessage(jid, { image: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), caption }, { quoted: q, ...opts });
    },

    replyVideo: async (buffer, caption = "", opts = {}) => {
      const q = generateQuoted();
      return sock.sendMessage(jid, { video: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), caption }, { quoted: q, ...opts });
    },

    replyAudio: async (buffer, opts = {}) => {
      const q = generateQuoted();
      const isPtt = opts.ptt || false;
      return sock.sendMessage(jid, { 
        audio: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), 
        mimetype: isPtt ? "audio/ogg; codecs=opus" : "audio/mp4",
        ptt: isPtt,
        ...opts 
      }, { quoted: q });
    },

    replySticker: async (buffer, opts = {}) => {
      const q = generateQuoted();
      return sock.sendMessage(jid, { sticker: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), ...opts }, { quoted: q });
    },

    replyDocument: async (buffer, filename, mimetype, opts = {}) => {
      const q = generateQuoted();
      return sock.sendMessage(jid, { document: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), fileName: filename, mimetype }, { quoted: q, ...opts });
    },

    react: async (emoji) =>
      sock.sendMessage(jid, { react: { text: emoji, key } }),

    // ── Group helpers ─────────────────────────────────
    getAdmins: () => groupMetadata ? getGroupAdmins(groupMetadata) : [],
    isUserAdmin: () => {
      if (!groupMetadata) return false;
      return getGroupAdmins(groupMetadata).includes(senderJid);
    },
    isBotAdmin: () => {
      if (!groupMetadata || !sock.user) return false;
      const botJid = sock.user.id.replace(/:.*@/, "@");
      return getGroupAdmins(groupMetadata).includes(botJid);
    },

    // ── Media helpers ─────────────────────────────────
    downloadMedia: async () => {
      if (!ctx.isImage && !ctx.isVideo && !ctx.isAudio && !ctx.isSticker && !ctx.isDocument) return null;
      const { downloadMediaMessage } = await loadBaileys();
      const buffer = await downloadMediaMessage({ key, message }, "buffer", {});
      return buffer;
    },

    downloadQuotedMedia: async () => {
      const quoted = ctx.quoted;
      if (!quoted) return null;
      if (!quoted.isImage && !quoted.isVideo && !quoted.isAudio && !quoted.isSticker && !quoted.isDocument) return null;
      const { downloadMediaMessage } = await loadBaileys();
      const buffer = await downloadMediaMessage(
        { key: quoted.key, message: quoted.message }, "buffer", {}
      );
      return buffer;
    },
  };
}

module.exports = { enrichMessage };
