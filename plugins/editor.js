const { Module } = require("../main");
const { getBuffer, nx, uploadToCatbox, uploadToImgbb } = require("./utils");

const EFFECTS = [
  { command: "blur", desc: "Fotoğrafı profesyonelce bulanıklaştırır.", route: "filter/blur" },
  { command: "pixelate", desc: "Fotoğrafı pikselli sanat eserine dönüştürür.", route: "filter/pixelate" },
  { command: "blue", desc: "Fotoğrafa mavi renk filtresi uygular.", route: "filter/blue" },
  { command: "blurple", desc: "Fotoğrafa blurple renk filtresi uygular.", route: "filter/blurple" },
  { command: "blurple2", desc: "Fotoğrafa alternatif blurple filtresi uygular.", route: "filter/blurple2" },
  { command: "brightness", desc: "Fotoğrafın parlaklık seviyesini artırır.", route: "filter/brightness" },
  { command: "color", desc: "Fotoğrafın renk doygunluğunu ayarlar.", route: "filter/color" },
  { command: "green", desc: "Fotoğrafa yeşil renk filtresi uygular.", route: "filter/green" },
  { command: "bw", desc: "Fotoğrafı siyah-beyaz (nostaljik) hale getirir.", route: "filter/greyscale" },
  { command: "invert", desc: "Fotoğrafın renklerini tersine çevirir (negatif).", route: "filter/invert" },
  { command: "2invert", desc: "Fotoğrafa ters ve gri tonlama efekti uygular.", route: "filter/invertgreyscale" },
  { command: "red", desc: "Fotoğrafa kırmızı renk filtresi uygular.", route: "filter/red" },
  { command: "golden", desc: "Fotoğrafa sıcak altın (sepia) tonları ekler.", route: "filter/sepia" },
  { command: "threshold", desc: "Fotoğrafa siyah-beyaz eşik filtresi uygular.", route: "filter/threshold" },
  { command: "rainbow", desc: "Fotoğrafa gökkuşağı renkleri ekler.", route: "misc/lgbt" },
  { command: "gay", desc: "Fotoğrafa gay bayrağı kaplaması ekler.", route: "overlay/gay" },
  { command: "horny", desc: "Eğlenceli ateşli kart tasarımı oluşturur.", route: "misc/horny" },
  { command: "simpcard", desc: "Kişiye özel simp kartı tasarımı oluşturur.", route: "misc/simpcard" },
  { command: "circle", desc: "Fotoğrafı dairesel bir profil resmine dönüştürür.", route: "misc/circle" },
  { command: "heart", desc: "Fotoğrafı kalp çerçevesi içine alır.", route: "misc/heart" },
  { command: "glass", desc: "Fotoğrafa şık bir cam kırığı kaplaması ekler.", route: "overlay/glass" },
  { command: "wasted", desc: "GTA tarzı öldün (wasted) efekti ekler.", route: "overlay/wasted" },
  { command: "passed", desc: "GTA tarzı görev tamamlandı efekti ekler.", route: "overlay/passed" },
  { command: "jail", desc: "Kişiyi hapishane parmaklıkları ardına koyar.", route: "overlay/jail" },
  { command: "comrade", desc: "Fotoğrafa yoldaş (comrade) kaplaması ekler.", route: "overlay/comrade" },
  { command: "triggered", desc: "Fotoğrafa sinirli (triggered) efekti ekler.", route: "overlay/triggered" },
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
  const link = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);

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

Module({
  pattern: "editör",
  fromMe: false,
  desc: "Tüm görsel düzenleme ve efekt komutlarını içeren menüyü görüntüler.",
  usage: ".editör",
  use: "düzenleme",
},
  async (message) => {
    await message.sendReply(list);
  }
);

function registerEffect(command, desc, route) {
  Module({
    pattern: `${command} ?(.*)`,
    fromMe: false,
    desc,
    dontAddCommandList: true,
    use: "düzenleme",
  },
    async (message) => {
      await applyEffect(message, route);
    }
  );
}

for (const effect of EFFECTS) {
  registerEffect(effect.command, effect.desc, effect.route);
}

Module({
  pattern: "wasted ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa GTA tarzı öldün (wasted) efekti uygular.",
  usage: ".wasted [yanıtla]",
  use: "düzenleme",
},
  async (message, match) => {
    const mime = message.reply_message?.mimetype || message.mimetype || "";
    const isImg = mime.startsWith("image/");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.wasted`");
    try {
      const wait = await message.send("🎨 _İşliyorum..._");
      const path = await message.reply_message.download();
      const upload = await uploadToImgbb(path);
      const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const buf = await getBuffer(`https://api.some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(url)}`);
      if (!buf || buf.length < 1000) throw new Error("Görsel APİ'den alınamadı.");
      await message.edit("💀 *Hakkı Rahmetine Kavuştu!*", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wasted efektini uygulayamadım:_ ${e.message}`);
      throw e;
    }
  }
);

Module({
  pattern: "wanted ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa aranıyor (wanted) poster efekti uygular.",
  usage: ".wanted [yanıtla]",
  use: "düzenleme",
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
        const upload = await uploadToImgbb(path);
        const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
        imgUrl = url;
        await message.edit("✅ _Görsel hazır, poster basılıyor..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await getBuffer(`https://api.popcat.xyz/wanted?image=${encodeURIComponent(imgUrl)}`);
      if (!buf || buf.length < 1000) throw new Error("Wanted posteri basılamadı.");
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
    const upload = await uploadToImgbb(path);
    const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
    if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

    await message.edit("✅ _Efekti uyguluyorum..._", message.jid, wait.key);

    // Ephoto endpoint'leri Nexray tarafında kapalı veya arızalı olduğu için hata fırlatıyoruz 
    // veya alternatif Popcat benzeri sistem kullanabiliriz. Şimdilik geçici iptal.
    throw new Error("Ephoto sistemi geçici olarak çevrimdışıdır.");

    // const result = await nx(`${endpoint}?url=${encodeURIComponent(url)}`, { buffer: true, timeout: 90000 });
    // await message.edit(caption, message.jid, wait.key);
    // await message.client.sendMessage(message.jid, { image: result }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`❌ _Tüh! Efekti uygulayamadım:_ ${e.message}`);
    throw e;
  }
}

Module({
  pattern: "anime ?(.*)",
  fromMe: false,
  desc: "Seçtiğiniz fotoğrafı profesyonel anime çizgifilm karakterine dönüştürür.",
  usage: ".anime [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/anime", "🎌 *Anime dönüşümü tamamlandı!*")
);

Module({
  pattern: "ghiblistil ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı Studio Ghibli animasyonlarının büyüleyici sanat stiline uyarlar.",
  usage: ".ghiblistil [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/ghibli", "🌿 *Studio Ghibli dönüşümü tamamlandı!*")
);

Module({
  pattern: "chibi ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı sevimli ve küçük chibi karakter stiline dönüştürür.",
  usage: ".chibi [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/chibi", "🧸 *Chibi dönüşümü tamamlandı!*")
);

Module({
  pattern: "efektsinema ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa profesyonel bir film karesi havası katan sinematik efekt uygular.",
  usage: ".efektsinema [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/cinematic", "🎬 *Sinematik efekt uygulandı!*")
);

Module({
  pattern: "grafitisokak ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı bir sokak duvarındaki etkileyici grafiti sanatına dönüştürür.",
  usage: ".grafitisokak [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/street", "🎨 *Grafiti dönüşümü tamamlandı!*")
);

Module({
  pattern: "pikselart ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı nostaljik bir piksel sanat eseri NFT stiline dönüştürür.",
  usage: ".pikselart [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/nft", "👾 *Piksel sanat dönüşümü tamamlandı!*")
);

Module({
  pattern: "çizgiroman ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı aksiyon dolu bir çizgi roman karesine dönüştürür.",
  usage: ".çizgiroman [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/comic", "💥 *Çizgi roman dönüşümü tamamlandı!*")
);

Module({
  pattern: "mafia ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa şık ve gizemli bir mafia atmosferi kazandırır.",
  usage: ".mafia [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/mafia", "🕴️ *Mafia dönüşümü tamamlandı!*")
);

