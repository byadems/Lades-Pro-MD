const { Module } = require("../main");
const { ADMIN_ACCESS, HANDLER_PREFIX } = require("../config");
const { isAdmin, filter } = require("./utils");

const handler = HANDLER_PREFIX;

Module(
  {
    pattern: "filtre ?(.*)",
    fromMe: false,
    desc: "Otomatik yanıt filtreleri oluşturur. Kullanım: .filtre tetikleyici | yanıt",
    usage:
      ".filtre merhaba | Merhaba! | chat\n.filtre yardım | Size yardım edebilirim | global\n.filtre güle | Güle güle! | group | exact",
    use: "utility",
  },
  async (message, match) => {
    if (match[0].includes("filters")) return;
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;
    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply(`*📝 Filtre Komutları:*\n\n` +
          `• \`${handler}filtre tetikleyici | yanıt\` - Sohbet filtresi oluştur\n` +
          `• \`${handler}filtre tetikleyici | yanıt | global\` - Genel filtre oluştur\n` +
          `• \`${handler}filtre tetikleyici | yanıt | group\` - Sadece grup filtresi\n` +
          `• \`${handler}filtre tetikleyici | yanıt | dm\` - Sadece DM filtresi\n` +
          `• \`${handler}filtre tetikleyici | yanıt | chat | exact\` - Sadece tam eşleşme\n` +
          `• \`${handler}filtre tetikleyici | yanıt | chat | case\` - Büyük/küçük harf duyarlı\n` +
          `• \`${handler}filtreler\` - Tüm filtreleri listele\n` +
          `• \`${handler}delfilter tetikleyici\` - Filtreyi sil\n` +
          `• \`${handler}togglefilter tetikleyici\` - Filtreyi aç/kapat\n\n` +
          `*Kapsamlar:*\n` +
          `• \`chat\` - Sadece mevcut sohbet (varsayılan)\n` +
          `• \`global\` - Tüm sohbetler\n` +
          `• \`group\` - Tüm gruplar\n` +
          `• \`dm\` - Tüm DM'ler\n\n` +
          `*Seçenekler:*\n` +
          `• \`exact\` - Sadece tam kelime eşleşmesi\n` +
          `• \`case\` - Büyük/küçük harf duyarlı eşleşme`
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

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
      );
    }

    const filterOptions = {
      caseSensitive: options.includes("case"),
      exactMatch: options.includes("exact"),
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
        scope === "chat"
          ? "bu sohbet"
          : scope === "global"
          ? "tüm sohbetler"
          : scope === "group"
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

Module(
  {
    pattern: "filtreler ?(.*)",
    fromMe: false,
    desc: "Tüm filtreleri listele",
    usage: ".filters\n.filters global\n.filters group",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const scope = match[1]?.trim().toLowerCase();
    let filters;

    try {
      if (scope && ["global", "group", "dm"].includes(scope)) {
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
            chat: "💬",
            global: "🌍",
            group: "👥",
            dm: "📱",
          }[f.scope] || "💬";

        const options = [];
        if (f.exactMatch) options.push("exact");
        if (f.caseSensitive) options.push("case");
        const optionsStr = options.length ? ` [${options.join(", ")}]` : "";

        msg += `${index + 1}. ${scopeEmoji} *${f.trigger}*${optionsStr}\n`;
        msg += `   ↳ _${f.response.substring(0, 50)}${
          f.response.length > 50 ? "..." : ""
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

Module(
  {
    pattern: "filtresil ?(.*)",
    fromMe: false,
    desc: "Bir filtreyi sil",
    usage: ".delfilter trigger\n.delfilter trigger global",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply("_🗑️ Silinecek filtre tetikleyicisini belirtin!_\n_Kullanım: .delfilter tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "chat";

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
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

Module(
  {
    pattern: "togglefilter ?(.*)",
    fromMe: false,
    desc: "Bir filtreyi aç/kapat",
    usage: ".togglefilter trigger\n.togglefilter trigger global",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const input = match[1]?.trim();
    if (!input) {
      return await message.sendReply("_💬 Değiştirilecek filtre tetikleyicisini belirtin!_\n_Kullanım: .togglefilter tetikleyici_"
      );
    }

    const parts = input.split(" ");
    const trigger = parts[0];
    const scope = parts[1] || "chat";

    if (!["chat", "global", "group", "dm"].includes(scope)) {
      return await message.sendReply("_❌ Geçersiz kapsam! Şunları kullanın: chat, global, group veya dm_"
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
          `✅ _"${trigger}" filtresi ${
            newStatus ? "açıldı" : "kapatıldı"
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

Module(
  {
    pattern: "filtretest ?(.*)",
    fromMe: false,
    desc: "Bir mesajın filtreleri tetikleyip tetiklemeyeceğini test edin",
    usage: ".testfilter hello world",
    use: "utility",
  },
  async (message, match) => {
    let adminAccess = ADMIN_ACCESS
      ? await isAdmin(message, message.sender)
      : false;
    if (!message.fromOwner && !adminAccess) return;

    const testText = match[1]?.trim();
    if (!testText) {
      return await message.sendReply("_💬 Filtrelere karşı test edilecek metni girin!_\n_Kullanım: .testfilter merhaba dünya_"
      );
    }

    try {
      const matchedFilter = await filter.checkMatch(testText, message.jid);

      if (matchedFilter) {
        await message.sendReply(`✅ *Filtre Eşleşmesi Bulundu!*\n\n` +
            `*Tetikleyici:* ${matchedFilter.trigger}\n` +
            `*Yanıt:* ${matchedFilter.response}\n` +
            `*Kapsam:* ${matchedFilter.scope}\n` +
            `*Seçenekler:* ${matchedFilter.exactMatch ? "tam eşleşme " : ""}${
              matchedFilter.caseSensitive
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

Module(
  {
    pattern: "filtreyardım",
    fromMe: false,
    desc: "Filtre sistemi için ayrıntılı yardım",
    use: "utility",
  },
  async (message) => {
    const helpText =
      `*🔧 Filtre Sistemi Yardımı*\n\n` +
      `*Filtreler nedir?*\n` +
      `Filtreler, belirli kelime veya ifadelere otomatik yanıt veren tetikleyicilerdir.\n\n` +
      `*📝 Filtre Oluşturma:*\n` +
      `\`${handler}filter merhaba | Merhaba! Nasılsın?\`\n` +
      `• Sohbete özel filtre oluşturur\n` +
      `• Birisi "merhaba" yazdığında bot "Merhaba! Nasılsın?" yanıtını verir\n\n` +
      `*🌍 Filtre Kapsamları:*\n` +
      `• \`chat\` - Sadece mevcut sohbette çalışır\n` +
      `• \`global\` - Tüm sohbetlerde çalışır\n` +
      `• \`group\` - Sadece tüm gruplarda çalışır\n` +
      `• \`dm\` - Sadece tüm DM'lerde çalışır\n\n` +
      `*⚙️ Filtre Seçenekleri:*\n` +
      `• \`exact\` - Sadece tam kelime eşleşmesi\n` +
      `• \`case\` - Büyük/küçük harf duyarlı eşleşme\n\n` +
      `*📋 Örnekler:*\n` +
      `\`${handler}filter bot | Buradayım! | chat\`\n` +
      `\`${handler}filter yardım | Yöneticiyle iletişime geçin | global\`\n` +
      `\`${handler}filter Merhaba | Selam! | group | exact\`\n` +
      `\`${handler}filter ŞİFRE | Şş! | dm | case\`\n\n` +
      `*🔧 Yönetim:*\n` +
      `• \`${handler}filters\` - Tüm filtreleri listele\n` +
      `• \`${handler}delfilter tetikleyici\` - Filtreyi sil\n` +
      `• \`${handler}togglefilter tetikleyici\` - Aç/kapat\n` +
      `• \`${handler}testfilter metin\` - Eşleşmeyi test et\n\n` +
      `*💡 İpuçları:*\n` +
      `• Her mesaj için filtreler kontrol edilir\n` +
      `• Genel filtreler her yerde çalışır\n` +
      `• Kesin tetikleyiciler için tam eşleşme kullanın\n` +
      `• Şifre/kodlar için büyük/küçük harf duyarlı kullanışlıdır`;

    await message.sendReply(helpText);
  }
);
