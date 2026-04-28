"use strict";

/**
 * core/auth.js
 * WhatsApp authentication - QR code and Pair Code support.
 * Uses @whiskeysockets/baileys useMultiFileAuthState for local
 * or stores session in DB for cloud deployments.
 */

const path = require("path");
const fs = require("fs");
const qrcodeTerminal = require("qrcode-terminal");
const { loadBaileys } = require("./yardimcilar");
const { WhatsappOturum } = require("./database");
const { logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  DB-backed auth state (for cloud / PostgreSQL deployments)
// ─────────────────────────────────────────────────────────
async function useDbAuthState(sessionId) {
  const { makeCacheableSignalKeyStore, BufferJSON } = await loadBaileys();
  const { WhatsappOturum } = require("./database");

  // ── Deep Buffer Reviver: DB'den JSON olarak okunan Buffer'ları geri çevir ──
  const deepRevive = (obj) => {
    if (obj && typeof obj === 'object') {
      if (obj.type === 'Buffer' && (typeof obj.data === 'string' || Array.isArray(obj.data))) {
        return Buffer.from(obj.data, typeof obj.data === 'string' ? "base64" : undefined);
      }
      for (const k in obj) obj[k] = deepRevive(obj[k]);
    }
    return obj;
  };

  let creds = {};

  // ── İlk Başlatma ve Migrasyon (Tek Satırlık Eski Session -> Yeni Parçalı Yapı) ──
  try {
    const sessionRow = await WhatsappOturum.findByPk(sessionId);
    if (sessionRow && sessionRow.sessionData) {
      const data = typeof sessionRow.sessionData === 'string' ? JSON.parse(sessionRow.sessionData) : sessionRow.sessionData;
      const revived = deepRevive(data);

      if (revived.keys && Object.keys(revived.keys).length > 0) {
        logger.info(`[Auth] Eski tip monolitik session tespit edildi (${sessionId}). Parçalanarak veritabanına işleniyor (Migrasyon)...`);
        creds = revived.creds || {};
        
        const promises = [];
        for (const category in revived.keys) {
          for (const id in revived.keys[category]) {
            const keyId = `${sessionId}:${category}:${id}`;
            const val = JSON.stringify(revived.keys[category][id], BufferJSON.replacer);
            promises.push(WhatsappOturum.upsert({ sessionId: keyId, sessionData: val }).catch(() => {}));
          }
        }
        await Promise.all(promises);
        
        // Ana satırı sadece creds içerecek şekilde güncelle
        await WhatsappOturum.upsert({ sessionId, sessionData: JSON.stringify({ creds }, BufferJSON.replacer) });
        logger.info(`[Auth] Migrasyon tamamlandı. ${promises.length} adet anahtar ayrıldı.`);
      } else {
        creds = revived.creds || revived || {};
      }
    }
  } catch (e) {
    logger.warn(`[Auth] Session yükleme hatası: ${e.message}`);
  }

  // ── KRİTİK: Signal Key Yokluğu Kontrolü (Zombie State Önlemi) ──────────────
  // Creds var (telefon eşleştirilmiş) ama Signal key'leri DB'de yok ise
  // bot bağlanır ama mesaj ALAMAz → zombie state. Bu durumu başlangıçta
  // tespit edip oturumu tamamen sıfırlıyoruz (yeniden QR/pair gerekecek).
  // ─────────────────────────────────────────────────────────────────────────────
  if (creds && creds.me) {
    try {
      const { Op } = require('sequelize');
      const keyRowCount = await WhatsappOturum.count({
        where: { sessionId: { [Op.like]: `${sessionId}:%` } }
      });
      if (keyRowCount === 0) {
        logger.error(
          `[Auth] ⚠️  KRİTİK UYARI: Creds mevcut (${creds.me.id}) ` +
          `ama Signal key'leri DB'de SIFIR! Bu zombie state'e yol açar. ` +
          `Oturum tamamen sıfırlanıyor → yeniden eşleştirme gerekecek.`
        );
        // clearState tanımlanmadan önce çağrılıyor — inline temizle
        await WhatsappOturum.destroy({ where: { sessionId: { [Op.like]: `${sessionId}%` } } });
        creds = {};
        logger.info(`[Auth] Oturum sıfırlandı. Dashboard üzerinden yeniden eşleştirin.`);
      } else {
        logger.info(`[Auth] Sağlık kontrolü: ${keyRowCount} signal key bulundu ✓`);
      }
    } catch (e) {
      logger.warn(`[Auth] Signal key kontrol hatası (devam ediliyor): ${e.message}`);
    }
  }

  let isSaving = false;
  let saveRequested = false;

  const saveCreds = async () => {
    saveRequested = true;
    if (isSaving) return;
    isSaving = true;

    while (saveRequested) {
      saveRequested = false;
      try {
        const sessionData = JSON.stringify({ creds }, BufferJSON.replacer);
        await WhatsappOturum.upsert({ sessionId, sessionData });
      } catch (err) {
        logger.error({ err: err.message, sessionId }, "[Auth] Kimlik bilgileri kayıt hatası");
      }
    }
    isSaving = false;
  };

  const keys = makeCacheableSignalKeyStore({
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const keyId = `${sessionId}:${type}:${id}`;
        try {
          const row = await WhatsappOturum.findByPk(keyId);
          if (row && row.sessionData) {
            data[id] = JSON.parse(row.sessionData, BufferJSON.reviver);
          }
        } catch (e) {
          logger.warn(`[Auth] Key okuma hatası (${keyId}): ${e.message}`);
        }
      }
      return data;
    },
    set: async (data) => {
      const retryDelay = (ms) => new Promise(r => setTimeout(r, ms));
      for (const category in data) {
        for (const id in data[category]) {
          const val = data[category][id];
          const keyId = `${sessionId}:${category}:${id}`;
          let saved = false;
          for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
            try {
              if (val) {
                await WhatsappOturum.upsert({ sessionId: keyId, sessionData: JSON.stringify(val, BufferJSON.replacer) });
              } else {
                await WhatsappOturum.destroy({ where: { sessionId: keyId } });
              }
              saved = true;
            } catch (e) {
              if (attempt < 3) {
                await retryDelay(attempt * 500); // 500ms, 1000ms
              } else {
                logger.warn(`[Auth] Key yazma başarısız (3 deneme) (${keyId}): ${e.message}`);
              }
            }
          }
        }
      }
    },
  }, logger.child({ module: "signal", level: "error" }));

  const clearState = async () => {
    try {
      const { Op } = require("sequelize");
      await WhatsappOturum.destroy({ where: { sessionId: { [Op.like]: `${sessionId}%` } } });
      creds = {};
      logger.info(`[Auth] Session ${sessionId} ve ona bağlı tüm anahtarlar temizlendi.`);
    } catch (e) {
      logger.warn({ err: e.message }, "[Auth] clearState başarısız");
    }
  };

  const clearSessions = async () => {
    try {
      const { Op } = require("sequelize");
      // Sadece P2P şifre oturumlarını temizle, grup senderKey'leri ASLA silme!
      // senderKey'leri silmek kalıcı decryption hatasına ve mesajların çözülememesine neden olur.
      await WhatsappOturum.destroy({ 
        where: { 
          sessionId: { [Op.like]: `${sessionId}:session:%` } 
        } 
      });
      logger.info(`[Auth] Oturum onarımı: Sadece p2p session verileri temizlendi. Grup şifreleri (senderKey) korundu.`);
    } catch (e) {
      logger.warn({ err: e.message }, "[Auth] clearSessions başarısız");
    }
  };

  return { state: { creds, keys }, saveCreds, clearState, clearSessions };
}

// ─────────────────────────────────────────────────────────
//  Session string (base64) auth state - for cloud deploy
// ─────────────────────────────────────────────────────────
async function useSessionStringAuthState(sessionString) {
  const { makeCacheableSignalKeyStore, BufferJSON } = await loadBaileys();

  let state;
  try {
    const decoded = Buffer.from(sessionString, "base64").toString("utf-8");
    state = JSON.parse(decoded, BufferJSON.revive);
  } catch {
    state = {};
  }

  const saveCreds = async () => {
    try {
      const b64 = Buffer.from(JSON.stringify({ creds: state.creds, keys: state.keys }, BufferJSON.replacer)).toString("base64");
      process.env.SESSION = b64;
    } catch { }
  };

  const keys = makeCacheableSignalKeyStore({
    get: async (type, ids) => {
      const data = {};
      const stored = state.keys || {};
      for (const id of ids) {
        const val = stored[type] && stored[type][id];
        if (val) data[id] = val;
      }
      return data;
    },
    set: async (data) => {
      const stored = state.keys || {};
      for (const category in data) {
        stored[category] = stored[category] || {};
        for (const id in data[category]) {
          if (data[category][id]) stored[category][id] = data[category][id];
          else delete stored[category][id];
        }
      }
      state.keys = stored;
    },
  }, logger.child({ module: "signal", level: "error" }));

  const clearSessions = async () => {
    try {
      if (state.keys.session) delete state.keys.session;
      if (state.keys.senderKey) delete state.keys.senderKey;
      if (state.keys.senderKeyMemory) delete state.keys.senderKeyMemory;
      logger.info(`[Auth] Oturum onarımı: session ve senderKey verileri temizlendi.`);
      await saveCreds();
    } catch (e) { }
  };

  return { state: { creds: state.creds || {}, keys }, saveCreds, clearState: async () => { }, clearSessions };
}

// ─────────────────────────────────────────────────────────
//  Get auth state - pick method based on config
// ─────────────────────────────────────────────────────────
async function getAuthState(config, sessionId = "lades-session") {
  const sessionPath = path.join(__dirname, "..", "sessions", sessionId);
  const credsFile = path.join(sessionPath, "creds.json");

  // ════════════════════════════════════════════════════════
  //  ADIM 1: SESSION env varsa bootstrap yap + DB üzerinden çalış
  // ════════════════════════════════════════════════════════
  //  SORUN: SESSION env'den creds.json oluşturup useMultiFileAuthState
  //  kullansaydık, saveCreds() sadece DOSYAYA yazardı. Northflank
  //  restart sonrası dosya silinince SESSION env'deki STALE veri yeniden
  //  yüklenir → WA handshake'ten alınan güncel keyler KAYBOLUR → bot bağlanmaz.
  //
  //  ÇÖZÜM: SESSION env varsa bootstrap sonrası DOĞRUDAN useDbAuthState kullan.
  //  Bu sayede saveCreds() her zaman DB'yi günceller. Bir sonraki restart'ta
  //  DB'deki güncel oturum kullanılır — SESSION env artık sadece ilk kurulum içindir.
  // ════════════════════════════════════════════════════════
  const hasSessionEnv = !!(
    config.SESSION &&
    config.SESSION.length > 20 &&
    !config.SESSION.startsWith("path:")
  );

  if (hasSessionEnv) {
    logger.info("[SESSION] Ortam değişkeni algılandı → DB önyükleme başlatılıyor...");
    try {
      let b64 = config.SESSION;
      // Prefix destekleri: KnightBot!, Hermit~, Lades~ vb.
      if (b64.includes("!"))      b64 = b64.split("!").slice(1).join("!");
      else if (b64.includes("~")) b64 = b64.split("~").slice(1).join("~");

      let decoded = "";
      try {
        // Gzip sıkıştırması dene (KnightBot stili)
        const compressed = Buffer.from(b64.replace(/\.\.\.$/g, ""), "base64");
        decoded = require("zlib").gunzipSync(compressed).toString("utf-8");
      } catch {
        // Düz base64
        decoded = Buffer.from(b64, "base64").toString("utf-8");
      }

      const parsed    = JSON.parse(decoded);
      const credsData = parsed.creds || parsed;
      const keysData  = parsed.keys  || {};

      // ── DB'de güncel kayıt var mı? ─────────────────────────────────────
      // Varsa → DB'deki veri SESSION env'den DAHA GÜNCELDİR (WA handshake
      // sırasında güncellendi). SESSION env'i atla, DB'yi kullan.
      // Yoksa → İlk kurulum: SESSION env'den DB'ye aktar.
      const { WhatsappOturum } = require("./database");
      const existing = await WhatsappOturum.findByPk(sessionId).catch(() => null);

      if (!existing || !existing.sessionData) {
        // İlk kurulum: SESSION env → DB
        const sessionData = JSON.stringify({ creds: credsData, keys: keysData });
        await WhatsappOturum.upsert({ sessionId, sessionData });
        logger.info("[SESSION] ✅ İlk kurulum: Oturum DB'ye aktarıldı.");
      } else {
        // DB zaten güncel — SESSION env'i yoksay
        logger.info("[SESSION] ✅ DB'de güncel oturum mevcut, SESSION env atlandı.");
      }

      // Her iki durumda da DB auth state döndür (saveCreds → DB)
      logger.info("[SESSION] DB auth state etkinleştiriliyor (ephemeral-safe mod)...");
      return await useDbAuthState(sessionId);

    } catch (e) {
      logger.warn({ err: e.message }, "[SESSION] Önyükleme hatası, dosya tabanlı auth deneniyor...");
      // Hata durumunda aşağıdaki dosya kontrolüne düş
    }
  }

  // ════════════════════════════════════════════════════════
  //  ADIM 2: SESSION env yoksa yerel dosyaları kontrol et
  //           (Dashboard QR girişi veya yerel geliştirme)
  // ════════════════════════════════════════════════════════
  const possiblePaths = [
    path.join(__dirname, "..", "sessions", "dashboard-auth"),
    path.join(__dirname, "..", "sessions", "lades-session"),
  ];
  if (sessionId !== "lades-session") {
    possiblePaths.push(path.join(__dirname, "..", "sessions", sessionId));
  }

  for (const sp of possiblePaths) {
    const cf = path.join(sp, "creds.json");
    if (!fs.existsSync(cf)) continue;

    logger.info(`Yerel oturum dosyası bulundu: ${sp}`);
    const { useMultiFileAuthState } = await loadBaileys();
    const auth = await useMultiFileAuthState(sp);

    if (!auth.clearState) {
      auth.clearState = async () => {
        try {
          if (fs.existsSync(sp)) {
            fs.rmSync(sp, { recursive: true, force: true });
            logger.info(`Lokal oturum dizini temizlendi: ${sp}`);
          }
        } catch (e) {
          logger.error({ err: e.message }, "Lokal oturum temizleme hatası");
        }
      };
    }

    if (!auth.clearSessions) {
      auth.clearSessions = async () => {
        try {
          const files = fs.readdirSync(sp);
          for (const file of files) {
            if (
              file.startsWith("session-") ||
              file.startsWith("sender-key-") ||
              file.startsWith("sender-key-memory-")
            ) {
              fs.unlinkSync(path.join(sp, file));
            }
          }
          logger.info(`[Auth] Oturum onarımı: session ve senderKey dosyaları temizlendi.`);
        } catch (e) {
          logger.warn({ err: e.message }, "[Auth] clearSessions başarısız");
        }
      };
    }

    return auth;
  }

  // ════════════════════════════════════════════════════════
  //  ADIM 3: Dosya da yoksa DB'ye bak (SQLite / Postgres)
  // ════════════════════════════════════════════════════════
  logger.info(`[${sessionId}] Yerel oturum dosyası bulunamadı → veritabanına bakılıyor...`);
  return await useDbAuthState(sessionId);
}

// ─────────────────────────────────────────────────────────
//  QR Code display
// ─────────────────────────────────────────────────────────
function displayQR(qr) {
  // If we are a child process, notify parent (dashboard)
  if (process.send) {
    process.send({ type: 'qr', qr });
  }
  qrcodeTerminal.generate(qr, { small: true });
  logger.info("Bağlanmak için yukarıdaki QR kodu okutun!");
}

// ─────────────────────────────────────────────────────────
//  Baileys version helper
// ─────────────────────────────────────────────────────────
async function getBaileysVersion() {
  try {
    const { fetchLatestBaileysVersion } = await loadBaileys();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Baileys v${version.join(".")}${isLatest ? " (güncel)" : " (güncel değil)"}`);
    return version;
  } catch {
    return [2, 3000, 1017531287];
  }
}

module.exports = {
  getAuthState, useDbAuthState, useSessionStringAuthState,
  displayQR, getBaileysVersion,
};
