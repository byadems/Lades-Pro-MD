const { Module } = require('../main');
const moment = require('moment-timezone');

moment.locale('tr');

const yks = 'YKS (TYT/AYT/YDT) sınavlarına kalan süreyi veya tercih tarihlerini gösterir.';
const msu = 'MSÜ sınavına kalan süreyi gösterir.';
const kpss = 'KPSS (Lisans/Önlisans/Ortaöğretim/E-KPSS) sınavlarına kalan süreyi gösterir.';
const okul = 'Okulların kapanmasına, ara tatillere veya yeni döneme kalan süreyi gösterir.';
const oruc = 'Ramazan ayının başlangıcına veya bitişine kalan süreyi gösterir.';

function calculateTime(futureTime) {
  const future = moment(futureTime, 'YYYY-MM-DD HH:mm:ss');
  const now = moment();
  const diff = future.diff(now);

  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

  const duration = moment.duration(diff);

  return {
    days: Math.floor(duration.asDays()),
    hours: duration.hours(),
    minutes: duration.minutes(),
    seconds: duration.seconds(),
  };
}

function findClosestDate(dates) {
  const now = moment();
  let closestDate = null;
  let minDiff = Infinity;

  dates.forEach((dateObj) => {
    const date = moment(dateObj.date);
    const diff = date.diff(now);

    if (diff >= 0 && diff < minDiff) {
      minDiff = diff;
      closestDate = dateObj;
    }
  });

  return closestDate;
}

Module({
  pattern: 'ykssayaç',
  fromMe: false,
  desc: yks,
  usage: '.ykssayaç',
  use: 'araçlar',
},
  async (m) => {
    const sinavsonuc = '2026-07-22 07:30:00';
    const tercihbaslangic = '2025-07-30 00:00:00';
    const tercihbitis = '2025-08-08 23:59:59';
    const now = moment();

    if (now.isAfter(moment(tercihbitis, 'YYYY-MM-DD HH:mm:ss'))) {
      const time1 = calculateTime('2026-06-20 10:15:00');
      const time2 = calculateTime('2026-06-21 10:15:00');
      const time3 = calculateTime('2026-06-21 15:45:00');

      await m.sendReply(
        `⏳ *TYT* sınavına *${time1.days} gün ${time1.hours} saat ${time1.minutes} dakika ${time1.seconds} saniye* kaldı!\n📅 *20 Haziran 2026 - 10:15*\n\n` +
        `⏳ *AYT* sınavına *${time2.days} gün ${time2.hours} saat ${time2.minutes} dakika ${time2.seconds} saniye* kaldı!\n📅 *21 Haziran 2026 - 10:15*\n\n` +
        `⏳ *YDT* sınavına *${time3.days} gün ${time3.hours} saat ${time3.minutes} dakika ${time3.seconds} saniye* kaldı!\n📅 *21 Haziran 2026 - 15:45*`
      );
    } else if (now.isBefore(moment(sinavsonuc, 'YYYY-MM-DD HH:mm:ss'))) {
      const timeToResults = calculateTime(sinavsonuc);
      await m.sendReply(
        `👀 YKS sonuçlarının açıklanmasına *${timeToResults.days} gün ${timeToResults.hours} saat ${timeToResults.minutes} dakika ${timeToResults.seconds} saniye* kaldı!\n📅 *22 Temmuz 2025 - 07:30*`
      );
    } else if (now.isBefore(moment(tercihbaslangic, 'YYYY-MM-DD HH:mm:ss'))) {
      const timeToPreferences = calculateTime(tercihbaslangic);
      await m.sendReply(
        `🎓 YKS tercihlerinin başlamasına *${timeToPreferences.days} gün ${timeToPreferences.hours} saat ${timeToPreferences.minutes} dakika ${timeToPreferences.seconds} saniye* kaldı!\n📅 *31 Temmuz 2025*`
      );
    } else if (now.isBefore(moment(tercihbitis, 'YYYY-MM-DD HH:mm:ss'))) {
      const timeToEnd = calculateTime(tercihbitis);
      await m.sendReply(
        `⏰ YKS tercihlerinin bitmesine *${timeToEnd.days} gün ${timeToEnd.hours} saat ${timeToEnd.minutes} dakika ${timeToEnd.seconds} saniye* kaldı!\n📅 *8 Ağustos 2025 - 23:59*`
      );
    } else {
      const time1 = calculateTime('2026-06-20 10:15:00');
      await m.sendReply(
        `🆕 2026 YKS süreci başladı!\n⏳ *TYT* sınavına ${time1.days} gün kaldı.\n📅 *20 Haziran 2026 - 10:15*`
      );
    }
  }
);

Module({
  pattern: 'kpsssayaç',
  fromMe: false,
  desc: kpss,
  usage: '.kpsssayaç',
  use: 'araçlar',
},
  async (m) => {
    const lisans = calculateTime('2026-09-06 10:15:00');
    const onlisans = calculateTime('2026-10-04 10:15:00');
    const ortaogretim = calculateTime('2026-10-25 10:15:00');
    const ekpss = calculateTime('2026-04-19 10:15:00');
    await m.sendReply(
      `_(TAHMİNİ)_\n⏳ KPSS *(Lisans)* sınavına *${lisans.days} gün ${lisans.hours} saat ${lisans.minutes} dakika ${lisans.seconds} saniye* kaldı!\n📅 *26 Temmuz 2026 - 10:15*\n\n⏳ KPSS *(Önlisans)* sınavına *${onlisans.days} gün ${onlisans.hours} saat ${onlisans.minutes} dakika ${onlisans.seconds} saniye* kaldı!\n📅 *4 Ekim 2026 - 10:15*\n\n⏳ KPSS *(Ortaöğretim)* sınavına *${ortaogretim.days} gün ${ortaogretim.hours} saat ${ortaogretim.minutes} dakika ${ortaogretim.seconds} saniye* kaldı!\n📅 *25 Ekim 2026 - 10:15*\n\n⏳ *E-KPSS* sınavına *${ekpss.days} gün ${ekpss.hours} saat ${ekpss.minutes} dakika ${ekpss.seconds} saniye* kaldı!\n📅 *19 Nisan 2026 - 10:15*`
    );
  }
);

Module({
  pattern: 'msüsayaç',
  fromMe: false,
  desc: msu,
  usage: '.msüsayaç',
  use: 'araçlar',
},
  async (m) => {
    const targetDate = moment('2026-03-01 10:15:00');
    const now = moment();

    if (now.isAfter(targetDate)) {
      await m.sendReply(
        `❗ *OPS! MSÜ sınavı bu yıl için tamamlandı.* ✅\n📅 *1 Mart 2026 - 10:15*`
      );
    } else {
      const time = calculateTime(targetDate);
      await m.sendReply(
        `⏳ *MSÜ* sınavına *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds}* saniye kaldı!\n📅 *1 Mart 2026 - 10:15*`
      );
    }
  }
);

Module({
  pattern: 'okulsayaç',
  fromMe: false,
  desc: okul,
  usage: '.okulsayaç',
  use: 'araçlar',
},
  async (m) => {
    const schoolDates = [
      { date: '2025-11-10 08:00:00', label: '1. Dönem ara tatili' },
      { date: '2026-01-19 08:00:00', label: 'Yarıyıl tatili' },
      { date: '2026-03-16 08:00:00', label: '2. Dönem ara tatili' },
      { date: '2026-06-26 08:00:00', label: 'Yaz Tatili' },
    ];
    let closestDateObj = findClosestDate(schoolDates);
    if (!closestDateObj) {
      closestDateObj = {
        date: '2025-09-08 08:00:00',
        label: 'Okulların açılışı',
      };
    }

    const time = calculateTime(closestDateObj.date);
    const formattedDate = moment(closestDateObj.date).format('DD MMMM YYYY - dddd');

    await m.sendReply(
      `🧐 En yakın tarih: *${closestDateObj.label}*\n⏳ ${closestDateObj.label === 'Okulların açılışı'
        ? 'Okulların açılmasına'
        : 'Okulların kapanmasına'
      } *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds}* saniye kaldı! 🥳\n📅 *${formattedDate}*`
    );
  }
);

Module({
  pattern: 'ramazansayaç',
  fromMe: false,
  desc: oruc,
  usage: '.ramazansayaç',
  use: 'araçlar',
},
  async (m) => {
    const ramazanStart = '2026-02-19 02:23:00';
    const ramazanEnd = '2026-03-19 19:30:00';
    const now = moment();

    if (now.isBetween(moment(ramazanStart), moment(ramazanEnd))) {
      const time = calculateTime(ramazanEnd);
      await m.sendReply(
        `⏳ Ramazan ayının bitmesine *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds} saniye* kaldı! 🥲\n📅 *19 Mart 2026 - Perşembe*`
      );
    } else if (now.isBefore(moment(ramazanStart))) {
      const time = calculateTime(ramazanStart);
      await m.sendReply(
        `⏳ Ramazan ayına girmemize *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds} saniye* kaldı! 😍\n📅 *19 Şubat 2026 - Perşembe*`
      );
    }
  }
);

