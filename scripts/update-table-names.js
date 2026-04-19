const fs = require('fs');

let content = fs.readFileSync('c:/Users/Windows/Documents/Visual Studio Code/Yeni/Lades-Pro-MD/core/database.js', 'utf-8');

content = content.replace(/tableName: "whatsapp_sessions"/g, 'tableName: "whatsapp_oturumlar"');
content = content.replace(/tableName: "bot_config"/g, 'tableName: "bot_ayarlar"');
content = content.replace(/tableName: "group_settings"/g, 'tableName: "grup_ayarlar"');
content = content.replace(/tableName: "user_data"/g, 'tableName: "kullanici_veriler"');
content = content.replace(/tableName: "warn_logs"/g, 'tableName: "uyari_kayitlar"');
content = content.replace(/tableName: "filters"/g, 'tableName: "filtreler"');
content = content.replace(/tableName: "schedules"/g, 'tableName: "zamanlamalar"');
content = content.replace(/tableName: "external_plugins"/g, 'tableName: "harici_eklentiler"');
content = content.replace(/tableName: "ai_commands"/g, 'tableName: "yapay_zeka_komutlar"');
content = content.replace(/tableName: "message_stats"/g, 'tableName: "mesaj_istatistikler"');
content = content.replace(/tableName: "bot_metrics"/g, 'tableName: "bot_metrikler"');
content = content.replace(/tableName: "command_stats"/g, 'tableName: "komut_istatistikler"');
content = content.replace(/tableName: "command_registry"/g, 'tableName: "komut_kayitlar"');

fs.writeFileSync('c:/Users/Windows/Documents/Visual Studio Code/Yeni/Lades-Pro-MD/core/database.js', content, 'utf-8');
console.log('Table names updated');
