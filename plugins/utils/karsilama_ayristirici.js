const { getBuffer } = require('./genel_araclar');

/**
 * Checks if the client's WebSocket is currently open/connected.
 * Prevents "Connection Closed" errors when calling groupMetadata
 * during reconnect windows.
 */
function isClientConnected(client) {
  try {
    // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
    return client?.ws?.readyState === 1;
  } catch {
    return false;
  }
}

/**
 * Safely fetch group metadata — tries live socket first,
 * falls back to store cache, then returns a minimal stub.
 * Never throws "Connection Closed".
 */
async function safeGroupMetadata(client, jid) {
  // 1. Try live socket (only when WS is actually OPEN)
  if (isClientConnected(client)) {
    try {
      return await client.groupMetadata(jid);
    } catch (e) {
      // Non-fatal: connection may have just dropped — fall through to cache
    }
  }

  // 2. Fallback: store cache (fetchGroupMeta from store)
  try {
    const { fetchGroupMeta } = require('../../core/store');
    // fetchGroupMeta returns cached value without hitting network
    const cached = await fetchGroupMeta(client, jid).catch(() => null);
    if (cached && cached.id) return cached;
  } catch { }

  // 3. Minimal stub — prevents template replace from crashing
  return { id: jid, subject: '', desc: '', participants: [] };
}

/**
 * Parse welcome/goodbye message with placeholders
 * @param {string} template - Message template with placeholders
 * @param {Object} messageObject - WhatsApp message object
 * @param {Array} participants - Array of participants (for join/leave events)
 * @returns {Object} - Parsed message with text and media
 */
async function parseWelcomeMessage(template, messageObject, participants = []) {
  if (!template || !messageObject) return null;
  try {
    // ── BAĞLANTI KOPUKKEN ÇÖKME ÖNLEYİCİ ────────────────────────────────────
    // groupMetadata() WebSocket kapalıyken "Connection Closed" fırlatır.
    // safeGroupMetadata: önce canlı socket dener, başarısız olursa cache/stub kullanır.
    const groupMetadata = await safeGroupMetadata(messageObject.client, messageObject.jid);
    const participantCount = groupMetadata.participants.length;
    const participant = participants[0]?.id;
    let participantNumber = "";
    let participantName = "";
    if (participant) {
      participantNumber = participant.split("@")[0];
      participantName = participantNumber;
    }
    let parsedMessage = template
      .replace(/\$mention/g, `@${participantNumber}`)
      .replace(/\$user/g, participantName)
      .replace(/\$group/g, groupMetadata.subject || "Bilinmeyen Grup")
      .replace(/\$desc/g, groupMetadata.desc || "Açıklama yok")
      .replace(/\$count/g, participantCount.toString())
      .replace(/\$date/g, new Date().toLocaleDateString('tr-TR'))
      .replace(/\$time/g, new Date().toLocaleTimeString('tr-TR', { hour12: false }));
    let profilePicBuffer = null;
    let groupPicBuffer = null;
    if (template.includes("$pp") && participant) {
      try {
        const ppUrl = await messageObject.client.profilePictureUrl(
          participant,
          "image"
        );
        if (ppUrl) {
          profilePicBuffer = await getBuffer(ppUrl);
        }
      } catch (error) {
        try {
          const gppUrl = await messageObject.client.profilePictureUrl(
            messageObject.jid,
            "image"
          );
          if (gppUrl) {
            profilePicBuffer = await getBuffer(gppUrl);
          }
        } catch { }
      }
      parsedMessage = parsedMessage.replace(/\$pp/g, "").trim();
    }
    if (template.includes("$gpp")) {
      try {
        const gppUrl = await messageObject.client.profilePictureUrl(
          messageObject.jid,
          "image"
        );
        if (gppUrl) {
          groupPicBuffer = await getBuffer(gppUrl);
        }
      } catch { }
      parsedMessage = parsedMessage.replace(/\$gpp/g, "").trim();
    }
    return {
      text: parsedMessage,
      mentions: participant ? [participant] : [],
      profilePic: profilePicBuffer,
      groupPic: groupPicBuffer,
    };
  } catch (error) {
    // Hata logla ama fırlatma — çağıran taraf null'ı işleyebilir
    if (!error.message?.includes('Connection Closed')) {
      console.error("Hoş geldin mesajı ayrıştırma hatası:", error.message);
    }
    return null;
  }
}
/**
 * Send parsed welcome/goodbye message
 * @param {Object} messageObject - WhatsApp message object
 * @param {Object} parsedMessage - Parsed message object
 */
async function sendWelcomeMessage(messageObject, parsedMessage) {
  if (!parsedMessage) return;
  try {
    if (parsedMessage.profilePic) {
      await messageObject.client.sendMessage(messageObject.jid, {
        image: parsedMessage.profilePic,
        caption: parsedMessage.text || "",
        mentions: parsedMessage.mentions,
      });
      return;
    }
    if (parsedMessage.groupPic) {
      await messageObject.client.sendMessage(messageObject.jid, {
        image: parsedMessage.groupPic,
        caption: parsedMessage.text || "",
        mentions: parsedMessage.mentions,
      });
      return;
    }
    if (parsedMessage.text) {
      await messageObject.client.sendMessage(messageObject.jid, {
        text: parsedMessage.text,
        mentions: parsedMessage.mentions,
      });
    }
  } catch (error) {
    console.error("Hoş geldin mesajı gönderme hatası:", error);
  }
}
module.exports = {
  parseWelcomeMessage,
  sendWelcomeMessage,
};
