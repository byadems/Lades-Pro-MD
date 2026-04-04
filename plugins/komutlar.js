const { Module, commands } = require('../main');

// Komut adını çıkaran yardımcı fonksiyon
const extractCommandName = (pattern) => {
  const raw = pattern instanceof RegExp ? pattern.source : String(pattern || "");
  const start = raw.search(/[\p{L}\p{N}]/u);
  if (start === -1) return "";
  const cmdPart = raw.slice(start);
  const match = cmdPart.match(/^[\p{L}\p{N}]+/u);
  return match && match[0] ? match[0].trim() : "";
};

// Komut detaylarını bulan yardımcı fonksiyon
const retrieveCommandDetails = (commandName) => {
  const foundCommand = commands.find(
    (cmd) => extractCommandName(cmd.pattern) === commandName
  );
  if (!foundCommand) return null;
  return {
    name: commandName,
    ...foundCommand,
  };
};

Module(
  {
    pattern: 'komut ?(.*)',
    fromMe: false,
    desc: 'Bot komutlarını listeler veya belirtilen komutun detaylarını gösterir.',
    use: 'genel',
    usage: '.komutlar | .komut spotify'
  },
  async (m, match) => {
  const arg = match[1]?.trim().toLowerCase();

  // Eğer 'lar' yazılmışsa tam listeyi göster
  if (arg === 'lar') {
    return await m.sendReply(
      "📋 *GENEL KOMUTLAR*\n" +
      "🧑 .uzakta\nSizi AFK (Uzakta) yapar. Etiketlenirseniz Bot sizin yerinize cevap verir.\n\n" +
      "💻 .kontrol\nBotun çalışıp çalışmadığını kontrol etmenizi sağlar.\n\n" +
      "📶 .ping\nPing süresini (tepki hızını) ölçer.\n\n" +
      "⏱️ .uptime\nSistem (OS) ve işlem çalışma süresini gösterir.\n\n" +
      "📋 .liste\nTüm komutları kategorilere ayrılmış şekilde listeler.\n\n" +
      "📋 .menü\nBot komut menüsünü gösterir.\n\n" +
      "🎮 .oyunlar\nMevcut tüm oyunları listeler.\n\n" +
      "📝 .take\nÇıkartma/ses dosyalarını değiştirir. Başlık, sanatçı, kapak resmi vb. değişiklik yapar.\n\n" +
      "🖋️ .fancy\nŞık yazı tipleri oluşturur.\n\n" +
      "🔁 .tekrar\nYanıtlanan komutu tekrar çalıştırır.\n\n" +
      "📣 .bildir\nBot hakkında istek, şikayet, hata bildirimi, öneri veya talep iletir.\n\n" +
      "📝 .düzenle\nBot'un yazdığı mesajı düzenlemeye yarar.\n\n" +
      "⏫ .url\nGörseli imgur.com'a yükler ve bağlantısını paylaşır.\n\n" +
      "🔁 .react\nYanıtlanan mesaja emoji tepkisi verir.\n\n" +
      "📨 .msjat\nBot'un attığı mesaja kendiniz cevap verir.\n\n" +
      "↪️ .msjyönlendir\nBot'un mesajını başka bir sohbete yönlendirir.\n\n" +
      "🗑️ .msjsil\nEtiketlenen mesajı herkesten siler.\n\n" +
      "💬 .quoted\nYanıtlanan mesajın yanıtını gösterir. Silinen mesajları geri almak için kullanışlıdır.\n\n" +
      "👀 .vv\nTek seferlik görüntülenebilen medyayı gösterir.\n\n" +
      "📲 .dc\nDestek grubu iletişim bilgilerini gösterir.\n\n" +
      "🔗 .bağla\nBotu kapatır.\n\n" +
      "🔄 .otodl\nOtomatik indirme özelliğini aç/kapat.\n\n" +
      "🔄 .ybaşlat|reload|reboot\nBotu yeniden başlatır.\n\n" +
      "🔄 .güncelle\nBot'u günceller.\n\n" +
      "📦 .modülyükle\nHarici bir modül yükler.\n\n" +
      "📦 .modül\nYüklenmiş modülleri listeler.\n\n" +
      "🗑️ .modülsil\nYüklenmiş bir modülü siler.\n\n" +
      "🔄 .mgüncelle\nModülleri günceller.\n\n" +
      "🎂 .yaşhesap\nYaş hesaplar.\n\n" +
      "⏳ .gerisayım\nZaman hesabı yapar. Belirlediğiniz tarihe ne kadar kaldığını söyler.\n\n" +
      "⚡ .hıztesti\nİnternet hızınızı test eder.\n\n" +
      "❤️ .aşkölç\nAşk ölçer.\n\n" +
      "🧠 .beyin\nBeyin oyunu.\n\n" +
      "🤔 .bilmece\nBilmece sorar.\n\n" +
      "🔬 .kimyasoru\nKimya sorusu sorar.\n\n" +
      "😂 .alay\nAlaycı mesaj oluşturur.\n\n" +
      "🐉 .dragonyazı\nDragon tarzı yazı yazdırır.\n\n" +
      "💫 .neonyazı\nNeon tarzı yazı yazdırır.\n\n" +
      "🎨 .grafitiyazı\nGrafiti tarzı yazı yazdırır.\n\n" +
      "😈 .devilyazı\nŞeytan tarzı yazı yazdırır.\n\n" +
      "🎵 .muzikkartı\nMüzik kartı oluşturur.\n\n" +
      "⚙️ *SSTEM & ANALZ KOMUTLARI*\n" +
      "⚙️ .setalive\nBot için çevrimiçi mesajı ayarlar.\n\n" +
      "⚙️ .setinfo\nBot yapılandırma komutları hakkında bilgi gösterir.\n\n" +
      "⚙️ .setname\nBot adını ayarlar.\n\n" +
      "🖼️ .setimage\nBot resmini ayarlar.\n\n" +
      "🧪 .testalive\nMevcut çevrimiçi mesajını test eder.\n\n" +
      "📊 .mesajlar\nÜyelerin mesaj istatistiklerini gösterir.\n\n" +
      "📉 .inactive\nAktif olmayan üyeleri listeler.\n\n" +
      "👥 .üyetemizle\nAktif olmayan üyeleri temizler.\n\n" +
      "👥 .users\nKullanıcı listesini gösterir.\n\n" +
      "🚫 .bahsetme\nBahsetmeyi engeller.\n\n" +
      "🔧 *GRUP YÖNETİM KOMUTLARI*\n" +
      "🗑️ .sohbetsil\nGrup sohbetini tamamen siler.\n\n" +
      "❌ .ban\nEtiketlenen kişiyi gruptan çıkarır.\n\n" +
      "😈 .at\nEtiketlenen kişiyi (sürprizli bir şekilde) gruptan çıkarır.\n\n" +
      "➕ .ekle\nKişiyi gruba ekler.\n\n" +
      "👑 .yetkiver\nYönetici yetkisi verir.\n\n" +
      "✅ .istekler\nBekleyen katılım isteklerini yönetir.\n\n" +
      "👋 .ayrıl\nGruptan ayrılır.\n\n" +
      "🔗 .davet\nGrup davet linki oluşturur.\n\n" +
      "🔄 .davetyenile\nGrup davet linkini yeniler.\n\n" +
      "🔕 .gayaryt\nSadece yöneticileri etiketlemeyi kapatır.\n\n" +
      "🔕 .gayarherkes\nHerkesi etiketlemeyi kapatır.\n\n" +
      "📝 .grupadı\nGrup adını değiştirir.\n\n" +
      "📄 .grupaçıklama\nGrup açıklamasını değiştirir.\n\n" +
      "🤝 .common\nİki grup arasındaki ortak üyeleri gösterir.\n\n" +
      "🔍 .diff\nİki grup arasındaki farkları gösterir.\n\n" +
      "📢 .tagall\nTüm üyeleri etiketler.\n\n" +
      "🚫 .engelle\nKişiyi engeller.\n\n" +
      "✅ .katıl\nBelirtilen gruba katılır.\n\n" +
      "🔓 .engelkaldır\nEngeli kaldırır.\n\n" +
      "👥 .toplukatıl\nToplu olarak gruba katılır.\n\n" +
      "🆔 .tümjid\nTüm JID'leri gösterir.\n\n" +
      "📢 .duyuru\nDuyuru yapar.\n\n" +
      "📌 .sabitle\nMesajı sabitler.\n\n" +
      "📸 .pp\nProfil fotoğrafını gösterir.\n\n" +
      "🖼️ .grupfoto\nGrup fotoğrafını değiştirir.\n\n" +
      "🪙 .altın\nGüncel altın fiyatlarını gösterir.\n\n" +
      "👥 .etiket\nTüm üyeleri etiketler.\n\n" +
      "🛡️ .ytetiket\nTüm yöneticileri etiketler.\n\n" +
      "🔇 .sohbetkapat\nGrup sohbetini kapatır.\n\n" +
      "🔊 .sohbetaç\nGrup sohbetini açar.\n\n" +
      "🆔 .jid\nJID bilgisi verir.\n\n" +
      "👑 .yetkial\nYönetici yetkisini alır.\n\n" +
      "🕒 .otoçıkartma\nOtomatik çıkartma ayarlar.\n\n" +
      "🗑️ .otoçıkartmasil\nOtomatik çıkartma siler.\n\n" +
      "📋 .otoçıkartmalar\nOtomatik çıkartmaları listeler.\n\n" +
      "🕒 .otosohbetkapat\nOtomatik sohbet kapatma ayarlar.\n\n" +
      "📅 .otosohbetaç\nOtomatik sohbet açma ayarlar.\n\n" +
      "🔇 .otosohbet\nOtomatik sohbet ayarları.\n\n" +
      "🚫 .antinumara\nNumara engelleme ayarları.\n\n" +
      "⚠️ .uyar\nÜyeyi uyarır.\n\n" +
      "📊 .kaçuyarı\nUyarı sayısını gösterir.\n\n" +
      "➖ .uyarısil\nUyarı siler.\n\n" +
      "🔄 .uyarısıfırla\nTüm uyarıları sıfırlar.\n\n" +
      "📋 .uyarıliste\nUyarı listesini gösterir.\n\n" +
      "⚙️ .uyarılimit\nUyarı limitini ayarlar.\n\n" +
      "🚫 .filtre\nKelime filtresi ekler.\n\n" +
      "📋 .filtreler\nFiltreleri listeler.\n\n" +
      "🗑️ .filtresil\nFiltre siler.\n\n" +
      "🔄 .togglefilter\nFiltreyi aç/kapar.\n\n" +
      "🧪 .filtretest\nFiltreyi test eder.\n\n" +
      "❓ .filtreyardım\nFiltre yardımını gösterir.\n\n" +
      "⬇️ *NDRME MERKEZ KOMUTLARI*\n" +
      "🎶 .şarkı\nYouTube'dan şarkı indirir.\n\n" +
      "🎧 .spotify\nSpotify'dan şarkı indirir.\n\n" +
      "📹 .video\nYouTube'dan video indirir.\n\n" +
      "🔽 .ytvideo\nYouTube'dan videoyi istenen kalitede indirir.\n\n" +
      "🎵 .ytses\nYouTube'dan ses indirir.\n\n" +
      "📷 .insta\nInstagram'dan gönderi/reel indirir.\n\n" +
      "🔎 .igara\nInstagram'dan kullanıcı bilgilerini getirir.\n\n" +
      "📘 .fb\nFacebook'tan gönderi/video indirir.\n\n" +
      "📌 .pinterest\nPinterest içeriği indirir.\n\n" +
      "🎥 .tiktok\nTikTok'tan video indirir.\n\n" +
      "🔎 .ttara\nTikTok'tan kullanıcı bilgilerini getirir.\n\n" +
      "🎬 .capcut\nCapCut'tan video indirir.\n\n" +
      "🧵 .threads\nThreads'ten içerik indirir.\n\n" +
      "🎧 .soundcloud\nSoundCloud'dan müzik indirir.\n\n" +
      "⬆️ .upload\nURL'den medya indirir.\n\n" +
      "🔍 *ARAMA & BLG KOMUTLARI*\n" +
      "🎬 .movie\nFilm araması yapar.\n\n" +
      "💻 .hackernews\nHaber makalelerini getirir.\n\n" +
      "📲 .waupdate\nWhatsApp güncelleme haberlerini getirir.\n\n" +
      "📰 .news\nEn son haberleri getirir.\n\n" +
      "📊 .wapoll\nAnket oluşturur.\n\n" +
      "🖼️ .görsel\nGoogle'dan görsel arar.\n\n" +
      "🍳 .reçete\nYemek tarifi arar.\n\n" +
      "🔎 .ytara\nYouTube'dan kanal bilgisi alır.\n\n" +
      "📖 .hikaye\nInstagram hikayesini indirir.\n\n" +
      "🐦 .twitter\nTwitter'dan içerik indirir.\n\n" +
      "😂 .emojimix\nİki emoji'yi birleştirir.\n\n" +
      "📝 .yazı\nYazı yazdırır.\n\n" +
      "🥷 .naruto\nNaruto tarzı sticker oluşturur.\n\n" +
      "🦸 .marvel\nMarvel tarzı sticker oluşturur.\n\n" +
      "💖 .blackpink\nBlackpink tarzı sticker oluşturur.\n\n" +
      "👑 .brat\nBrat tarzı sticker oluşturur.\n\n" +
      "💭 .söz\nGüzel sözler paylaşır.\n\n" +
      "🖼️ .duvar\nDuvar kağıdı arar.\n\n" +
      "🔍 .çıkartmabul\nSticker arar.\n\n" +
      "📚 .vikipedi\nVikipedi'den arama yapar.\n\n" +
      "💬 .alıntı\nAlıntı paylaşır.\n\n" +
      "💭 .rüya\nRüya tabiri yapar.\n\n" +
      "🕌 .ezan\nEzan vakitlerini gösterir.\n\n" +
      "🕋 .sahur\nSahur vaktini hesaplar.\n\n" +
      "🌙 .iftar\nİftar vaktini hesaplar.\n\n" +
      "☁️ .hava\nHava durumu bilgisi verir.\n\n" +
      "💱 .kur\nDöviz kuru dönüşümü yapar.\n\n" +
      "🌍 .çevir\nÇeviri yapar.\n\n" +
      "🔤 .detectlang\nMesaj dilini tespit eder.\n\n" +
      "📲 .true\nNumara sorgular.\n\n" +
      "📱 .onwa\nWhatsApp'da numara sorgular.\n\n" +
      "📳 .sondepremler\nSon depremleri listeler.\n\n" +
      "📳 .sondeprem\nSon depremi gösterir.\n\n" +
      "🎓 .bilgikaçnet\nÜniversite bölümleri hakkında bilgi verir.\n\n" +
      "💬 *SOHBET & MESAJ KOMUTLARI*\n" +
      "👋 .welcome\nHoş geldiniz mesajı ayarlar.\n\n" +
      "👋 .goodbye\nGörüşürüz mesajı ayarlar.\n\n" +
      "🧪 .testwelcome\nHoş geldiniz mesajını test eder.\n\n" +
      "🧪 .testgoodbye\nGörüşürüz mesajını test eder.\n\n" +
      "👑 *KURUCU & GELŞTRC KOMUTLARI*\n" +
      " .değişkengetir\nDeğişken getirir.\n\n" +
      "🗑️ .değişkensil\nDeğişken siler.\n\n" +
      "📋 .değişkenler\nTüm değişkenleri listeler.\n\n" +
      "💻 .platform\nPlatform bilgisini gösterir.\n\n" +
      "🌍 .dil\nDil ayarları.\n\n" +
      "⚙️ .ayarlar\nBot ayarlarını gösterir.\n\n" +
      "️ .antisilme\nAnti-silme özelliği.\n\n" +
      "👑 .sudolar\nSudo kullanıcılarını listeler.\n\n" +
      "🔄 .toggle\nÖzellik aç/kapar.\n\n" +
      "🤖 .antibot\nBot koruması.\n\n" +
      "🚫 .antispam\nSpam koruması.\n\n" +
      "📵 .pdm\nPDM (Private Message) koruması.\n\n" +
      "📉 .antiyetkidüşürme\nAnti-yetki düşürme.\n\n" +
      "📈 .antiyetkiverme\nAnti-yetki verme.\n\n" +
      "🔗 .antibağlantı\nBağlantı engelleme.\n\n" +
      "🚫 .antikelime\nKelime engelleme.\n\n" +
      "🔍 .aramaengel\nArama engelleme.\n\n" +
      "🎨 *GÖRSEL DÜZENLEME KOMUTLARI*\n" +
      "🖌️ .editör\nFotoğraf düzenleme komutlarını listeler.\n\n" +
      "🎮 .wasted\nWasted efekti uygular.\n\n" +
      "🕵️ .wanted\nWanted poster efekti uygular.\n\n" +
      "🌸 .anime\nAnime efekti uygular.\n\n" +
      "🎨 .ghiblistil\nGhibli stili efekti uygular.\n\n" +
      "👶 .chibi\nChibi efekti uygular.\n\n" +
      "🎬 .efektsinema\nSinema efekti uygular.\n\n" +
      "🎨 .grafitisokak\nGrafiti sokak efekti uygular.\n\n" +
      "🎮 .pikselart\nPiksel art efekti uygular.\n\n" +
      "😂 .komik\nKomik efekti uygular.\n\n" +
      "🎭 .mafia\nMafia efekti uygular.\n\n" +
      "🎬 *MEDYA ŞLEMLER*\n" +
      "🖼️ .çıkartma\nMedyayı stickere çevirir.\n\n" +
      "🎵 .mp3\nVideodan ses çıkarır.\n\n" +
      "🐢 .slow\nMüziği yavaşlatır.\n\n" +
      "⚡ .sped\nMüziği hızlandırır.\n\n" +
      "🔊 .basartır\nBass ayarı yapar.\n\n" +
      "🏞️ .foto\nStickerı fotoğrafa çevirir.\n\n" +
      "✨ .yazıçıkartma\nMetinden sticker oluşturur.\n\n" +
      "🎞️ .mp4\nStickerı videoya çevirir.\n\n" +
      "📂 .belge\nMedyayı belgeye çevirir.\n\n" +
      "📄 .pdf\nFotoğrafları PDF'ye çevirir.\n\n" +
      "🔈 .ses\nMetni sese çevirir.\n\n" +
      "🎙️ .dinle\nSesi metne çevirir.\n\n" +
      "🔎 .bul\nŞarkıyı tanır.\n\n" +
      "📐 .square\nMedyayı kare yapar.\n\n" +
      "📏 .resize\nMedyayı yeniden boyutlandırır.\n\n" +
      "🗜️ .sıkıştır\nMedyayı sıkıştırır.\n\n" +
      "🎮 *OYUNLAR & TESTLER*\n" +
      "🎂 .testgay\nGay testi yapar.\n\n" +
      "🧊 .testlez\nLezbiyen testi yapar.\n\n" +
      "👸 .testprenses\nPrenses testi yapar.\n\n" +
      "🩸 .testregl\nRegl testi yapar.\n\n" +
      "🙏 .testinanç\nİnanç testi yapar.\n\n" +
      "⏳ .ykssayaç\nYKS sayacı.\n\n" +
      "📅 .kpsssayaç\nKPSS sayacı.\n\n" +
      "📜 .msüsayaç\nMSÜ sayacı.\n\n" +
      "🏫 .okulsayaç\nOkul sayacı.\n\n" +
      "🌙 .ramazansayaç\nRamazan sayacı.\n\n" +
      "⏰ .planla\nMesaj planlar.\n\n" +
      "📋 .plandurum\nPlan durumunu gösterir.\n\n" +
      "🗑️ .plansil\nPlanı siler.\n\n" +
      "🛠️ *ARAÇLAR & ÇEVİRİ KOMUTLARI*\n" +
      "🎥 .trim\nMedyayı keser.\n\n" +
      "⚫ .siyahvideo\nSiyah video yapar.\n\n" +
      "🎬 .birleştir\nSes ve video birleştirir.\n\n" +
      "🎥 .vmix\nİki video birleştirir.\n\n" +
      "🐌 .ağırçekim\nAğır çekim efekti.\n\n" +
      "⚙️ .interp\nFPS artırır.\n\n" +
      "🔄 .döndür\nVideoyu döndürür.\n\n" +
      "🔀 .flip\nVideoyu ters çevirir.\n\n" +
      "⭕ .oval\nDaire yapar.\n\n" +
      "📽️ .gif\nVideoyu GIF'e çevirir.\n\n" +
      "🖼️ .ss\nEkran görüntüsü alır.\n\n" +
      "🎨 .renklendir\nMedyayı renklendirir.\n\n" +
      "💻 .kodgörsel\nKoddan görsel oluşturur.\n\n" +
      "😂 .meme\nMeme oluşturur.\n\n" +
      "👑 *DİĞER YÖNETİM KOMUTLARI*\n" +
      "🔧 .değişkenler\nDeğişkenleri yönetir.\n\n" +
      "👑 .sudolar\nSudo kullanıcılarını yönetir.\n\n" +
      "🔄 .toggle\nÖzellikleri yönetir.\n\n" +
      "🛡️ .antibot\nBot korumasını ayarlar.\n\n" +
      "🚫 .antispam\nSpam korumasını ayarlar.\n\n" +
      "📵 .pdm\nPDM ayarları.\n\n" +
      "📉 .antiyetkidüşürme\nAnti-yetki düşürme ayarları.\n\n" +
      "📈 .antiyetkiverme\nAnti-yetki verme ayarları.\n\n" +
      "🔗 .antibağlantı\nBağlantı engelleme ayarları.\n\n" +
      "🚫 .antikelime\nKelime engelleme ayarları.\n\n" +
      "🔍 .aramaengel\nArama engelleme ayarları.\n\n" +
      "🤖 *YAPAY ZEKA KOMUTLARI*\n" +
      "🤖 .yz\nGemini AI'ya soru sor.\n\n" +
      "🎨 .yzgörsel\nMetni görsele çevirir.\n\n" +
      "🖌️ .yzdüzenle\nGörüntüyü AI ile düzenler.\n\n" +
      "🎭 .yzanime\nGörüntüyü anime yapar.\n\n" +
      "🧩 .soruçöz\nSınav sorularını çözer.\n\n" +
      "🤖 .yzayar\nAI ayarlarını yönetir.\n\n" +
      "🎬 *MEDYA İŞLEMLERİ*\n" +
      "🔍 .apsil\nArka planı kaldırır.\n\n" +
      "⬆️ .hd\nGörüntü kalitesini artırır.\n\n" +
      "🎙️ .ses\nMetni sese çevirir.\n\n" +
      "🎧 .dinle\nSesi metne çevirir.\n\n" +
      "🔎 .bul\nŞarkıyı tanır.\n\n" +
      "🖼️ .görsel\nGörsel arar.\n\n" +
      "⬆️ .upload\nURL'den medya indirir.\n\n" +
      "📂 .belge\nMedyayı belgeye çevirir.\n\n" +
      "📄 .pdf\nPDF oluşturur.\n\n" +
      "🖼️ .çıkartma\nSticker oluşturur.\n\n" +
      "🎵 .mp3\nSes çıkarır.\n\n" +
      "🐢 .slow\nMüziği yavaşlatır.\n\n" +
      "⚡ .sped\nMüziği hızlandırır.\n\n" +
      "🔊 .basartır\nBass ayarları.\n\n" +
      "🏞️ .foto\nStickerı fotoğraf yapar.\n\n" +
      "✨ .yazıçıkartma\nMetinden sticker yapar.\n\n" +
      "🎞️ .mp4\nStickerı video yapar.\n\n" +
      "👀 .vv\nView-once medyayı gösterir.\n\n" +
      "✂️ .trim\nMedyayı keser.\n\n" +
      "⚫ .siyahvideo\nSiyah video yapar.\n\n" +
      "🎬 .birleştir\nMedya birleştirir.\n\n" +
      "🎥 .vmix\nVideo birleştirir.\n\n" +
      "🐌 .ağırçekim\nAğır çekim efekti.\n\n" +
      "⚙️ .interp\nFPS artırır.\n\n" +
      "🔄 .döndür\nVideoyu döndürür.\n\n" +
      "🔀 .flip\nVideoyu ters çevirir.\n\n" +
      "⭕ .oval\nDaire yapar.\n\n" +
      "📽️ .gif\nVideoyu GIF yapar.\n\n" +
      "🖼️ .ss\nEkran görüntüsü alır.\n\n" +
      "⏫ .url\nGörseli yükler.\n\n" +
      "🎨 .renklendir\nMedyayı renklendirir.\n\n" +
      "💻 .kodgörsel\nKoddan görsel yapar.\n\n" +
      "😂 .meme\nMeme oluşturur.\n\n" +
      "📐 .square\nKare yapar.\n\n" +
      "📏 .resize\nBoyutlandırır.\n\n" +
      "🗜️ .sıkıştır\nSıkıştırır.\n\n" +
      "🎵 .tts\nMetni sese çevirir.\n\n" +
      "🎬 .ytses\nYouTube'dan ses indirir.\n\n" +
      "🔎 .ytara\nYouTube kanal bilgisi.\n\n" +
      "🎞️ .mp4\nVideoya çevirir.\n\n" +
      "⏫ .url\nGörseli yükler.\n"
    );
    return;
  }

  // Eğer 'lar' değilse ama yine de bir argüman varsa detay göster
  if (arg) {
    const commandDetails = retrieveCommandDetails(arg);
    if (!commandDetails) {
      return await m.sendReply(
        `_❌ '${arg}' komutu bulunamadı. Komut listesine bakmak için *.komut lar* yazın._`
      );
    }

    let infoMessage = `*📋 ───「 Komut Detayları 」───*\n\n`;
    infoMessage += `• *Komut:* \`${commandDetails.name}\`\n`;
    infoMessage += `• *Açıklama:* ${commandDetails.desc || "Yok"}\n`;
    infoMessage += `• *Sahibi:* ${commandDetails.fromMe ? "Bot Sahibi" : "Herkes"}\n`;
    if (commandDetails.use) infoMessage += `• *Tür:* ${commandDetails.use}\n`;
    if (commandDetails.usage)
      infoMessage += `• *Kullanım:* ${commandDetails.usage}\n`;
    if (commandDetails.warn)
      infoMessage += `• *Uyarı:* ${commandDetails.warn}\n`;

    return await m.sendReply(infoMessage);
  }

  // Hiçbir şey yazılmamışsa kullanım hatırlatıcısı ver
  await m.sendReply(
    "*💬 Kullanım:* \n\n" +
    "• *.komutlar* - Tüm komut listesini gösterir.\n" +
    "• *.komut <isim>* - Belirli bir komutun detaylarını gösterir.\n" +
    "_Örnek: .komut spotify_"
  );
});
