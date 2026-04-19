const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { Module } = require("../main");
const { MODE } = require("../config");

const auto = MODE === "public" ? false : true;
const CHECK_INTERVAL = 90000;
const LAST_EARTHQUAKE_FILE_PATH = path.join(__dirname, "lastEarthquake.txt");

let intervalId = null;
let lastEarthquake = {};

(async () => {
  try {
    const data = await fs.readFile(LAST_EARTHQUAKE_FILE_PATH, "utf-8");
    if (data) lastEarthquake = JSON.parse(data);
  } catch {
    console.log("Önceki deprem verisi bulunamadı, yeniden başlatılıyor.");
  }
})();

const getEarthquakeData = async (timeout = 30000, retryCount = 0) => {
  try {
    const response = await axios.get(
      "https://api.orhanaydogdu.com.tr/deprem/kandilli/live?limit=1",
      { timeout }
    );
    return { earthquakes: response.data.result };
  } catch (err) {
    console.error(`Error fetching earthquake data: ${err.message}`);
    if (retryCount < 10) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return getEarthquakeData(timeout, retryCount + 1);
    }
    throw err;
  }
};

const formatKandilliDate = (dateTime) => {
  if (!dateTime) return "Veri yok";
  const [datePart, timePart] = dateTime.split(" ");
  const [year, month, day] = datePart.split("-");
  return `${day}.${month}.${year} ${timePart}`;
};

const normalize = (text = "") =>
  text
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");

const listAllEarthquakes = async (m, { limit, region } = {}) => {
  try {
    let url = "https://api.orhanaydogdu.com.tr/deprem/kandilli/live";
    if (limit && Number.isInteger(limit)) url += `?limit=${limit}`;

    const response = await axios.get(url, { timeout: 30000 });
    const { metadata, result: earthquakes } = response.data;

    let message = "🌍 *SON DEPREMLER:*\n\n";
    if (metadata) {
      message += `📅 Zaman: *${formatKandilliDate(metadata.date_starts)}*\n`;
      message += `🧮 Toplam Deprem Sayısı: *${metadata.count}*\n`;
    }

    let filtered = earthquakes;
    if (region) {
      const key = normalize(region);
      filtered = earthquakes.filter((eq) => normalize(eq.title || "").includes(key));
      message += `\n📍 Şehir filtresi: *${region}*\n`;
    }

    message += `📊 Gösterilen deprem sayısı: *${filtered.length}*\n\n`;

    if (!filtered.length) {
      await m.send(`${message}⚠️ *Eşleşen deprem kaydı bulunamadı!*`);
      return;
    }

    filtered.forEach((earthquake, index) => {
      const time = formatKandilliDate(earthquake.date_time);
      message += `${index + 1}. 📍 Konum: *${earthquake.title}*\n`;
      message += `🌟 Büyüklük: *${earthquake.mag}*\n`;
      message += `⏰ Zaman: *${time}*\n\n`;
    });

    await m.send(message);
  } catch (err) {
    await m.send(`❌ *Hata oluştu:* \n\n${err.message}`);
  }
};

Module({
  pattern: "sondepremler ?(.*)",
  fromMe: auto,
  desc: "Türkiye genelinde son gerçekleşen depremleri liste halinde sunar. Şehir filtresi eklenebilir.",
  usage: ".sondepremler | .sondepremler [şehir] [limit]",
  use: "araçlar",
},
  async (m, match) => {
    const rawArgs = (match && match[1] ? match[1] : "").trim();
    const args = rawArgs.split(/\s+/).filter(Boolean);

    let limit = null;
    const regionParts = [];

    args.forEach((arg) => {
      if (/^\d+$/.test(arg) && !limit) {
        limit = parseInt(arg, 10);
      } else {
        regionParts.push(arg);
      }
    });

    const region = regionParts.length ? regionParts.join(" ") : null;
    await listAllEarthquakes(m, { limit, region });
  }
);

Module({
  pattern: "sondeprem",
  fromMe: auto,
  desc: "Türkiye'de kaydedilen en son deprem verisini detaylı olarak gösterir.",
  usage: ".sondeprem",
  use: "araçlar",
  dontAddCommandList: true,
},
  async (m) => {
    try {
      const { earthquakes } = await getEarthquakeData();
      const latest = earthquakes?.[0];
      if (!latest) return await m.send("⚠️ *Son deprem verisi alınamadı!*");

      const info =
        `🌍 *SON DEPREM*\n\n` +
        `📍 Konum: *${latest.title}*\n` +
        `🌟 Büyüklük: *${latest.mag}*\n` +
        `⏰ Zaman: *${formatKandilliDate(latest.date_time)}*`;
      await m.send(info);
    } catch (err) {
      await m.send(`❌ *Hata oluştu:* \n\n${err.message}`);
    }
  }
);

module.exports = {
  getEarthquakeData,
  formatKandilliDate,
  normalize,
  listAllEarthquakes,
  CHECK_INTERVAL,
  intervalId,
  lastEarthquake,
};

