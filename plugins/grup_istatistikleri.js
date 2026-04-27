"use strict";

/**
 * plugins/grup_istatistikleri.js
 * Günlük grup mesaj istatistikleri komutları.
 *   .grupistatistikleri — Bugünkü en aktif 5 üye + toplam mesaj
 *   .aktivitem          — Kişisel sıralama, mesaj sayısı ve yüzde
 */

(function () {
  const { Module } = require("../main");
  const { getGroupStats, getTotalToday, getUserStats } = require("./utils/grupstat");

  // JID'den okunabilir numara üret: "905551234567@s.whatsapp.net" → "5551234567"
  function jidToNum(jid = "") {
    const bare = jid.split("@")[0].split(":")[0];
    // Türkiye (+90) ön ekini kaldır, yoksa olduğu gibi bırak
    return bare.startsWith("90") && bare.length > 10
      ? bare.slice(2)
      : bare;
  }

  // groupMetadata üzerinden katılımcı push-name'i bulmaya çalış
  async function resolveNames(client, groupJid, jids) {
    const result = {};
    try {
      const meta = await client.groupMetadata(groupJid);
      const participantMap = new Map(
        (meta.participants || []).map((p) => [p.id, p])
      );
      for (const jid of jids) {
        const p = participantMap.get(jid);
        result[jid] = (p && p.name) ? p.name : `+${jidToNum(jid)}`;
      }
    } catch {
      for (const jid of jids) result[jid] = `+${jidToNum(jid)}`;
    }
    return result;
  }

  // ──────────────────────────────────────────────────────────
  //  .grupistatistikleri
  //  Bugünün en aktif 5 üyesini ve toplam mesaj sayısını göster
  // ──────────────────────────────────────────────────────────
  Module(
    {
      pattern: "grupistatistikleri",
      fromMe: false,
      desc: "Grubun bugünkü en aktif 5 üyesini ve toplam mesaj sayısını gösterir.",
      usage: ".grupistatistikleri",
      use: "grup",
    },
    async (message) => {
      if (!message.jid.endsWith("@g.us")) {
        return await message.sendReply("❌ Bu komut yalnızca gruplarda kullanılabilir.");
      }

      const groupJid = message.jid;
      const statsMap = getGroupStats(groupJid);
      const total = getTotalToday(groupJid);

      if (total === 0) {
        return await message.sendReply(
          "📊 *Grup İstatistikleri*\n\n_Bugün için henüz kayıtlı mesaj yok._\n_Bot yeniden başlatıldıktan veya bugünkü ilk mesajdan itibaren sayım başlar._"
        );
      }

      // Sıralama — azalan mesaj sayısına göre, en fazla 5
      const sorted = [...statsMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const names = await resolveNames(message.client, groupJid, sorted.map(([jid]) => jid));

      const MADALYALAR = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
      let liste = "";
      sorted.forEach(([jid, count], i) => {
        const ad = names[jid] || `+${jidToNum(jid)}`;
        const yuzde = ((count / total) * 100).toFixed(1);
        liste += `${MADALYALAR[i]} *${ad}* — ${count} mesaj (%${yuzde})\n`;
      });

      const bugun = new Date().toLocaleDateString("tr-TR", {
        day: "2-digit", month: "long", year: "numeric",
      });

      return await message.sendReply(
        `📊 *Grup İstatistikleri — Bugün*\n` +
        `📅 _${bugun}_\n` +
        `💬 *Toplam Mesaj:* ${total}\n` +
        `👥 *Aktif Üye:* ${statsMap.size}\n\n` +
        `🏆 *En Aktif 5 Üye:*\n${liste}`
      );
    }
  );

  // ──────────────────────────────────────────────────────────
  //  .aktivitem
  //  Kişinin bugünkü sıralaması, mesaj sayısı ve yüzdesi
  // ──────────────────────────────────────────────────────────
  Module(
    {
      pattern: "aktivitem",
      fromMe: false,
      desc: "Bugünkü kişisel mesaj sıralamanızı ve aktivite yüzdenizi gösterir.",
      usage: ".aktivitem",
      use: "grup",
    },
    async (message) => {
      if (!message.jid.endsWith("@g.us")) {
        return await message.sendReply("❌ Bu komut yalnızca gruplarda kullanılabilir.");
      }

      const groupJid  = message.jid;
      const userJid   = message.sender;
      const { count, rank, total, totalUsers } = getUserStats(groupJid, userJid);

      if (total === 0) {
        return await message.sendReply(
          "📈 *Aktivitem*\n\n_Bugün için henüz kayıtlı mesaj yok._\n_Bot yeniden başlatıldıktan veya bugünkü ilk mesajdan itibaren sayım başlar._"
        );
      }

      if (count === 0) {
        return await message.sendReply(
          `📈 *Aktivitem*\n\n_Bugün henüz mesaj göndermemişsiniz._\n_Grupta aktif ol ve sıralamaya gir! 💬_`
        );
      }

      const yuzde  = ((count / total) * 100).toFixed(1);
      const bugun  = new Date().toLocaleDateString("tr-TR", {
        day: "2-digit", month: "long", year: "numeric",
      });

      // Sıralamaya göre emoji
      const rankEmoji =
        rank === 1 ? "🥇" :
        rank === 2 ? "🥈" :
        rank === 3 ? "🥉" : "📊";

      return await message.sendReply(
        `📈 *Bugünkü Aktivitem*\n` +
        `📅 _${bugun}_\n\n` +
        `${rankEmoji} *Sıralama:* ${rank}. / ${totalUsers} kişi\n` +
        `💬 *Mesaj Sayısı:* ${count}\n` +
        `📊 *Aktivite Payı:* %${yuzde}\n` +
        `🔢 *Gruptaki Toplam Mesaj:* ${total}`
      );
    }
  );
})();
