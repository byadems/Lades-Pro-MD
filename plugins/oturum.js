const { Module } = require("../main");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const config = require("../config");

/**
 * .oturum komutu
 * Aktif oturumu (creds + keys) tam olarak dışa aktarır.
 * 
 * ÖNEMLİ: Hem dosya tabanlı hem DB tabanlı auth state'i destekler.
 * Northflank'ta bot DB üzerinden çalışıyorsa, DB'deki güncel veriyi kullanır.
 * Bu sayede export edilen SESSION string her zaman güncel olur.
 */
Module(
  {
    pattern: "oturum",
    fromMe: true,
    desc: "Kesintisiz çalışması için tam oturum kimliğinizi (SESSION ID) verir. Creds + Signal Keys dahil.",
    usage: ".oturum",
    use: "sistem",
    dontAddCommandList: true,
  },
  async (message, match) => {
    try {
      await message.sendReply("⏳ _Oturum kimliğiniz hazırlanıyor, lütfen bekleyin..._");

      const sessionId = config.SESSION_ID || "lades-session";
      let sessionPayload = null;

      // ── 1. DB'den oku (Northflank / cloud ortamı — en güncel veri) ──────────
      try {
        const { WhatsappOturum } = require("../core/database");
        const { BufferJSON } = await require("../core/yardimcilar").loadBaileys();
        const row = await WhatsappOturum.findByPk(sessionId);

        if (row && row.sessionData) {
          const parsed = typeof row.sessionData === "string"
            ? JSON.parse(row.sessionData)
            : row.sessionData;

          // BufferJSON.revive ile Buffer'ları geri çevir
          const revived = JSON.parse(JSON.stringify(parsed), BufferJSON.revive);

          if (revived.creds && revived.creds.me) {
            sessionPayload = revived; // { creds, keys }
          }
        }
      } catch (dbErr) {
        // DB erişimi yoksa dosyaya bak
      }

      // ── 2. Dosyadan oku (yerel geliştirme / dosya tabanlı auth) ─────────────
      if (!sessionPayload) {
        const sessionPath = path.join(__dirname, "..", "sessions", sessionId);
        const credsFile = path.join(sessionPath, "creds.json");

        if (!fs.existsSync(credsFile)) {
          return await message.sendReply(
            "❌ *Oturum verisi bulunamadı!*\n\n" +
            "_Bot henüz tam olarak bağlanmamış ya da oturum verisi kayıp. " +
            "Botun bağlandığından emin olun ve tekrar deneyin._"
          );
        }

        const { BufferJSON } = await require("../core/yardimcilar").loadBaileys();
        const credsData = JSON.parse(fs.readFileSync(credsFile, "utf-8"));

        // Dosya tabanlı: session key dosyalarını da topla
        const keysData = {};
        try {
          const files = fs.readdirSync(sessionPath);
          for (const file of files) {
            if (file === "creds.json" || !file.endsWith(".json")) continue;
            try {
              const kd = JSON.parse(fs.readFileSync(path.join(sessionPath, file), "utf-8"));
              const baseName = file.replace(".json", "");
              const lastDash = baseName.lastIndexOf("-");
              if (lastDash > 0) {
                const type = baseName.substring(0, lastDash);
                const id   = baseName.substring(lastDash + 1);
                if (type && id) {
                  keysData[type] = keysData[type] || {};
                  keysData[type][id] = kd;
                }
              }
            } catch { }
          }
        } catch { }

        sessionPayload = { creds: credsData, keys: keysData };
      }

      // ── 3. Sıkıştır ve base64'e çevir ───────────────────────────────────────
      const { BufferJSON } = await require("../core/yardimcilar").loadBaileys();
      const jsonStr    = JSON.stringify(sessionPayload, BufferJSON.replacer);
      const compressed = zlib.gzipSync(Buffer.from(jsonStr, "utf-8"));
      const base64Data = compressed.toString("base64");
      const sessionStr = `LADES~${base64Data}`;

      // ── 4. Bağlı hesap bilgisi ──────────────────────────────────────────────
      const phone = sessionPayload.creds?.me?.id?.split(":")[0]
                 || sessionPayload.creds?.me?.phone
                 || "Bilinmiyor";

      const infoText =
        `*🔐 LADES-PRO OTURUM KİMLİĞİ*\n\n` +
        `📱 *Bağlı Numara:* \`${phone}\`\n` +
        `📦 *Veri Boyutu:* \`${Math.round(sessionStr.length / 1024)} KB\`\n\n` +
        `*Kullanım:* Aşağıdaki kodu kopyalayın ve Northflank/Heroku/Koyeb ` +
        `panelinizdeki *Environment Variables* bölümüne \`SESSION\` adıyla ekleyin.\n\n` +
        `⚠️ *DİKKAT:* Bu kod WhatsApp hesabınıza tam erişim sağlar. *KİMSEYLE PAYLAŞMAYIN!*\n\n` +
        `\`\`\`${sessionStr}\`\`\``;

      // Güvenlik: gruplarda gruba değil, bota DM olarak gönder
      await message.client.sendMessage(message.user, { text: infoText });

      if (message.isGroup) {
        await message.sendReply("✅ _Oturum kimliğiniz güvenliğiniz için *Özel Mesaj (DM)* üzerinden gönderildi._");
      }

    } catch (e) {
      console.error("[oturum.js] Hata:", e);
      await message.sendReply("❌ Oturum kimliği oluşturulurken bir hata meydana geldi: `" + e.message + "`");
    }
  }
);
