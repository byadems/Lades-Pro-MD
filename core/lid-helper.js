"use strict";

const { logger } = require("../config");
const config = require("../config");

/**
 * Rakamları ayrıştırır
 */
function getNumericalIdLocal(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * 1. Raganork-MD Yöntemi: Bot başlarken SUDO numaralarını LID'ye çevirip SUDO_MAP'e kaydetme.
 * Baileys signalRepository'i kullanarak JID'den LID bulur.
 */
async function migrateSudoToLID(client) {
  const sudoNumbers = (config.SUDO || "").split(',').map(n => getNumericalIdLocal(n)).filter(n => n);
  const ownerNumber = getNumericalIdLocal(config.OWNER_NUMBER);
  
  const allNumbers = [...new Set([...sudoNumbers, ownerNumber])].filter(n => n && n !== "905XXXXXXXXX");
  
  if (allNumbers.length > 0) {
    try {
      let sudoMap = [];
      if (config.SUDO_MAP) {
        try {
          sudoMap = JSON.parse(config.SUDO_MAP);
          if (!Array.isArray(sudoMap)) sudoMap = [];
        } catch (e) {
          sudoMap = [];
        }
      }

      let updated = false;
      logger.info(`[LID Helper] ${allNumbers.length} adet yetkili numara LID kontrolünden geçiriliyor...`);
      
      for (const phone of allNumbers) {
        try {
          const jid = `${phone}@s.whatsapp.net`;
          
          // 1. Try Baileys mapping
          if (client.signalRepository && client.signalRepository.lidMapping) {
             const lid = await client.signalRepository.lidMapping.getLIDForPN(jid);
             if (lid && !sudoMap.includes(lid)) {
               sudoMap.push(lid);
               logger.info(`[LID Helper] Eşleşme bulundu (Mapping): ${phone} -> ${lid}`);
               updated = true;
             }
          }
          
          // 2. Try contact store if mapping fails
          if (!updated && client.store && client.store.contacts) {
            const contact = client.store.contacts[jid];
            if (contact && contact.lid && !sudoMap.includes(contact.lid)) {
              sudoMap.push(contact.lid);
              logger.info(`[LID Helper] Eşleşme bulundu (Contact): ${phone} -> ${contact.lid}`);
              updated = true;
            }
          }
        } catch (e) {
          logger.debug({ err: e.message }, `[LID Helper] ${phone} için LID çözümlenemedi.`);
        }
      }
      
      if (updated) {
        config.SUDO_MAP = JSON.stringify(sudoMap);
        process.env.SUDO_MAP = config.SUDO_MAP;
        
        // Veritabanına kaydet
        try {
          const { BotVariable } = require("./database");
          if (BotVariable) {
            await BotVariable.upsert({
              key: 'SUDO_MAP',
              value: config.SUDO_MAP
            });
          }
        } catch (dbErr) {
          logger.warn("[LID Helper] SUDO_MAP veritabanına kaydedilemedi.");
        }
        logger.info(`[LID Helper] SUDO_MAP başarıyla güncellendi. Toplam yetkili LID: ${sudoMap.length}`);
      }
    } catch (error) {
      logger.error({ err: error.message }, '[LID Helper] SUDO to LID migration error');
    }
  }
}

/**
 * 2. KnightBot-Mini Yöntemi: Gelen LID mesajını anlık olarak AuthState üzerinden Telefon Numarasına (PN) çevirme.
 */
async function resolveLidToPn(client, lidJid) {
  if (!lidJid || !lidJid.includes('@lid')) return lidJid;
  
  try {
    if (client.signalRepository && client.signalRepository.lidMapping) {
      const pnJid = await client.signalRepository.lidMapping.getPNForLID(lidJid);
      if (pnJid) {
        return pnJid; // e.g. "905...:1@s.whatsapp.net"
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, `[LID Helper] LID -> PN çözümlenemedi: ${lidJid}`);
  }
  return lidJid;
}

module.exports = {
  migrateSudoToLID,
  resolveLidToPn,
  getNumericalIdLocal
};