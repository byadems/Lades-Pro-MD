const { Sequelize } = require('sequelize');

module.exports = {
  up: async ({ context: queryInterface }) => {
    const migrations = [
      { old: 'whatsapp_sessions', new: 'whatsapp_oturumlar' },
      { old: 'bot_config', new: 'bot_ayarlar' },
      { old: 'group_settings', new: 'grup_ayarlar' },
      { old: 'user_data', new: 'kullanici_veriler' },
      { old: 'warn_logs', new: 'uyari_kayitlar' },
      { old: 'filters', new: 'filtreler' },
      { old: 'schedules', new: 'zamanlamalar' },
      { old: 'external_plugins', new: 'harici_eklentiler' },
      { old: 'ai_commands', new: 'yapay_zeka_komutlar' },
      { old: 'message_stats', new: 'mesaj_istatistikler' },
      { old: 'bot_metrics', new: 'bot_metrikler' },
      { old: 'command_stats', new: 'komut_istatistikler' },
      { old: 'command_registry', new: 'komut_kayitlar' }
    ];

    for (const table of migrations) {
      try {
        const tableExists = await queryInterface.tableExists(table.old);
        if (tableExists) {
          await queryInterface.renameTable(table.old, table.new);
          console.log(`[GOÇ] ${table.old} -> ${table.new} olarak yeniden adlandırıldı.`);
        }
      } catch (err) {
        console.error(`[GOÇ HATA] ${table.old} taşınırken hata oluştu:`, err.message);
      }
    }
  },
  down: async ({ context: queryInterface }) => {
    // Reverse logic if needed
  }
};
