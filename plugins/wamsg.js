const { Module } = require("../main");
const { getString } = require("./utils/lang");
const Lang = getString("group");
const { censorBadWords, isAdmin } = require("./utils");
const { ADMIN_ACCESS, MODE } = require("../config");
Module({
    pattern: "ifade ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan mesaja belirtilen emoji ile ifade bırakır.",
    use: "araçlar",
  },
  async (m, t) => {
    if (!m.reply_message) return await m.sendReply("_💬 Bir mesaja yanıtlayın!_");
    let msg = {
      remoteJid: m.reply_message?.jid,
      id: m.reply_message.id,
    };
    const reactionMessage = {
      react: {
        text: t[1],
        key: msg,
      },
    };

    await m.client.sendMessage(m.jid, reactionMessage);
  }
);
Module({
    pattern: "düzenle ?(.*)",
    fromMe: true,
    desc: "Botun gönderdiği mesajı düzenler.",
    use: "araçlar",
  },
  async (m, t) => {
    if (!m.reply_message) return await m.sendReply("_💬 Düzenlenecek mesajı yanıtlayın!_");
    if (!t[1]) return await m.sendReply("_💬 Yeni metni girin!_");

    if (m.quoted.key.fromMe) {
      const safeText = censorBadWords(t[1]);
      await m.edit(safeText, m.jid, m.quoted.key);
      await m.sendReply("_✅ Mesaj düzenlendi!_");
    } else {
      await m.sendReply("_❌ Sadece kendi mesajlarınızı düzenleyebilirsiniz!_");
    }
  }
);
Module({
    pattern: "msjat ?(.*)",
    fromMe: true,
    desc: "Sohbeti veya mesajı, belirtilen JID adresine (numaraya) doğrudan iletir.",
    use: "araçlar",
  },
  async (m, t) => {
    const query = (t[1] || "").trim();

    if (m.reply_message) {
      const jidMap = (query || m.jid).split(" ").filter((x) => x.includes("@"));
      if (!jidMap.length) {
        return await m.sendReply("_❌ Sorguda geçerli bir Jid bulunamadı, şunu kullanın: `msjat jid1 jid2 ...`_"
        );
      }
      for (const jid of jidMap) {
        await m.forwardMessage(jid, m.quoted, {
          contextInfo: { isForwarded: false },
        });
      }
      return;
    }

    if (!query) {
      return await m.sendReply("_💬 Bir mesajı yanıtlayın veya `.msjat jid mesaj` şeklinde kullanın._");
    }

    const firstSpace = query.indexOf(" ");
    const jid = firstSpace === -1 ? query : query.slice(0, firstSpace).trim();
    const text = firstSpace === -1 ? "" : query.slice(firstSpace + 1).trim();

    if (!jid.includes("@")) {
      return await m.sendReply("_❌ Geçerli bir JID girin. Örnek: `.msjat 120363xxxx@g.us Merhaba`_");
    }

    if (!text) {
      return await m.sendReply("_❌ Gönderilecek mesaj metni eksik!_");
    }

    await m.client.sendMessage(jid, { text });
    return await m.sendReply("_✅ Mesaj gönderildi!_");
  }
);
Module({
    pattern: "msjyönlendir ?(.*)",
    fromMe: true,
    desc: "Sohbeti veya mesajı, belirtilen JID adresine `İletildi` olarak gönderir.",
    use: "araçlar",
  },
  async (m, t) => {
    const query = (t[1] || "").trim();

    if (m.reply_message) {
      const jidMap = (query || m.jid).split(" ").filter((x) => x.includes("@"));
      if (!jidMap.length) {
        return await m.sendReply("_❌ Sorguda geçerli bir Jid bulunamadı, şunu kullanın: `msjyönlendir jid1 jid2 ...`_"
        );
      }
      for (const jid of jidMap) {
        await m.forwardMessage(jid, m.quoted, {
          contextInfo: { isForwarded: true, forwardingScore: 2 },
        });
      }
      return;
    }

    if (!query) {
      return await m.sendReply("_💬 Bir mesajı yanıtlayın veya `.msjyönlendir jid mesaj` şeklinde kullanın._");
    }

    const firstSpace = query.indexOf(" ");
    const jid = firstSpace === -1 ? query : query.slice(0, firstSpace).trim();
    const text = firstSpace === -1 ? "" : query.slice(firstSpace + 1).trim();

    if (!jid.includes("@")) {
      return await m.sendReply("_❌ Geçerli bir JID girin. Örnek: `.msjyönlendir 120363xxxx@g.us Merhaba`_");
    }

    if (!text) {
      return await m.sendReply("_❌ Gönderilecek mesaj metni eksik!_");
    }

    await m.client.sendMessage(jid, { text }, {
      contextInfo: { isForwarded: true, forwardingScore: 2 },
    });
    return await m.sendReply("_✅ Mesaj gönderildi!_");
  }
);
Module({
    pattern: "tekrar ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan komutu tekrar çalıştırmayı dener",
    use: "araçlar",
  },
  async (m, t) => {
    if (!m.reply_message)
      return await m.sendReply("_💬 Bir komut mesajını yanıtlayın_");
    await new Promise(resolve => setTimeout(resolve, 500));
    await m.client.ev.emit("messages.upsert", {
      messages: [m.quoted],
      type: "notify",
    });
  }
);
Module({
    pattern: "vv ?(.*)",
    fromMe: true,
    desc: "Tek görünürlü (view once) mesajları yakalar",
    use: "araçlar",
  },
  async (m, match) => {
    const quoted = m.quoted?.message,
      realQuoted = m.quoted;

    if (!m.reply_message || !quoted) {
      return await m.sendReply("_❌ Tek gösterimlik mesaj değil!_");
    }

    if (match[1] && match[1].includes("@")) m.jid = match[1];

    const viewOnceKey = [
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
    ].find((key) => quoted.hasOwnProperty(key));

    if (viewOnceKey) {
      const realMessage = quoted[viewOnceKey].message;
      const msgType = Object.keys(realMessage)[0];
      if (realMessage[msgType]?.viewOnce) realMessage[msgType].viewOnce = false;
      m.quoted.message = realMessage;
      return await m.forwardMessage(m.jid, m.quoted, {
        contextInfo: { isForwarded: false },
      });
    }

    const directType = quoted.imageMessage
      ? "imageMessage"
      : quoted.audioMessage
        ? "audioMessage"
        : quoted.videoMessage
          ? "videoMessage"
          : null;

    if (directType && quoted[directType]?.viewOnce) {
      quoted[directType].viewOnce = false;
      return await m.forwardMessage(m.jid, m.quoted, {
        contextInfo: { isForwarded: false },
      });
    }

    await m.sendReply("_❌ Tek gösterimlik mesaj değil!_");
  }
);
Module({
    pattern: "msjsil",
    fromMe: true,
    desc: "Mesajı herkesten siler. Yönetici silmesini destekler",
    use: "araçlar",
  },
  async (m, t) => {
    if (!m.reply_message) return await m.sendReply("_💬 Silinecek mesajı yanıtlayın!_");

    let adminAccesValidated = await isAdmin(m);
    if (m.fromOwner || adminAccesValidated) {
      m.jid = m.quoted.key.remoteJid;
      if (m.quoted.key.fromMe) {
        await m.client.sendMessage(m.jid, { delete: m.quoted.key });
        return await m.sendReply("_✅ Mesaj silindi!_");
      }
      if (!m.quoted.key.fromMe) {
        var admin = await isAdmin(m);
        if (!admin) return await m.sendReply(Lang.NEED_ADMIN);
        await m.client.sendMessage(m.jid, { delete: m.quoted.key });
        return await m.sendReply("_✅ Mesaj yönetici yetkisiyle silindi!_");
      }
    } else {
      await m.sendReply(Lang.NEED_ADMIN);
    }
  }
);

