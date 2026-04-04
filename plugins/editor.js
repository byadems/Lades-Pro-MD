const { Module } = require("../main");
const { MODE } = require("../config");
const { getBuffer, nx, uploadToCatbox } = require("./utils");
const { uploadToImgbb } = require("./utils/upload");

const x = MODE == "public" ? false : true;

const EFFECTS = [
  { command: "blur", desc: "Fotoğrafı bulanıklaştırır.", route: "filter/blur" },
  { command: "pixelate", desc: "Fotoğrafı pikselleştirir.", route: "filter/pixelate" },
  { command: "blue", desc: "Mavi filtre uygular.", route: "filter/blue" },
  { command: "blurple", desc: "Blurple filtre uygular.", route: "filter/blurple" },
  { command: "blurple2", desc: "Blurple v2 filtre uygular.", route: "filter/blurple2" },
  { command: "brightness", desc: "Parlaklık filtresi uygular.", route: "filter/brightness" },
  { command: "color", desc: "Renk doygunluğu filtresi uygular.", route: "filter/color" },
  { command: "green", desc: "Yeşil filtre uygular.", route: "filter/green" },
  { command: "bw", desc: "Siyah-beyaz efekti uygular.", route: "filter/greyscale" },
  { command: "invert", desc: "Ters çevirme efekti uygular.", route: "filter/invert" },
  {
    command: "2invert",
    desc: "Ters + gri çevirme efektini uygular.",
    route: "filter/invertgreyscale",
  },
  { command: "red", desc: "Kırmızı filtre uygular.", route: "filter/red" },
  { command: "golden", desc: "Altın (sepia) filtresi uygular.", route: "filter/sepia" },
  { command: "threshold", desc: "Eşik filtresi uygular.", route: "filter/threshold" },
  { command: "rainbow", desc: "LGBT gökkuşağı efekti uygular.", route: "misc/lgbt" },
  { command: "gay", desc: "Gay overlay efekti uygular.", route: "overlay/gay" },
  { command: "horny", desc: "Ateşli kart üretir.", route: "misc/horny" },
  { command: "simpcard", desc: "Simp kartı üretir.", route: "misc/simpcard" },
  { command: "circle", desc: "Dairesel avatar efekti uygular.", route: "misc/circle" },
  { command: "heart", desc: "Kalp temalı efekt uygular.", route: "misc/heart" },
  { command: "glass", desc: "Cam overlay efekti uygular.", route: "overlay/glass" },
  { command: "wasted", desc: "GTA Wasted efekti uygular.", route: "overlay/wasted" },
  { command: "passed", desc: "GTA Mission Passed efekti uygular.", route: "overlay/passed" },
  { command: "jail", desc: "Hapishane overlay efekti uygular.", route: "overlay/jail" },
  { command: "comrade", desc: "Comrade overlay efekti uygular.", route: "overlay/comrade" },
  { command: "triggered", desc: "Triggered overlay efekti uygular.", route: "overlay/triggered" },
];

function buildCategoryLines(prefix, items) {
  const lines = [`🔹 *${prefix}*`];
  items.forEach((item) => {
    lines.push(`• .${item.command} → ${item.desc}`);
  });
  return lines;
}

const filterEffects = EFFECTS.filter((item) => item.route.startsWith("filter/"));
const miscEffects = EFFECTS.filter((item) => item.route.startsWith("misc/"));
const overlayEffects = EFFECTS.filter((item) => item.route.startsWith("overlay/"));

const list =
  "```" +
  [
    "╔══════════════════════════════════════╗",
    "║   📸 FOTOĞRAF DÜZENLEME KOMUTLARI   ║",
    "╚══════════════════════════════════════╝",
    "Herhangi bir fotoğrafa yanıt vererek kullanabilirsiniz.",
    "",
    ...buildCategoryLines("Filtreler", filterEffects),
    "",
    ...buildCategoryLines("Misc Efektler", miscEffects),
    "",
    ...buildCategoryLines("Overlay Efektler", overlayEffects),
  ].join("\n") +
  "\n```";

function buildCandidateUrls(route, imageUrl) {
  const encoded = encodeURIComponent(imageUrl);
  const base = `https://api.some-random-api.com/canvas/${route}`;
  if (route.startsWith("overlay/")) {
    return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
  }
  return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
}

async function applyEffect(message, route) {
  if (!message.reply_message || !message.reply_message.image) {
    return await message.sendReply("❗️ *Bir fotoğrafa yanıt vererek yazınız.*");
  }

  const imagePath = await message.reply_message.download();
  const upload = await uploadToImgbb(imagePath);
  const link = upload?.url;

  if (!link) {
    return await message.sendReply("❌ *Görsel yüklenemedi. Tekrar deneyin.*");
  }

  const urls = buildCandidateUrls(route, link);
  let buffer;
  let lastError;

  for (const url of urls) {
    try {
      buffer = await getBuffer(url);
      if (buffer?.length) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!buffer) {
    console.error("Editör efekti başarısız:", route, lastError?.message || lastError);
    return await message.sendReply(
      "❌ *Efekt uygulanamadı. API şu an yanıt vermiyor olabilir.*"
    );
  }

  return await message.sendMessage(buffer, "image");
}

Module(
  {
    pattern: "editör",
    fromMe: x,
    desc: "Fotoğraf düzenleme araçlarını getirir.",
    use: "edit",
  },
  async (message) => {
    await message.sendReply(list);
  }
);

function registerEffect(command, desc, route) {
  Module(
    {
      pattern: `${command} ?(.*)`,
      fromMe: x,
      dontAddCommandList: true,
      desc,
      use: "edit",
    },
    async (message) => {
      await applyEffect(message, route);
    }
  );
}

for (const effect of EFFECTS) {
  registerEffect(effect.command, effect.desc, effect.route);
}

Module(
  {
    pattern: "wasted ?(.*)",
    fromMe: x,
    desc: "GTA tarzı 'Wasted' efekti uygular",
    usage: ".wasted (görsele yanıtlayın)",
    use: "edit",
  },
  async (message, match) => {
    const mime = message.reply_message?.mimetype || message.mimetype || "";
    const isImg = mime.startsWith("image/");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.wasted`");
    try {
      const wait = await message.send("🎨 _İşliyorum..._");
      const path = await message.reply_message.download();
      const { url } = await uploadToCatbox(path);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const buf = await nx(`/editor/wasted?url=${encodeURIComponent(url)}`, { buffer: true });
      await message.edit("💀 *Hakkı Rahmetine Kavuştu!*", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wasted efektini uygulayamadım:_ ${e.message}`);
      throw e;
    }
  }
);

Module(
  {
    pattern: "wanted ?(.*)",
    fromMe: x,
    desc: "Aranıyor posteri oluşturur",
    usage: ".wanted (görsel gönder veya yanıtla)",
    use: "edit",
  },
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();

    if (!isImg && !imgUrl.startsWith("http")) {
      return await message.sendReply("🖼️ _Bir görseli yanıtlayın veya URL girin:_ `.wanted`");
    }
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("🎨 _İşliyorum..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("✅ _Görsel hazır, poster basılıyor..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await nx(`/editor/wanted?url=${encodeURIComponent(imgUrl)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: "🔫 *ARANIYOR!*" }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wanted efektini uygulayamadım:_ ${e.message}`);
      throw e;
    }
  }
);

// Yardımcı: URL olan resimli mesaja ephoto efekti uygula
async function applyEphoto(message, endpoint, caption) {
  const replyMime = message.reply_message?.mimetype || "";
  const isImg = replyMime.startsWith("image/");
  if (!isImg) return await message.sendReply(`🖼️ _Bir görseli yanıtlayın:_ \`${endpoint}\``);
  try {
    const wait = await message.send("⌛ _İşliyorum, lütfen bekleyin..._");
    const path = await message.reply_message.download();
    const { url } = await uploadToCatbox(path);
    if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

    await message.edit("✅ _Efekti uyguluyorum..._", message.jid, wait.key);
    const result = await nx(`${endpoint}?url=${encodeURIComponent(url)}`, { buffer: true, timeout: 90000 });

    // Başarı mesajını görsel altına değil, önceki mesaja yazıyoruz (edit)
    await message.edit(caption, message.jid, wait.key);
    // Görseli tertemiz, captionsız gönderiyoruz
    await message.client.sendMessage(message.jid, { image: result }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`❌ _Tüh! Efekti uygulayamadım:_ ${e.message}`);
    throw e;
  }
}

Module(
  {
    pattern: "anime ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı anime stiline dönüştürür",
    usage: ".anime (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/anime", "🎌 *Anime dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "ghiblistil ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı Studio Ghibli stiline dönüştürür",
    usage: ".ghiblistil (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/ghibli", "🌿 *Studio Ghibli dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "chibi ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı chibi stiline dönüştürür",
    usage: ".chibi (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/chibi", "🧸 *Chibi dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "efektsinema ?(.*)",
    fromMe: x,
    desc: "Fotoğrafa sinematik film efekti uygular",
    usage: ".sinema (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/cinematic", "🎬 *Sinematik efekt uygulandı!*")
);

Module(
  {
    pattern: "grafitisokak ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı sokak grafiti sanatına dönüştürür",
    usage: ".grafitisokak (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/street", "🎨 *Grafiti dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "pikselart ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı piksel NFT sanatına dönüştürür",
    usage: ".pikselart (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/nft", "👾 *Piksel sanat dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "komik ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı çizgi roman stiline dönüştürür",
    usage: ".komik (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/comic", "💥 *Çizgi roman dönüşümü tamamlandı!*")
);

Module(
  {
    pattern: "mafia ?(.*)",
    fromMe: x,
    desc: "Fotoğrafı mafia stiline dönüştürür",
    usage: ".mafia (görsel yanıtla)",
    use: "edit",
  },
  async (message) => applyEphoto(message, "/ephoto/mafia", "🕴️ *Mafia dönüşümü tamamlandı!*")
);
