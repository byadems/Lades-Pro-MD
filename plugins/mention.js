const { Module } = require("../main");
const config = require("../config");
const { SUDO } = config;
const { uploadToCatbox } = require("./utils/upload");

const fs = require("fs");
const path = require("path");

const handler = config.HANDLER_PREFIX;

const { setVar, delVar } = require("./manage");

function getMentionReply() {
  try {
    return config.MENTION_REPLY ? JSON.parse(config.MENTION_REPLY) : null;
  } catch (error) {
    console.error("Etiket yanıtı ayrıştırma hatası:", error);
    return null;
  }
}

async function setMentionReply(data) {
  try {
    return await setVar("MENTION_REPLY", JSON.stringify(data));
  } catch (error) {
    console.error("Etiket yanıtı ayarlama hatası:", error);
    return false;
  }
}

async function deleteMentionReply() {
  try {
    return await delVar("MENTION_REPLY");
  } catch (error) {
    console.error("Etiket yanıtı silme hatası:", error);
    return false;
  }
}

function isSudoUser(jid) {
  if (!jid) return false;

  let sudoMap = [];
  if (config.SUDO_MAP) {
    try {
      sudoMap = JSON.parse(config.SUDO_MAP);
      if (!Array.isArray(sudoMap)) sudoMap = [];
    } catch (e) {
      sudoMap = [];
    }
  }

  return sudoMap.includes(jid);
}

Module(
  {
    pattern: "bahsetme ?(.*)",
    fromMe: false,
    desc: "Otomatik etiket yanıt yönetimi",
    use: "tools",
    usage:
      ".bahsetme mesaj (mesajı yanıtlayın) | .bahsetme mesaj <metin> | .bahsetme getir | .bahsetme sil | .bahsetme yardım",
  },
  async (message, match) => {
    const args = match[1]?.trim().split(" ");
    const subcommand = args?.[0]?.toLowerCase();
    const input = args?.slice(1).join(" ");

    if (!subcommand) {
      return await message.sendReply(`Lütfen bir alt komut belirtin!\n\n*Mevcut komutlar:*\n• \`${handler}mention set\` - Etiket yanıtını ayarla (mesajı yanıtla veya metin ekle)\n• \`${handler}mention get\` - Mevcut etiket yanıtını görüntüle\n• \`${handler}mention del\` - Etiket yanıtını sil\n• \`${handler}mention help\` - Ayrıntılı yardımı göster`
      );
    }

    switch (subcommand) {
      case "sil":
        const success = await deleteMentionReply();
        if (success) {
          return await message.sendReply("✅ Bahsetme yanıtı başarıyla silindi!");
        } else {
          return await message.sendReply("🗑️ Bahsetme yanıtı silinemedi!");
        }

      case "getir":
      case "göster":
        const mentionData = getMentionReply();
        if (!mentionData) {
          return await message.sendReply("Bahsetme yanıtı ayarlanmadı!\n\n*Kullanım:*\n• Bir mesajı yanıtlayıp `.bahsetme mesaj` yazın\n• Veya metin mesajı için `.bahsetme mesaj <metin>` kullanın"
          );
        }

        let responseText = "*Mevcut Etiket Yanıtı:*\n\n";
        responseText += `*Tür:* \`${mentionData.type.toUpperCase()}\`\n`;
        if (mentionData.caption) {
          responseText += `*Başlık:* _${mentionData.caption}_\n`;
        }
        if (mentionData.url) {
          responseText += `*Medya URL:* \`${mentionData.url}\`\n`;
        }
        responseText += `*Ayarlandı:* _${new Date(
          mentionData.timestamp
        ).toLocaleString()}_`;

        return await message.sendReply(responseText);

      case "mesaj":
        if (message.reply_message) {
          try {
            const replyMsg = message.reply_message;
            let mentionData = {
              type: "text",
              content: "",
              caption: "",
              url: "",
              timestamp: new Date().toISOString(),
            };

            if (
              replyMsg.image ||
              replyMsg.video ||
              replyMsg.audio ||
              replyMsg.document ||
              replyMsg.sticker
            ) {
              let mediaType = "document";
              if (replyMsg.image) mediaType = "image";
              else if (replyMsg.video) mediaType = "video";
              else if (replyMsg.audio) mediaType = "audio";
              else if (replyMsg.sticker) mediaType = "sticker";

              const downloadedFilePath = await replyMsg.download();

              const uploadResult = await uploadToCatbox(downloadedFilePath);

              fs.unlinkSync(downloadedFilePath);

              if (uploadResult && uploadResult.url) {
                mentionData.type = mediaType;
                mentionData.url = uploadResult.url;
                mentionData.caption = replyMsg.text || "";
              } else {
                return await message.sendReply("⚠️ Medya yüklenemedi! Lütfen tekrar deneyin."
                );
              }
            } else if (replyMsg.text) {
              mentionData.type = "text";
              mentionData.content = replyMsg.text;
            } else {
              return await message.sendReply("💬 Bahsetme yanıtı için desteklenmeyen mesaj türü!"
              );
            }

            const success = await setMentionReply(mentionData);
            if (success) {
              return await message.sendReply(`✅ Bahsetme yanıtı başarıyla ayarlandı!\n\n*Tür:* \`${mentionData.type.toUpperCase()}\`\n*İçerik:* _${mentionData.content || mentionData.caption || "Medya dosyası"
                }_`
              );
            } else {
              return await message.sendReply("⚙️ Bahsetme yanıtı ayarlanamadı!");
            }
          } catch (error) {
            console.error("Etiket yanıtı ayarlama hatası:", error);
            return await message.sendReply("❌ Bahsetme yanıtı ayarlanırken hata oluştu! Lütfen tekrar deneyin."
            );
          }
        }

        if (input && input.trim()) {
          const mentionData = {
            type: "text",
            content: input.trim(),
            caption: "",
            url: "",
            timestamp: new Date().toISOString(),
          };

          const success = await setMentionReply(mentionData);
          if (success) {
            return await message.sendReply(
              `Etiket yanıtı başarıyla ayarlandı!\n\n*İçerik:* _${mentionData.content}_`
            );
          } else {
            return await message.sendReply("⚙️ Bahsetme yanıtı ayarlanamadı!");
          }
        }

        return await message.sendReply(`💬 Lütfen 'mesaj' komutu için içerik sağlayın!\n\n*Kullanım:*\n• Herhangi bir mesajı yanıtlayın ve \`${handler}bahsetme mesaj\` yazın\n• Veya metin mesajı için \`${handler}bahsetme mesaj <metin>\` kullanın`);

      case "yardım":
        const helpText = `🏷️ *Otomatik @Bahsetme (Etiket) Cevaplama Yardımı*

*Nedir?*
Birisi botu veya yöneticileri etiketlediğinde, bot otomatik olarak kaydedilmiş yanıtı gönderir.

*Komutlar:* _(Sadece sahip)_
• \`${handler}bahsetme mesaj\` - Etiket yanıtı olarak ayarlamak için herhangi bir mesajı yanıtlayın
• \`${handler}bahsetme mesaj <text>\` - Metni etiket yanıtı olarak ayarla
• \`${handler}bahsetme getir\` - Mevcut etiket yanıtını görüntüle
• \`${handler}bahsetme sil\` - Etiket yanıtını sil

*Desteklenen Türler:*
• Metin mesajları
• Görseller _(başlıklı)_
• Videolar _(başlıklı)_
• Ses dosyaları
• Çıkartmalar
• Belgeler

*Nasıl çalışır:*
1. Yukarıdaki komutları kullanarak etiket yanıtı ayarlayın
2. Birisi mesajda botu veya yöneticileri etiketlediğinde
3. Bot otomatik olarak kaydedilmiş yanıtı gönderir

*Örnekler:*
• Bir resmi yanıtlayıp şunu yazın \`${handler}bahsetme mesaj\`
• \`${handler}bahsetme mesaj Efendim kanka?\`
• \`${handler}bahsetme getir\` - mevcut yanıtı görmek için
• \`${handler}bahsetme sil\` - yanıtı kaldırmak için

_ℹ️ Not: Medya dosyaları bulut depolama alanına yüklenir._`;

        return await message.sendReply(helpText);

      default:
        return await message.sendReply(`✨ Bilinmeyen alt komut: \`${subcommand}\`\n\n*Mevcut komutlar:*\n• \`${handler}bahsetme mesaj\` - Etiket yanıtını ayarla\n• \`${handler}bahsetme getir\` - Mevcut etiket yanıtını görüntüle\n• \`${handler}bahsetme sil\` - Etiket yanıtını sil\n• \`${handler}bahsetme yardım\` - Yardımı göster`
        );
    }
  }
);

Module(
  {
    on: "text",
    fromMe: false,
  },
  async (message) => {
    try {
      if (
        !message.mention ||
        !Array.isArray(message.mention) ||
        message.mention.length === 0
      ) {
        return;
      }

      const botId = message.client.user?.lid?.split(":")[0] + "@s.whatsapp.net";
      const botNumericId = botId?.split("@")[0];

      let isMentioned = false;

      for (const mentionedJid of message.mention) {
        const mentionedNumericId = mentionedJid?.split("@")[0];

        if (mentionedNumericId === botNumericId || mentionedJid === botId) {
          isMentioned = true;
          break;
        }

        if (isSudoUser(mentionedJid)) {
          isMentioned = true;
          break;
        }
      }

      if (!isMentioned) {
        return;
      }

      const mentionData = getMentionReply();
      if (!mentionData) {
        return;
      }

      switch (mentionData.type) {
        case "text":
          if (mentionData.content) {
            await message.sendReply(mentionData.content);
          }
          break;

        case "image":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "image", {
              caption: mentionData.caption || "",
            });
          }
          break;

        case "video":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "video", {
              caption: mentionData.caption || "",
            });
          }
          break;

        case "audio":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "audio", {
              ptt: true,
              mimetype: "audio/mpeg",
            });
          }
          break;

        case "sticker":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "sticker");
          }
          break;

        case "document":
          if (mentionData.url) {
            await message.sendReply({ url: mentionData.url }, "document", {
              caption: mentionData.caption || "",
            });
          }
          break;
      }
    } catch (error) {
      console.error("Otomatik etiket yanıtında hata:", error);
    }
  }
);
