"use strict";

/**
 * Migration: Türkçe Veritabanı Göçü
 * Tüm tablo isimlerini Türkçe eşdeğerleriyle yeniden adlandırır.
 * up()  → İngilizce → Türkçe
 * down() → Türkçe → İngilizce (geri alma)
 *
 * NOT: Her yeniden adlandırma işleminden önce tablonun varlığı kontrol edilir.
 * Bu sayede hem taze kurulumlar hem de mevcut veritabanları güvenle bu migration'ı çalıştırabilir.
 */

// Tablo yeniden adlandırma haritası: [eskiAd, yeniAd]
const TABLO_HARITASI = [
  // ── core/database.js modelleri ─────────────────────────
  ["whatsapp_sessions",   "whatsapp_oturumlari"],
  ["bot_config",          "bot_ayarlari"],
  ["group_settings",      "grup_ayarlari"],
  ["user_data",           "kullanici_verileri"],
  ["warn_logs",           "uyari_kayitlari"],
  ["filters",             "filtreler"],
  ["schedules",           "planlamalar"],
  ["external_plugins",    "harici_moduller"],
  ["ai_commands",         "yz_komutlari"],
  ["message_stats",       "mesaj_istatistikleri"],
  ["bot_metrics",         "bot_metrikleri"],
  ["command_stats",       "komut_istatistikleri"],
  ["command_registry",    "komut_kaydedici"],

  // ── plugins/utils/db/models.js modelleri ───────────────
  // Sequelize model adından otomatik üretilen çoğul tablo adları
  ["_warns",              "_uyarilar"],
  ["fakes",               "antinumara_verileri"],
  ["antilink_configs",    "antibaglanti_ayarlari"],
  ["antilink_config",     "antibaglanti_ayarlari"], // bazı kurulumlarda tekil kalabilir
  ["antispams",           "antispam_verileri"],
  ["pdms",                "pdm_verileri"],
  ["antidemotes",         "antiyetkialma_verileri"],
  ["antipromotes",        "antiyetkiverme_verileri"],
  ["antibots",            "antibot_verileri"],
  ["antiwords",           "antikelime_verileri"],
  ["antideletes",         "antisilme_verileri"],
  ["welcomes",            "karsila_verileri"],
  ["goodbyes",            "elveda_verileri"],
  ["filter",              "filtre_verileri"],   // FilterDB (models.js) — core Filter zaten "filters"
  ["Plugins",             "modul_verileri"],

  // ── plugins/utils/db/schedulers.js modelleri ───────────
  ["automutes",           "otosohbetkapatma_verileri"],
  ["autounmutes",         "otosohbetacma_verileri"],
  ["stickcmds",           "otocikartma_verileri"],
  ["scheduled_messages",  "planlimesaj_verileri"],
];

module.exports = {
  async up({ context: queryInterface }) {
    // Mevcut tablo listesini al
    const mevcutTablolar = await queryInterface.showAllTables();
    const mevcutSet = new Set(mevcutTablolar);

    for (const [eskiAd, yeniAd] of TABLO_HARITASI) {
      // Hem eski isim var hem de yeni isim henüz yok ise yeniden adlandır
      if (mevcutSet.has(eskiAd) && !mevcutSet.has(yeniAd)) {
        try {
          await queryInterface.renameTable(eskiAd, yeniAd);
          console.log(`[Migration] ✅ ${eskiAd} → ${yeniAd}`);
          // Sonraki adımlar için seti güncelle
          mevcutSet.delete(eskiAd);
          mevcutSet.add(yeniAd);
        } catch (err) {
          console.warn(`[Migration] ⚠️ ${eskiAd} yeniden adlandırılamadı: ${err.message}`);
        }
      } else if (mevcutSet.has(yeniAd)) {
        console.log(`[Migration] ⏭️ Atlandı — ${yeniAd} zaten mevcut`);
      } else if (!mevcutSet.has(eskiAd)) {
        console.log(`[Migration] ⏭️ Atlandı — ${eskiAd} tablosu bulunamadı (taze kurulum)`);
      }
    }
  },

  async down({ context: queryInterface }) {
    // Geri alma: Türkçe → İngilizce
    const mevcutTablolar = await queryInterface.showAllTables();
    const mevcutSet = new Set(mevcutTablolar);

    // Ters sırayla geri al
    for (const [eskiAd, yeniAd] of [...TABLO_HARITASI].reverse()) {
      if (mevcutSet.has(yeniAd) && !mevcutSet.has(eskiAd)) {
        try {
          await queryInterface.renameTable(yeniAd, eskiAd);
          console.log(`[Migration:down] ✅ ${yeniAd} → ${eskiAd}`);
          mevcutSet.delete(yeniAd);
          mevcutSet.add(eskiAd);
        } catch (err) {
          console.warn(`[Migration:down] ⚠️ ${yeniAd} geri alınamadı: ${err.message}`);
        }
      }
    }
  },
};
