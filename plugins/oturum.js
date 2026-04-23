const { Module } = require("../main");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const config = require("../config");

Module(
  {
    pattern: "oturum",
    fromMe: true,
    desc: "Kesintisiz çalışması için oturum kimliğinizi (SESSION ID) verir.",
    usage: ".oturum",
    use: "sistem",
    dontAddCommandList: true,
  },
  async (message, match) => {
    try {
      const sessionId = config.SESSION_ID || "lades-session";
      const credsFile = path.join(__dirname, "..", "sessions", sessionId, "creds.json");

      if (!fs.existsSync(credsFile)) {
        return await message.sendReply("❌ Geçerli bir `creds.json` bulunamadı. Lütfen botun tam olarak bağlandığından emin olun.");
      }

      await message.sendReply("⏳ Oturum kimliğiniz oluşturuluyor, lütfen bekleyin...");

      // creds.json dosyasını oku
      const credsData = fs.readFileSync(credsFile, "utf-8");

      // JSON formatında olduğundan emin ol (parse & stringify yapıyoruz)
      const credsParsed = JSON.parse(credsData);

      // Diğer botların formatlarıyla uyumluluk ve güvenilirlik için 
      // sadece { creds: {...} } yapısını değil doğrudan creds objesini kullanıyoruz.
      // Sıkıştırıp base64'e çevir
      const compressed = zlib.gzipSync(JSON.stringify(credsParsed));
      const base64Data = compressed.toString("base64");

      const sessionIdStr = `LADES~${base64Data}`;

      const infoText = `*🔐 LADES-PRO OTURUM KİMLİĞİ (SESSION ID)*\n\n` +
        `Aşağıdaki kod, botunuzu Northflank, Heroku, Koyeb gibi platformlarda her yeniden başlattığınızda QR okutmanıza gerek kalmadan çalışmasını sağlar.\n\n` +
        `*Kullanım:* Bu kodu kopyalayın ve panelinizdeki ortam değişkenlerine (Environment Variables) *SESSION* adı ile ekleyin.\n\n` +
        `⚠️ *DİKKAT:* Bu kod, WhatsApp hesabınıza tam erişim sağlar. *ASLA KİMSEYLE PAYLAŞMAYIN!*\n\n` +
        `\`\`\`${sessionIdStr}\`\`\``;

      // Özel mesajdan gönderiyoruz, güvenlik için gruba göndermiyoruz
      await message.client.sendMessage(message.user, { text: infoText });

      if (message.isGroup) {
        await message.sendReply("✅ Oturum kimliğiniz güvenliğiniz için *Özel Mesaj (DM)* üzerinden gönderildi. Lütfen DM kutunuzu kontrol edin.");
      }

    } catch (e) {
      console.error(e);
      await message.sendReply("❌ Oturum kimliği oluşturulurken bir hata meydana geldi.");
    }
  }
);
