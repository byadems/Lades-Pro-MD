const { Module } = require("../main");
const { getString } = require("./utils/lang");
const Lang = getString("group");
const config = require("../config");
const { welcome, goodbye, censorBadWords, isAdmin } = require("./utils");
const {
  parseWelcomeMessage,
  sendWelcomeMessage,
} = require("./utils/welcome-parser");

Module({
  pattern: "welcome ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Yeni üye katıldığında gönderilecek olan grup karşılama mesajını özelleştirmenizi ve yönetmenizi sağlar.",
  usage: ".welcome Merhaba $mention, $group grubuna hoş geldin! $pp\n.welcome aç/kapat\n.welcome getir\n.welcome sil", use: "group",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("_⚠️ Bu komut sadece gruplarda kullanılabilir!_");
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply(Lang.NEED_ADMIN);

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
• \`.welcome durum\` - Tüm grupların durumunu göster (sadece sahip)
• \`.welcome yardım\` - Örneklerle ayrıntılı yardımı göster

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

    if (input === "aç") {
      const current = await welcome.get(message.jid);
      if (!current) {
        return await message.sendReply("_⚙️ Karşılama mesajı ayarlanmamış! Önce şunu kullanarak bir tane ayarlayın:_\n*.welcome <mesajınız>*");
      }
      await welcome.toggle(message.jid, true);
      return await message.sendReply("_✅ Karşılama mesajları etkinleştirildi!_ ✅");
    }

    if (input === "kapat") {
      await welcome.toggle(message.jid, false);
      return await message.sendReply("_💬 Karşılama mesajları devre dışı!_ ❌");
    }

    if (input === "getir") {
      const current = await welcome.get(message.jid);
      if (!current) return await message.sendReply("_⚙️ Bu grup için karşılama mesajı ayarlanmamış!_");
      return await message.sendReply(`*Mevcut Karşılama Mesajı:*\n\n${current.message}\n\n*Durum:* ${current.enabled ? "Açık ✅" : "Kapalı ❌"}`);
    }

    if (input === "sil") {
      const deleted = await welcome.delete(message.jid);
      if (deleted) {
        return await message.sendReply("_Karşılama mesajı başarıyla silindi!_ 🗑️");
      }
      return await message.sendReply("_❌ Silinecek karşılama mesajı bulunamadı!_");
    }

    if (input === "durum" && message.fromOwner) {
      const welcomeData = await welcome.get();
      let statusText = "*🎉 KARŞILAMA DURUMU 🎉*\n\n";
      for (let data of welcomeData) {
        statusText += `• *${data.jid}*: ${data.enabled ? "✅" : "❌"}\n`;
      }
      return await message.sendReply(statusText);
    }

    const welcomeMessage = censorBadWords(match[1]);
    if (welcomeMessage.length > 2000) {
      return await message.sendReply("_⚠️ Karşılama mesajı çok uzun! Lütfen 2000 karakterin altında tutun._");
    }

    await welcome.set(message.jid, welcomeMessage);
    await message.sendReply(`_Karşılama mesajı ayarlandı!_ ✅\n\n💡 _İpucu:_ \`.testwelcome\` _kullanın!_`);
  }
);

Module({
  pattern: "goodbye ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Üye ayrıldığında gönderilecek olan grup veda mesajını özelleştirmenizi ve yönetmenizi sağlar.",
  usage: ".goodbye [mesaj] | .goodbye aç/kapat",
  use: "group",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("_⚠️ Bu komut sadece gruplarda kullanılabilir!_");
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply(Lang.NEED_ADMIN);

    const input = match[1]?.toLowerCase();
    if (!input) {
      const current = await goodbye.get(message.jid);
      const status = current?.enabled ? "Açık ✅" : "Kapalı ❌";
      return await message.sendReply(`🥺 *Veda Mesajı Ayarları*\nℹ️ *Mevcut Durum:* ${status}\n\n*Kullanım:* .goodbye <mesaj>, .goodbye aç/kapat, .goodbye sil`);
    }

    if (input === "aç") {
      const current = await goodbye.get(message.jid);
      if (!current) return await message.sendReply("_⚙️ Veda mesajı ayarlanmamış!_");
      await goodbye.toggle(message.jid, true);
      return await message.sendReply("_✅ Veda mesajları açıldı!_");
    }

    if (input === "kapat") {
      await goodbye.toggle(message.jid, false);
      return await message.sendReply("_❌ Veda mesajları kapatıldı!_");
    }

    if (input === "getir") {
      const current = await goodbye.get(message.jid);
      if (!current) return await message.sendReply("_⚙️ Veda mesajı ayarlanmamış!_");
      return await message.sendReply(`*Mevcut Veda Mesajı:*\n\n${current.message}`);
    }

    if (input === "sil") {
      await goodbye.delete(message.jid);
      return await message.sendReply("_Veda mesajı silindi!_ 🗑️");
    }

    const goodbyeMessage = censorBadWords(match[1]);
    await goodbye.set(message.jid, goodbyeMessage);
    await message.sendReply(`_Veda mesajı ayarlandı!_ ✅`);
  }
);

Module({
  pattern: "testwelcome ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Mevcut gruptaki karşılama mesajının nasıl göründüğünü denemeniz için bir test mesajı gönderir.",
  usage: ".testwelcome",
  use: "group",
},
  async (message) => {
    if (!message.isGroup) return await message.sendReply("_⚠️ Bu komut sadece gruplarda kullanılabilir!_");
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply(Lang.NEED_ADMIN);

    const welcomeData = await welcome.get(message.jid);
    if (!welcomeData || !welcomeData.enabled) return await message.sendReply("_❌ Karşılama kapalı veya ayarlanmamış!_");
    const parsed = await parseWelcomeMessage(welcomeData.message, message, [message.sender]);
    if (parsed) {
      await message.sendReply("*💬 Karşılama Test Ediliyor:*");
      await sendWelcomeMessage(message, parsed);
    }
  }
);

Module({
  pattern: "testgoodbye ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Mevcut gruptaki veda mesajının nasıl göründüğünü denemeniz için bir test mesajı gönderir.",
  usage: ".testgoodbye",
  use: "group",
},
  async (message) => {
    if (!message.isGroup) return await message.sendReply("_⚠️ Bu komut sadece gruplarda kullanılabilir!_");
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply(Lang.NEED_ADMIN);

    const goodbyeData = await goodbye.get(message.jid);
    if (!goodbyeData || !goodbyeData.enabled) return await message.sendReply("_❌ Veda kapalı veya ayarlanmamış!_");
    const parsed = await parseWelcomeMessage(goodbyeData.message, message, [message.sender]);
    if (parsed) {
      await message.sendReply("*💬 Veda Test Ediliyor:*");
      await sendWelcomeMessage(message, parsed);
    }
  }
);
