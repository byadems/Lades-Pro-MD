const axios = require("axios");

async function deployLatestCommit(serviceId, apiKey) {
  if (!serviceId) {
    console.error("Hata: RENDER_SERVICE_ID ayarlanmamış.");
    return;
  }

  if (!apiKey) {
    console.error("Hata: RENDER_API_KEY ayarlanmamış.");
    return;
  }

  const autoScalingUrl = `https://api.render.com/v1/services/${serviceId}/autoscaling`;

  try {
    const disableRes = await axios.delete(autoScalingUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    console.log("Otomatik ölçeklendirme kapatıldı:", disableRes.data || "İçerik yok");
  } catch (err) {
    console.error(
      "Otomatik ölçeklendirme kapatılamadı:",
      err.response?.data || err.message
    );
    return;
  }

  const deployUrl = `https://api.render.com/v1/services/${serviceId}/deploys`;

  try {
    const response = await axios.post(
      deployUrl,
      {
        clearCache: "clear",
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const deployInfo = response.data;

console.log("\nDağıtım başarıyla başlatıldı!");
   console.log(`Dağıtım ID: ${deployInfo.id}`);
   console.log(`Durum: ${deployInfo.status}`);
   console.log(`Tetikleyen: ${deployInfo.trigger}`);
   if (deployInfo.commit) {
     console.log(`Commit SHA: ${deployInfo.commit.id}`);
     console.log(`Commit Mesajı: ${deployInfo.commit.message}`);
   }
   console.log(
     `Render Panel: https://dashboard.render.com/web/${serviceId}/deploys/${deployInfo.id}`
   );
  } catch (err) {
    console.error(
      "Dağıtım sırasında hata:",
      err.response?.data || err.message
    );
  }
}

module.exports = deployLatestCommit;
