/**
 * plugins/utils/api-helper.js
 * API isteği yardımcıları ve Türkçe hata tercümanı.
 */

const { withRetry } = require("./resilience");

/**
 * HTTP durum kodlarını kullanıcı dostu Türkçe mesajlara çevirir.
 * @param {number|string} code - HTTP durum kodu
 * @returns {string} Türkçe hata mesajı
 */
function httpStatusTR(code) {
  const map = {
    400: "❌ İstek geçersiz. Lütfen girdiğiniz parametreleri kontrol edin.",
    401: "🔑 Yetkisiz erişim. API anahtarı geçersiz veya süresi dolmuş.",
    403: "🚫 Erişim reddedildi. Bu işlemi yapmaya yetkiniz yok.",
    404: "📭 Kaynak bulunamadı. Aradığınız içeriğe ulaşılamıyor.",
    408: "⏱️ İstek zaman aşımına uğradı. Sunucu çok geç yanıt verdi.",
    422: "⚠️ İşlenemeyen içerik. Parametreleri kontrol edin.",
    429: "🚦 Hız sınırı aşıldı. Lütfen biraz bekleyip tekrar deneyin.",
    500: "🤯 Sunucu içerisinde bir hata oluştu. Daha sonra tekrar deneyin.",
    502: "🌉 Sunucu geçidi hatası. API şu an yanıt veremiyor.",
    503: "🛠️ Hizmet şu an kullanılamıyor. API bakımda olabilir.",
    504: "⏳ Sunucu yanıt verme süresi aşıldı.",
  };
  
  const status = parseInt(code);
  return map[status] || `⚠️ API hatası oluştu (Kod: ${status}).`;
}

/**
 * Bir işlemi retry mekanizmasıyla çalıştırır ve hataları Türkçe'ye çevirir.
 */
async function safeExecute(operation, opts = {}) {
  try {
    return await withRetry(operation, opts);
  } catch (error) {
    // Axios hatası ise status kodundan tercüme yap
    const status = error.response?.status;
    if (status) {
      error.trMessage = httpStatusTR(status);
    } else if (error.code === 'ECONNABORTED') {
      error.trMessage = httpStatusTR(408);
    } else {
      error.trMessage = error.message;
    }
    throw error;
  }
}

module.exports = {
  httpStatusTR,
  safeExecute
};
