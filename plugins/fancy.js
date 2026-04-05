const { Module } = require('../main');
const { fancy } = require('./utils');

Module({
    pattern: 'fancy ?(.*)',
    fromMe: false,
    use: 'edit',
    desc: 'Süslü metin yazı tipleri oluşturur'
  },
  async (message, match) => {
  const input = (match[1] || "").trim();
  const replyText = message.reply_message?.text;

  // Eğer girdi yoksa ve yanıtlanan mesaj da yoksa liste gönder
  if (!input && !replyText) {
    return await message.sendReply(
      "_*💬 Bir metni yanıtlayıp sayısal kodu belirtin veya direkt yazın.* Örnek:_\n\n" +
      "- `.fancy 10 Merhaba`\n" +
      "- `.fancy Merhaba dünya`\n" +
      String.fromCharCode(8206).repeat(4001) +
      fancy.list('Örnek metin', fancy)
    );
  }

  // Sayısal kodu ayıkla
  const idMatch = input.match(/^(\d+)\s*/);
  const id = idMatch ? parseInt(idMatch[1]) : null;
  const text = idMatch ? input.replace(idMatch[0], "") : input;
  const finalContent = replyText || text;

  try {
    if (!id || id > 33 || id < 1) {
      // ID yoksa veya geçersizse tüm listeyi göster
      return await message.sendReply(fancy.list(finalContent || "Lades-Pro", fancy));
    }
    // Seçili stili uygula
    const style = fancy[id - 1];
    if (!style) throw new Error();
    return await message.sendReply(fancy.apply(style, finalContent));
  } catch (e) {
    return await message.sendReply('_❌ Belirtilen stil uygulanamadı veya bulunamadı!_');
  }
});