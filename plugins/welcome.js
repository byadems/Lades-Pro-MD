const { Module } = require("../main");
const config = require("../config");
const { ADMIN_ACCESS } = config;
const { isAdmin, welcome, goodbye, censorBadWords } = require("./utils");
const {
  parseWelcomeMessage,
  sendWelcomeMessage,
} = require("./utils/welcome-parser");
const handler = config.HANDLER_PREFIX;

Module(
  {
    pattern: "welcome ?(.*)",
    fromMe: false,
    desc: "Grup karşılama mesajını ayarlar. $user, $group vb. etiketler kullanılabilir.",
    usage:
      ".welcome Merhaba $mention, $group grubuna hoş geldin! $pp\n.welcome aç/kapat\n.welcome getir (mevcut mesajı görüntüle)\n.welcome sil (silmek için)",
    use: "group",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const input = match[1]?.toLowerCase();
    if (!input) {
      const current = await welcome.get(message.jid);
      const status = current?.enabled ? "Açık ✅" : "Kapalı ❌";
      return await message.sendReply(`👋🏻 *Karşılama Mesajı Ayarları*
ℹ️ *Mevcut Durum:* ${status}

💬 *Kullanım:*
• \`.welcome <mesaj>\` - Karşılama mesajını ayarla
• \`.welcome aç/kapat\` - Karşılamayı aç/kapat
• \`.welcome getir\` - Mevcut mesajı görüntüle
• \`.welcome sil\` - Karşılama mesajını sil
• \`.welcome status\` - Tüm grupların durumunu göster (sadece sahip)
• \`.welcome help\` - Örneklerle ayrıntılı yardımı göster

*Yer Tutucular:*
• \`$mention\` - Kullanıcıyı etiketle
• \`$user\` - Kullanıcı adı
• \`$group\` - Grup adı
• \`$desc\` - Grup açıklaması
• \`$count\` - Üye sayısı
• \`$pp\` - Kullanıcı profil resmi
• \`$gpp\` - Grup profil resmi
• \`$date\` - Bugünün tarihi
• \`$time\` - Şu anki saat

*Örnek:*
\`.welcome Merhaba $mention! $group grubuna hoş geldin 🎉 $pp\`
\`.welcome Hoş geldin $user! Harika grubumuzda artık $count üyeyiz! $gpp\``);
    }
    if (input === "aç" || input === "on") {
      const current = await welcome.get(message.jid);
      if (!current) {
        return await message.sendReply("_⚙️ Karşılama mesajı ayarlanmamış! Önce şunu kullanarak bir tane ayarlayın:_\n*.welcome <mesajınız>*"
        );
      }
      await welcome.toggle(message.jid, true);
      return await message.sendReply("_✅ Karşılama mesajları etkinleştirildi!_ ✅");
    }
    if (input === "kapat" || input === "off") {
      await welcome.toggle(message.jid, false);
      return await message.sendReply("_💬 Karşılama mesajları devre dışı!_ ❌");
    }
    if (input === "getir" || input === "get") {
      const current = await welcome.get(message.jid);
      if (!current) {
        return await message.sendReply("_⚙️ Bu grup için karşılama mesajı ayarlanmamış!_"
        );
      }
      return await message.sendReply(
        `*Mevcut Karşılama Mesajı:*\n\n${current.message}\n\n*Durum:* ${current.enabled ? "Açık ✅" : "Kapalı ❌"
        }`
      );
    }
    if (input === "sil" || input === "del" || input === "delete") {
      const deleted = await welcome.delete(message.jid);
      if (deleted) {
        return await message.sendReply("_Karşılama mesajı başarıyla silindi!_ 🗑️"
        );
      }
      return await message.sendReply("_❌ Silinecek karşılama mesajı bulunamadı!_");
    }

    if (input === "status") {
      if (!message.fromOwner) return;

      try {
        const welcomeData = await welcome.get();
        const goodbyeData = await goodbye.get();

        if (!welcomeData.length && !goodbyeData.length) {
          return await message.sendReply("_⚙️ Hiçbir grupta karşılama veya veda mesajı ayarlanmamış!_"
          );
        }

        let statusText = "*🎉 KARŞILAMA & VEDA DURUMU 🎉*\n\n";

        if (welcomeData.length > 0) {
          statusText += "*📥 KARŞILAMA MESAJLARI:*\n";
          for (let i = 0; i < welcomeData.length; i++) {
            const data = welcomeData[i];
            try {
              const groupMeta = await message.client.groupMetadata(data.jid);
              const groupName = groupMeta.subject || "Bilinmeyen Grup";
              const status = data.enabled ? "✅ Açık" : "❌ Kapalı";
              statusText += `${i + 1
                }. *${groupName}*\n   Durum: ${status}\n   Önizleme: ${data.message.substring(
                  0,
                  50
                )}${data.message.length > 50 ? "..." : ""}\n\n`;
            } catch {
              statusText += `${i + 1}. *Bilinmeyen Grup*\n   Durum: ${data.enabled ? "✅ Açık" : "❌ Kapalı"
                }\n\n`;
            }
          }
        }

        if (goodbyeData.length > 0) {
          statusText += "*📤 VEDA MESAJLARI:*\n";
          for (let i = 0; i < goodbyeData.length; i++) {
            const data = goodbyeData[i];
            try {
              const groupMeta = await message.client.groupMetadata(data.jid);
              const groupName = groupMeta.subject || "Bilinmeyen Grup";
              const status = data.enabled ? "✅ Açık" : "❌ Kapalı";
              statusText += `${i + 1
                }. *${groupName}*\n   Durum: ${status}\n   Önizleme: ${data.message.substring(
                  0,
                  50
                )}${data.message.length > 50 ? "..." : ""}\n\n`;
            } catch {
              statusText += `${i + 1}. *Bilinmeyen Grup*\n   Durum: ${data.enabled ? "✅ Açık" : "❌ Kapalı"
                }\n\n`;
            }
          }
        }

        await message.sendReply(statusText);
      } catch (error) {
        console.error("Hoş geldin durumu alınamadı:", error);
        await message.sendReply("_❌ Karşılama/veda durumunu alırken hata oluştu!_");
      }
      return;
    }

    if (input === "help") {
      const helpText = `*🎉 KARŞILAMA & VEDA SİSTEMİ YARDIMI 🎉*

*📝 TEMEL KOMUTLAR:*
• \`.welcome <mesaj>\` - Karşılama mesajını ayarla
• \`.goodbye <mesaj>\` - Veda mesajını ayarla
• \`.welcome aç/kapat\` - Karşılamayı aç/kapat
• \`.goodbye aç/kapat\` - Vedayı aç/kapat
• \`.welcome getir\` - Mevcut karşılamayı görüntüle
• \`.goodbye getir\` - Mevcut vedayı görüntüle
• \`.welcome sil\` - Karşılama mesajını sil
• \`.goodbye sil\` - Veda mesajını sil
• \`.welcome status\` - Tüm grupların durumunu göster (sadece sahip)
• \`.welcome help\` - Bu ayrıntılı yardımı göster

*🧪 TEST KOMUTLARI:*
• \`.testwelcome\` - Mevcut karşılama mesajını test et
• \`.testgoodbye\` - Mevcut veda mesajını test et

*📋 KULLANILABİLİR YER TUTUCULAR:*
• \`$mention\` - Kullanıcıyı @etiketler
• \`$user\` - Kullanıcı adı
• \`$group\` - Grup adı
• \`$desc\` - Grup açıklaması
• \`$count\` - Mevcut üye sayısı
• \`$pp\` - Kullanıcı profil resmi (gizlilik durumunda grup resmi kullanılır)
• \`$gpp\` - Grup profil resmi
• \`$date\` - Bugünün tarihi
• \`$time\` - Şu anki saat

*💡 ÖRNEK MESAJLAR:*

*Karşılama Örnekleri:*
\`Merhaba $mention! 👋 $group grubuna hoş geldin! 🎉\`

\`Hoş geldin $user! $pp
Harika topluluğumuzda artık $count üyeyiz! 🚀\`

\`🎊 $mention $group grubuna katıldı!
📖 Açıklama: $desc
👥 Üyeler: $count
📅 Katılma tarihi: $date saat $time $gpp\`

*Veda Örnekleri:*
\`Hoşça kal $mention! 👋 $group grubunun parçası olduğun için teşekkürler! 💔\`

\`$user gruptan ayrıldı 😢 $pp
Artık $count üyeyiz.\`

\`📤 $mention $group grubundan ayrıldı
📅 Ayrılış tarihi: $date saat $time
💭 Seni özleyeceğiz! $gpp\`

*⚠️ NOTLAR:*
• Mesajlar 2000 karakter ile sınırlıdır
• \`$pp\` ve \`$gpp\` alt yazılı resim gönderir
• Kullanıcı profil resmi alınamazsa grup resmi kullanılır
• Çok kelimeli mesajlar için tırnak kullanın
• Mesaj ayarlamak için yönetici yetkisi gereklidir
• Mesajlar hem katılmalar hem de ayrılmalar için çalışır`;

      return await message.sendReply(helpText);
    }
    const welcomeMessage = censorBadWords(match[1]);
    if (welcomeMessage.length > 2000) {
      return await message.sendReply("_⚠️ Karşılama mesajı çok uzun! Lütfen 2000 karakterin altında tutun._"
      );
    }
    await welcome.set(message.jid, welcomeMessage);
    await message.sendReply(
      `_Karşılama mesajı başarıyla ayarlandı!_ ✅\n\n*Önizleme:*\n${welcomeMessage}\n\n💡 _İpucu:_ \`.testwelcome\` _kullanarak mesajınızı test edin!_`
    );
  }
);
Module(
  {
    pattern: "goodbye ?(.*)",
    fromMe: false,
    desc: "Grup çıkış mesajını ayarlar. $user, $group vb. etiketler kullanılabilir.",
    usage:
      ".goodbye Hoşça kal $mention, $group grubunun parçası olduğun için teşekkürler! $pp\n.goodbye aç/kapat\n.goodbye getir (mevcut mesajı görüntüle)\n.goodbye sil (silmek için)",
    use: "group",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const input = match[1]?.toLowerCase();
    if (!input) {
      const current = await goodbye.get(message.jid);
      const status = current?.enabled ? "Açık ✅" : "Kapalı ❌";
      return await message.sendReply(`🥺 *Veda Mesajı Ayarları*

ℹ️ *Mevcut Durum:* ${status}

💬 *Kullanım:*
• \`.goodbye <mesaj>\` - Veda mesajını ayarla
• \`.goodbye aç/kapat\` - Vedayı aç/kapat
• \`.goodbye getir\` - Mevcut mesajı görüntüle
• \`.goodbye sil\` - Veda mesajını sil
*Yer Tutucular:*
• \`$mention\` - Kullanıcıyı etiketle
• \`$user\` - Kullanıcı adı  
• \`$group\` - Grup adı
• \`$desc\` - Grup açıklaması
• \`$count\` - Üye sayısı
• \`$pp\` - Kullanıcı profil resmi
• \`$gpp\` - Grup profil resmi
• \`$date\` - Bugünün tarihi
• \`$time\` - Şu anki saat

*Örnek:*
\`.goodbye Hoşça kal $mention! $group grubunun parçası olduğun için teşekkürler 👋 $pp\`
\`.goodbye $user gruptan ayrıldı. Artık $count üyeyiz. $gpp\``);
    }
    if (input === "aç" || input === "on") {
      const current = await goodbye.get(message.jid);
      if (!current) {
        return await message.sendReply("_⚙️ Veda mesajı ayarlanmamış! Önce şunu kullanarak bir tane ayarlayın:_\n*.goodbye <mesajınız>*"
        );
      }
      await goodbye.toggle(message.jid, true);
      return await message.sendReply("_✅ Veda mesajları açıldı!_ ✅");
    }
    if (input === "kapat" || input === "off") {
      await goodbye.toggle(message.jid, false);
      return await message.sendReply("_❌ Veda mesajları kapatıldı!_ ❌");
    }
    if (input === "getir" || input === "get") {
      const current = await goodbye.get(message.jid);
      if (!current) {
        return await message.sendReply("_⚙️ Bu grup için veda mesajı ayarlanmamış!_"
        );
      }
      return await message.sendReply(
        `*Mevcut Veda Mesajı:*\n\n${current.message}\n\n*Durum:* ${current.enabled ? "Açık ✅" : "Kapalı ❌"
        }`
      );
    }
    if (input === "sil" || input === "del" || input === "delete") {
      const deleted = await goodbye.delete(message.jid);
      if (deleted) {
        return await message.sendReply("_Veda mesajı başarıyla silindi!_ 🗑️"
        );
      }
      return await message.sendReply("_❌ Silinecek veda mesajı bulunamadı!_");
    }
    const goodbyeMessage = censorBadWords(match[1]);
    if (goodbyeMessage.length > 2000) {
      return await message.sendReply("_⚠️ Veda mesajı çok uzun! Lütfen 2000 karakterin altında tutun._"
      );
    }
    await goodbye.set(message.jid, goodbyeMessage);
    await message.sendReply(
      `_Veda mesajı başarıyla ayarlandı!_ ✅\n\n*Önizleme:*\n${goodbyeMessage}\n\n💡 _İpucu:_ \`.testgoodbye\` _kullanarak mesajınızı test edin!_`
    );
  }
);
Module(
  {
    pattern: "testwelcome ?(.*)",
    fromMe: false,
    desc: "Geçerli grup için karşılama mesajını test eder",
    usage: ".testwelcome",
    use: "group",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const welcomeData = await welcome.get(message.jid);
    if (!welcomeData || !welcomeData.enabled) {
      return await message.sendReply("_❌ Bu grupta karşılama mesajı ayarlanmamış veya kapatılmış!_"
      );
    }
    const parsedMessage = await parseWelcomeMessage(
      welcomeData.message,
      message,
      [message.sender]
    );
    if (parsedMessage) {
      await message.sendReply("*💬 Karşılama Mesajı Test Ediliyor:*");
      await sendWelcomeMessage(message, parsedMessage);
    } else {
      await message.sendReply("_❌ Karşılama mesajı işlenirken hata oluştu!_");
    }
  }
);
Module(
  {
    pattern: "testgoodbye ?(.*)",
    fromMe: false,
    desc: "Geçerli grup için veda mesajını test eder",
    usage: ".testgoodbye",
    use: "group",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const goodbyeData = await goodbye.get(message.jid);
    if (!goodbyeData || !goodbyeData.enabled) {
      return await message.sendReply("_❌ Bu grupta veda mesajı ayarlanmamış veya kapatılmış!_"
      );
    }
    const parsedMessage = await parseWelcomeMessage(
      goodbyeData.message,
      message,
      [message.sender]
    );
    if (parsedMessage) {
      await message.sendReply("*💬 Veda Mesajı Test Ediliyor:*");
      await sendWelcomeMessage(message, parsedMessage);
    } else {
      await message.sendReply("_❌ Veda mesajı işlenirken hata oluştu!_");
    }
  }
);
