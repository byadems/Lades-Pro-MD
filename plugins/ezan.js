const { Module } = require('../main');
const axios = require('axios');
const moment = require('moment-timezone');

const cache = {
  data: {},
  expiry: 6 * 60 * 60 * 1000,
};

async function getPrayerTimes(cityInput, type = 'ezan', date = moment().format('DD.MM.YYYY')) {
  const normalizedCityInput = normalize(cityInput);
  const cityId = cities[normalizedCityInput] || cities[cityInput];

  let cityName = cityCodesToNames[cityInput] || cityCodesToNames[normalizedCityInput] || cityInput;

  if (!cityId) {
    return { error: '❌ *Geçersiz şehir ismi veya plaka!*\n\n- Lütfen geçerli bir şehir veya plaka kodu giriniz.\n💬 *Kullanım:* \`.ezan [şehir/plaka]\`\n👉 *Örnek:* \`.ezan Diyarbakır\` | \`.ezan 21\`' };
  }

  cityName = capitalizeTurkish(cityName);

  const cacheKey = `${cityId}_${type}_${date}`;

  const cachedData = cache.data[cacheKey];
  if (cachedData && moment().diff(cachedData.timestamp) < cache.expiry) {
    return { cityName, today: date, ...cachedData.data };
  }

  // 1. Birincil: eMushaf (Diyanet)
  const emushafUrl = `https://ezanvakti.emushaf.net/vakitler/${cityId}`;
  try {
    const response = await axios.get(emushafUrl, { timeout: 8000 });
    const vakit = response.data.find(vakit => vakit.MiladiTarihKisa === date);
    if (vakit) {
      let data;
      if (type === 'ezan') data = vakit;
      else if (type === 'iftar') data = { Aksam: vakit.Aksam, HicriTarihUzun: vakit.HicriTarihUzun };
      else if (type === 'sahur') data = { Imsak: vakit.Imsak, HicriTarihUzun: vakit.HicriTarihUzun };

      cache.data[cacheKey] = { data: { ...data }, timestamp: moment() };
      return { cityName, today: date, ...data };
    }
  } catch (_) { }

  // 2. Yedek: İmsakiyem (Diyanet)
  try {
    const imsakiyeUrl = `https://ezanvakti.imsakiyem.com/api/prayer-times/${cityId}/daily`;
    const resp = await axios.get(imsakiyeUrl, { timeout: 8000 });
    const dayData = resp.data?.data?.[0];
    if (dayData?.times) {
      const t = dayData.times;
      const h = dayData.hijri_date;
      const vakit = {
        Imsak: t.imsak, Gunes: t.gunes, Ogle: t.ogle,
        Ikindi: t.ikindi, Aksam: t.aksam, Yatsi: t.yatsi,
        MiladiTarihKisa: moment(dayData.date).format('DD.MM.YYYY'),
        HicriTarihUzun: h?.full_date || '',
      };
      let data;
      if (type === 'ezan') data = vakit;
      else if (type === 'iftar') data = { Aksam: vakit.Aksam, HicriTarihUzun: vakit.HicriTarihUzun };
      else if (type === 'sahur') data = { Imsak: vakit.Imsak, HicriTarihUzun: vakit.HicriTarihUzun };

      cache.data[cacheKey] = { data: { ...data }, timestamp: moment() };
      return { cityName, today: date, ...data };
    }
  } catch (_) { }

  // 3. Son yedek: AlAdhan (uluslararası, her zaman çalışır)
  try {
    const aladhanUrl = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(cityName)}&country=Turkey&method=13`;
    const resp = await axios.get(aladhanUrl, { timeout: 8000 });
    const t = resp.data?.data?.timings;
    const d = resp.data?.data?.date;
    if (t) {
      const vakit = {
        Imsak: t.Imsak, Gunes: t.Sunrise, Ogle: t.Dhuhr,
        Ikindi: t.Asr, Aksam: t.Maghrib, Yatsi: t.Isha,
        MiladiTarihKisa: d?.gregorian?.date || date,
        HicriTarihUzun: d?.hijri ? `${d.hijri.day} ${d.hijri.month?.en || ''} ${d.hijri.year}` : '',
      };
      let data;
      if (type === 'ezan') data = vakit;
      else if (type === 'iftar') data = { Aksam: vakit.Aksam, HicriTarihUzun: vakit.HicriTarihUzun };
      else if (type === 'sahur') data = { Imsak: vakit.Imsak, HicriTarihUzun: vakit.HicriTarihUzun };

      cache.data[cacheKey] = { data: { ...data }, timestamp: moment() };
      return { cityName, today: date, ...data };
    }
  } catch (_) { }
 
   return { error: '❌ *Tüm vakit kaynakları başarısız oldu!* _Lütfen daha sonra tekrar deneyiniz._' };
 }

Module({
    pattern: 'ezan ?(.*)',
    fromMe: false,
    use: 'dini',
    desc: "Belirlediğiniz şehrin günlük ezan vakitlerini ve bir sonraki ezana kalan süreyi gösterir.",
    usage: ".ezan [şehir/plaka]",
  },
  async (message, match) => {
  const cityInput = match[1] ? match[1].toUpperCase() : null;
  if (!cityInput) {
    return await message.sendReply('⚠️ *Lütfen bir şehir ismi veya plaka yazınız!*\n\n💬 *Kullanım:* \`.ezan [şehir/plaka]\`\n👉 *Örnek:* \`.ezan Diyarbakır\` | \`.ezan 21\`');
  }

  const { cityName, Imsak, Gunes, Ogle, Ikindi, Aksam, Yatsi, MiladiTarihKisa, HicriTarihUzun, today, error } = await getPrayerTimes(cityInput, 'ezan');
  if (error) {
    return await message.sendReply(error);
  }

  const now = moment();
  const imsakTime = moment(`${today} ${Imsak}`, 'DD.MM.YYYY HH:mm');
  const gunesTime = moment(`${today} ${Gunes}`, 'DD.MM.YYYY HH:mm');
  const ogleTime = moment(`${today} ${Ogle}`, 'DD.MM.YYYY HH:mm');
  const ikindiTime = moment(`${today} ${Ikindi}`, 'DD.MM.YYYY HH:mm');
  const aksamTime = moment(`${today} ${Aksam}`, 'DD.MM.YYYY HH:mm');
  const yatsiTime = moment(`${today} ${Yatsi}`, 'DD.MM.YYYY HH:mm');

  let upcomingPrayerTime = null;
  let prayerName = '';
  if (now.isBefore(imsakTime)) {
    upcomingPrayerTime = imsakTime;
    prayerName = 'İmsak';
  } else if (now.isBefore(gunesTime)) {
    upcomingPrayerTime = gunesTime;
    prayerName = 'Güneş';
  } else if (now.isBefore(ogleTime)) {
    upcomingPrayerTime = ogleTime;
    prayerName = 'Öğle';
  } else if (now.isBefore(ikindiTime)) {
    upcomingPrayerTime = ikindiTime;
    prayerName = 'İkindi';
  } else if (now.isBefore(aksamTime)) {
    upcomingPrayerTime = aksamTime;
    prayerName = 'Akşam';
  } else if (now.isBefore(yatsiTime)) {
    upcomingPrayerTime = yatsiTime;
    prayerName = 'Yatsı';
  } else {
    upcomingPrayerTime = imsakTime.add(1, 'days');
    prayerName = 'İmsak';
  }

  const diffMinutes = upcomingPrayerTime.diff(now, 'minutes');
  const diffHours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;
  const remainingTime = `${diffHours} saat ${remainingMinutes} dakika`;

  await message.send(
    `📍 *${cityName}* İçin Ezan Vakitleri\n\n` +
    `🌒 Hicri: *${HicriTarihUzun}*\n` +
    `📅 Miladi: *${MiladiTarihKisa}*\n\n` +
    `🏙 İmsak: *${Imsak}*\n` +
    `🌅 Güneş: *${Gunes}*\n` +
    `🌇 Öğle: *${Ogle}*\n` +
    `🌆 İkindi: *${Ikindi}*\n` +
    `🌃 Akşam: *${Aksam}*\n` +
    `🌌 Yatsı: *${Yatsi}*\n\n` +
    `🕒 Yaklaşan ezan vakti: *${prayerName} (${remainingTime} kaldı!)*`
  );
});

Module({
    pattern: 'sahur ?(.*)',
    fromMe: false,
    use: 'dini',
    desc: "Belirlediğiniz şehir için sahur vaktine (imsak) ne kadar süre kaldığını hesaplar.",
    usage: ".sahur [şehir/plaka]",
  },
  async (message, match) => {
  const cityInput = match[1] ? match[1].toUpperCase() : null;
  if (!cityInput) {
    return await message.sendReply('⚠️ *Lütfen bir şehir ismi veya plaka yazınız!*\n\n💬 *Kullanım:* \`.sahur [şehir/plaka]\`\n👉 *Örnek:* \`.sahur Diyarbakır\` | \`.sahur 21\`');
  }

  const today = moment().format('DD.MM.YYYY');
  const tomorrow = moment().add(1, 'days').format('DD.MM.YYYY');

  let { cityName, Imsak, today: vakitDate, HicriTarihUzun, error } = await getPrayerTimes(cityInput, 'sahur', today);

  if (error) {
    return await message.sendReply(error);
  }

  const now = moment();
  let imsakTime = moment(`${vakitDate} ${Imsak}`, 'DD.MM.YYYY HH:mm');
  let remaining = moment.duration(imsakTime.diff(now));

  if (remaining.asSeconds() < 0) {
    const tomorrowData = await getPrayerTimes(cityInput, 'sahur', tomorrow);
    if (tomorrowData.error) {
      return await message.sendReply(tomorrowData.error);
    }

    cityName = tomorrowData.cityName;
    Imsak = tomorrowData.Imsak;
    HicriTarihUzun = tomorrowData.HicriTarihUzun;
    vakitDate = tomorrowData.today;

    imsakTime = moment(`${vakitDate} ${Imsak}`, 'DD.MM.YYYY HH:mm');
    remaining = moment.duration(imsakTime.diff(now));
  }

  const hours = Math.floor(remaining.asHours());
  const minutes = Math.floor(remaining.asMinutes()) - hours * 60;

  await message.send(
    `📍 *${cityName}* için sahura *${hours} saat ${minutes} dakika* kaldı. ⏳\n\n` +
    `🌒 Hicri: *${HicriTarihUzun}*\n` +
    `🌙 Sahur Vakti: *${Imsak}*`
  );
});

Module({
    pattern: 'iftar ?(.*)',
    fromMe: false,
    use: 'dini',
    desc: "Belirlediğiniz şehir için iftar vaktine (akşam) ne kadar süre kaldığını hesaplar.",
    usage: ".iftar [şehir/plaka]",
  },
  async (message, match) => {
  const cityInput = match[1] ? match[1].toUpperCase() : null;
  if (!cityInput) {
    return await message.sendReply('⚠️ *Lütfen bir şehir ismi veya plaka yazınız!*\n\n💬 *Kullanım:* \`.iftar [şehir/plaka]\`\n👉 *Örnek:* \`.iftar Diyarbakır\` | \`.iftar 21\`');
  }

  const today = moment().format('DD.MM.YYYY');
  const tomorrow = moment().add(1, 'days').format('DD.MM.YYYY');

  let { cityName, Aksam, today: vakitDate, HicriTarihUzun, error } = await getPrayerTimes(cityInput, 'iftar', today);

  if (error) {
    return await message.sendReply(error);
  }

  const now = moment();
  let aksamTime = moment(`${vakitDate} ${Aksam}`, 'DD.MM.YYYY HH:mm');
  let remaining = moment.duration(aksamTime.diff(now));

  if (remaining.asSeconds() < 0) {
    const tomorrowData = await getPrayerTimes(cityInput, 'iftar', tomorrow);
    if (tomorrowData.error) {
      return await message.sendReply(tomorrowData.error);
    }

    cityName = tomorrowData.cityName;
    Aksam = tomorrowData.Aksam;
    HicriTarihUzun = tomorrowData.HicriTarihUzun;
    vakitDate = tomorrowData.today;

    aksamTime = moment(`${vakitDate} ${Aksam}`, 'DD.MM.YYYY HH:mm');
    remaining = moment.duration(aksamTime.diff(now));
  }

  const hours = Math.floor(remaining.asHours());
  const minutes = Math.floor(remaining.asMinutes()) - hours * 60;

  await message.send(
    `📍 *${cityName}* için iftara *${hours} saat ${minutes} dakika* kaldı. ⏳\n\n` +
    `🌒 Hicri: *${HicriTarihUzun}*\n` +
    `🍽️ İftar Vakti: *${Aksam}*`
  );
});

function normalize(str) {
  const turkish = ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü', 'Ç', 'Ğ', 'İ', 'Ö', 'Ş', 'Ü'];
  const english = ['c', 'g', 'i', 'o', 's', 'u', 'C', 'G', 'I', 'O', 'S', 'U'];
  return str
    .split('')
    .map(char => {
      const index = turkish.indexOf(char);
      return index > -1 ? english[index] : char;
    })
    .join('')
    .toLowerCase();
}

function capitalizeTurkish(str) {
  return str.replace(/(^|\s)[a-zA-ZğüşöçĞÜŞÖÇ]/g, match => match.toUpperCase());
}

const cities = {
  "adana": "9146",
  "01": "9146",
  "adiyaman": "9158",
  "02": "9158",
  "afyon": "9167",
  "03": "9167",
  "agri": "9185",
  "04": "9185",
  "amasya": "9198",
  "05": "9198",
  "ankara": "9206",
  "06": "9206",
  "antalya": "9225",
  "07": "9225",
  "artvin": "9246",
  "08": "9246",
  "aydin": "9252",
  "09": "9252",
  "balikesir": "9270",
  "10": "9270",
  "bilecik": "9297",
  "11": "9297",
  "bingol": "9303",
  "12": "9303",
  "bitlis": "9311",
  "13": "9311",
  "bolu": "9315",
  "14": "9315",
  "burdur": "9327",
  "15": "9327",
  "bursa": "9335",
  "16": "9335",
  "canakkale": "9352",
  "17": "9352",
  "cankiri": "9359",
  "18": "9359",
  "corum": "9370",
  "19": "9370",
  "denizli": "9392",
  "20": "9392",
  "diyarbakir": "9402",
  "21": "9402",
  "edirne": "9419",
  "22": "9419",
  "elazig": "9432",
  "23": "9432",
  "erzincan": "9440",
  "24": "9440",
  "erzurum": "9451",
  "25": "9451",
  "eskisehir": "9470",
  "26": "9470",
  "gaziantep": "9479",
  "27": "9479",
  "giresun": "9494",
  "28": "9494",
  "gumushane": "9501",
  "29": "9501",
  "hakkari": "9507",
  "30": "9507",
  "hatay": "9515",
  "31": "9515",
  "isparta": "9528",
  "32": "9528",
  "mersin": "9737",
  "33": "9737",
  "istanbul": "9541",
  "34": "9541",
  "izmir": "9560",
  "35": "9560",
  "kars": "9594",
  "36": "9594",
  "kastamonu": "9609",
  "37": "9609",
  "kayseri": "9620",
  "38": "9620",
  "kirklareli": "9638",
  "39": "9638",
  "kirsehir": "9646",
  "40": "9646",
  "kocaeli": "9654",
  "41": "9654",
  "konya": "9676",
  "42": "9676",
  "kutahya": "9689",
  "43": "9689",
  "malatya": "9703",
  "44": "9703",
  "manisa": "9716",
  "45": "9716",
  "kahramanmaras": "9577",
  "46": "9577",
  "mardin": "9726",
  "47": "9726",
  "mugla": "9747",
  "48": "9747",
  "mus": "9755",
  "49": "9755",
  "nevsehir": "9760",
  "50": "9760",
  "nigde": "9766",
  "51": "9766",
  "ordu": "9782",
  "52": "9782",
  "rize": "9799",
  "53": "9799",
  "sakarya": "9807",
  "54": "9807",
  "samsun": "9819",
  "55": "9819",
  "siirt": "9839",
  "56": "9839",
  "sinop": "9847",
  "57": "9847",
  "sivas": "9868",
  "58": "9868",
  "tekirdag": "9879",
  "59": "9879",
  "tokat": "9887",
  "60": "9887",
  "trabzon": "9905",
  "61": "9905",
  "tunceli": "9914",
  "62": "9914",
  "sanliurfa": "9831",
  "63": "9831",
  "usak": "9919",
  "64": "9919",
  "van": "9930",
  "65": "9930",
  "yozgat": "9949",
  "66": "9949",
  "zonguldak": "9955",
  "67": "9955",
  "aksaray": "9193",
  "68": "9193",
  "bayburt": "9295",
  "69": "9295",
  "karaman": "9587",
  "70": "9587",
  "kirikkale": "9635",
  "71": "9635",
  "batman": "9288",
  "72": "9288",
  "sirnak": "9854",
  "73": "9854",
  "bartin": "9285",
  "74": "9285",
  "ardahan": "9238",
  "75": "9238",
  "igdir": "9522",
  "76": "9522",
  "yalova": "9935",
  "77": "9935",
  "karabuk": "9581",
  "78": "9581",
  "kilis": "9629",
  "79": "9629",
  "osmaniye": "9788",
  "80": "9788",
  "duzce": "9414",
  "81": "9414"
};

const cityCodesToNames = Object.entries(cities).reduce((acc, [key, value]) => {
  if (!isNaN(key)) { // key bir plaka kodu ise
    const cityName = Object.keys(cities).find(name => cities[name] === value && isNaN(name));
    acc[key] = cityName; // plaka kodunu şehir ismiyle eşle
  }
  return acc;
}, {});
