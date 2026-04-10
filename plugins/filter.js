const { Module } = require("../main");
const { ADMIN_ACCESS, HANDLER_PREFIX } = require("../config");
const { filter, isAdmin } = require("./utils");

const handler = HANDLER_PREFIX;

Module({
  pattern: "filtre ?(.*)",
  fromMe: true,
  desc: "Belirli kelimelere botun otomatik olarak vermesini istediğiniz yanıtları (filtreleri) oluşturur.",
  usage: ".filtre merhaba | Merhaba! | sohbet\n.filtre yardım | Size yardım edebilirim | herkes\n.filtre güle | Güle güle! | grup | tam-eşleşme",
  use: "grup",
},
  async (message, match) => {
    if (match[0].includes("filtreler")) return;
    let adminAccess = await isAdmin(message);
    if (!message.fromOwner && !adminAccess) return;
    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply(`*📝 Filtre Komutları:*\n\n` +
        `• \`${handler}filtre tetikleyici | yanıt\` - Sohbet filtresi oluştur\n` +
        `• \`${handler}filtre tetikleyici | yanıt | herkes\` - Genel filtre oluştur\n` +
        `• \`${handler}filtre tetikleyici | yanıt | grup\` - Sadece grup filtresi\n` +
        `• \`${handler}filtre tetikleyici | yanıt | dm\` - Sadece DM filtresi\n` +
        `• \`${handler}filtre tetikleyici | yanıt | sohbet | exact\` - Sadece tam eşleşme\n` +
        `• \`${handler}filtre tetikleyici | yanıt | sohbet | case\` - Büyük/küçük harf duyarlı\n` +
        `• \`${handler}filtreler\` - Tüm filtreleri listele\n` +
        `• \`${handler}delfilter tetikleyici\` - Filtreyi sil\n` +
        `• \`${handler}togglefilter tetikleyici\` - Filtreyi aç/kapat\n\n` +
        `*Kapsamlar:*\n` +
        `• \`sohbet\` - Sadece mevcut sohbet (varsayılan)\n` +
        `• \`herkes\` - Tüm sohbetler\n` +
        `• \`grup\` - Tüm gruplar\n` +
        `• \`dm\` - Tüm DM'ler\n\n` +
        `*Seçenekler:*\n` +
        `• \`tam-eşleşme\` - Sadece tam kelime eşleşmesi\n` +
        `• \`büyük-küçük\` - Büyük/küçük harf duyarlı eşleşme`
      );
    }

    const parts = input.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      return await message.sendReply("_💬 Format: tetikleyici | yanıt | kapsam(isteğe bağlı) | seçenekler(isteğe bağlı)_"
      );
    }

    const trigger = parts[0];
    const response = parts[1];
    const scope = parts[2] || "chat";
    const options = parts[3] || "";

    if (!trigger || !response) {
      return await message.sendReply("_⚠️ Hem tetikleyici hem de yanıt gereklidir!_"
      );
    }

    if (!["sohbet", "herkes", "grup", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm_"
      );
    }

    const filterOptions = {
      caseSensitive: options.includes("büyük-küçük") || options.includes("case"),
      exactMatch: options.includes("tam-eşleşme") || options.includes("exact"),
    };

    try {
      await filter.set(
        trigger,
        response,
        message.jid,
        scope,
        message.sender,
        filterOptions
      );

      const scopeText =
        scope === "sohbet"
          ? "bu sohbet"
          : scope === "herkes"
            ? "tüm sohbetler"
            : scope === "grup"
              ? "tüm gruplar"
              : "tüm DM'ler";
      const optionsText = [];
      if (filterOptions.exactMatch) optionsText.push("tam eşleşme");
      if (filterOptions.caseSensitive) optionsText.push("büyük/küçük harf duyarlı");
      const optionsStr = optionsText.length
        ? ` (${optionsText.join(", ")})`
        : "";

      await message.sendReply(`✅ *Filtre Oluşturuldu!*\n\n` +
        `*Tetikleyici:* ${trigger}\n` +
        `*Yanıt:* ${response}\n` +
        `*Kapsam:* ${scopeText}${optionsStr}`
      );
    } catch (error) {
      console.error("Filtre oluşturma hatası:", error);
      await message.sendReply("_❌ Filtre oluşturulamadı!_");
    }
  }
);

Module({
  pattern: "filtreler ?(.*)",
  fromMe: false,
  desc: "Sohbet veya genel kapsamda oluşturulmuş olan tüm aktif filtreleri listeler.",
  usage: ".filtreler\n.filtreler herkes\n.filtreler grup",
  use: "grup",
},
  async (message, match) => {
    let adminAccess = await isAdmin(message);
    if (!message.fromOwner && !adminAccess) return;

    const scope = match[1]?.trim().toLowerCase();
    let filters;

    try {
      if (scope && ["herkes", "grup", "dm"].includes(scope)) {
        filters = await filter.getByScope(scope);
      } else {
        filters = await filter.get(message.jid);
      }

      if (!filters || filters.length === 0) {
        return await message.sendReply("_📭 Filtre bulunamadı!_");
      }

      let msg = `*📝 Aktif Filtreler:*\n\n`;

      filters.forEach((f, index) => {
        const scopeEmoji =
          {
            sohbet: "💬",
            herkes: "🌍",
            grup: "👥",
            dm: "📱",
          }[f.scope] || "💬";

        const options = [];
        if (f.exactMatch) options.push("exact");
        if (f.caseSensitive) options.push("case");
        const optionsStr = options.length ? ` [${options.join(", ")}]` : "";

        msg += `${index + 1}. ${scopeEmoji} *${f.trigger}*${optionsStr}\n`;
        msg += `   ↳ _${f.response.substring(0, 50)}${f.response.length > 50 ? "..." : ""
          }_\n`;
        msg += `   _Kapsam: ${f.scope}${f.enabled ? "" : " (devre dışı)"}_\n\n`;
      });

      await message.sendReply(msg);
    } catch (error) {
      console.error("Filtre listeleme hatası:", error);
      await message.sendReply("_❌ Filtreler alınamadı!_");
    }
  }
);

Module({
  pattern: "filtresil ?(.*)",
  fromMe: false,
  desc: "Daha önce oluşturulmuş olan bir filtre tetikleyicisini sistemden kalıcı olarak siler.",
  usage: ".filtresil tetikleyici\n.filtresil tetikleyici herkes",
  use: "grup",
},
  async (message, match) => {
    let adminAccess = await isAdmin(message);
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply("_🗑️ Silinecek filtre tetikleyicisini belirtin!_\n_Kullanım: .filtresil tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "sohbet";

    if (!["sohbet", "herkes", "grup", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm_"
      );
    }

    try {
      const deleted = await filter.delete(trigger, message.jid, scope);

      if (deleted > 0) {
        await message.sendReply(
          `✅ _"${trigger}" filtresi başarıyla silindi!_`
        );
      } else {
        await message.sendReply(`_❌ "${trigger}" filtresi bulunamadı!_`);
      }
    } catch (error) {
      console.error("Filtre silme hatası:", error);
      await message.sendReply("_🗑️ Filtre silinemedi!_");
    }
  }
);

Module({
  pattern: "filtredurum ?(.*)",
  fromMe: false,
  desc: "Belirlediğiniz bir filtreyi geçici olarak devre dışı bırakır veya tekrar aktif eder.",
  usage: ".filtredurum tetikleyici\n.filtredurum tetikleyici herkes",
  use: "grup",
},
  async (message, match) => {
    let adminAccess = await isAdmin(message);
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply("_💬 Değiştirilecek filtre tetikleyicisini belirtin!_\n_Kullanım: .filtredurum tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "sohbet";

    if (!["sohbet", "herkes", "grup", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm_"
      );
    }

    try {
      const currentFilter = await filter.get(message.jid, trigger);
      if (!currentFilter) {
        return await message.sendReply(`❌ _"${trigger}" filtresi bulunamadı!_`);
      }

      const newStatus = !currentFilter.enabled;
      const toggled = await filter.toggle(
        trigger,
        message.jid,
        scope,
        newStatus
      );

      if (toggled) {
        await message.sendReply(
          `✅ _"${trigger}" filtresi ${newStatus ? "açıldı" : "kapatıldı"
          }!_`
        );
      } else {
        await message.sendReply(`❌ _"${trigger}" filtresi değiştirilemedi!_`);
      }
    } catch (error) {
      console.error("Filtre aç/kapa hatası:", error);
      await message.sendReply("_❌ Filtre değiştirilemedi!_");
    }
  }
);

Module({
  pattern: "testfiltre ?(.*)",
  fromMe: false,
  desc: "Yazdığınız bir kelimenin herhangi bir filtreyle eşleşip eşleşmediğini test eder.",
  usage: ".testfiltre [metin]",
  use: "grup",
},
  async (message, match) => {
    let adminAccess = await isAdmin(message);
    if (!message.fromOwner && !adminAccess) return;

    const testText = match[1]?.trim();
    if (!testText) {
      return await message.sendReply("_💬 Filtrelere karşı test edilecek metni girin!_\n_Kullanım: .testfiltre merhaba dünya_"
      );
    }

    try {
      const matchedFilter = await filter.checkMatch(testText, message.jid);

      if (matchedFilter) {
        await message.sendReply(`✅ *Filtre Eşleşmesi Bulundu!*\n\n` +
          `*Tetikleyici:* ${matchedFilter.trigger}\n` +
          `*Yanıt:* ${matchedFilter.response}\n` +
          `*Kapsam:* ${matchedFilter.scope}\n` +
          `*Seçenekler:* ${matchedFilter.exactMatch ? "tam eşleşme " : ""}${matchedFilter.caseSensitive
            ? "büyük/küçük harf duyarlı"
            : "büyük/küçük harf duyarsız"
          }`
        );
      } else {
        await message.sendReply(
          `❌ _"${testText}" hiçbir filtreyi tetiklemez_`
        );
      }
    } catch (error) {
      console.error("Filtre test hatası:", error);
      await message.sendReply("_❌ Filtre test edilemedi!_");
    }
  }
);

Module({
  pattern: "filtreyardım",
  fromMe: false,
  desc: "Filtreleme sistemi ve gelişmiş seçenekleri hakkında detaylı yardım sunar.",
  usage: ".filtreyardım",
  use: "grup",
},
  async (message) => {
    const helpText =
      `*🔧 Filtre Sistemi Yardımı*\n\n` +
      `*Filtreler nedir?*\n` +
      `Filtreler, belirli kelime veya ifadelere otomatik yanıt veren tetikleyicilerdir.\n\n` +
      `*📝 Filtre Oluşturma:*\n` +
      `\`${handler}filtre merhaba | Merhaba! Nasılsın?\`\n` +
      `• Sohbete özel filtre oluşturur\n` +
      `• Birisi "merhaba" yazdığında bot "Merhaba! Nasılsın?" yanıtını verir\n\n` +
      `*🌍 Filtre Kapsamları:*\n` +
      `• \`sohbet\` - Sadece mevcut sohbette çalışır\n` +
      `• \`herkes\` - Tüm sohbetlerde çalışır\n` +
      `• \`grup\` - Sadece tüm gruplarda çalışır\n` +
      `• \`dm\` - Sadece tüm DM'lerde çalışır\n\n` +
      `*⚙️ Filtre Seçenekleri:*\n` +
      `• \`tam-eşleşme\` - Sadece tam kelime eşleşmesi\n` +
      `• \`büyük-küçük\` - Büyük/küçük harf duyarlı eşleşme\n\n` +
      `*📋 Örnekler:*\n` +
      `\`${handler}filtre bot | Buradayım! | sohbet\`\n` +
      `\`${handler}filtre yardım | Yöneticiyle iletişime geçin | herkes\`\n` +
      `\`${handler}filtre Merhaba | Selam! | grup | tam-eşleşme\`\n` +
      `\`${handler}filtre ŞİFRE | Şş! | dm | büyük-küçük\`\n\n` +
      `*🔧 Yönetim:*\n` +
      `• \`${handler}filtreler\` - Tüm filtreleri listele\n` +
      `• \`${handler}filtresil tetikleyici\` - Filtreyi sil\n` +
      `• \`${handler}filtredurum tetikleyici\` - Aç/kapat\n` +
      `• \`${handler}testfiltre metin\` - Eşleşmeyi test et\n\n` +
      `*💡 İpuçları:*\n` +
      `• Her mesaj için filtreler kontrol edilir\n` +
      `• Genel filtreler her yerde çalışır\n` +
      `• Kesin tetikleyiciler için tam eşleşme kullanın\n` +
      `• Şifre/kodlar için büyük/küçük harf duyarlı kullanışlıdır`;

    await message.sendReply(helpText);
  }
);

