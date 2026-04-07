const simpleGit = require("simple-git");
const git = simpleGit();
const { Module } = require("../main");
// const { update } = require('./misc/koyeb');
const renderDeploy = require("./utils/render-api");
const config = require("../config");
const fs = require("fs").promises;
const axios = require("axios");

const handler = config.HANDLER_PREFIX;
const localPackageJson = require("../package.json");

async function isGitRepo() {
  try {
    await fs.access(".git");
    return true;
  } catch (e) {
    return false;
  }
}

async function getRemoteVersion() {
  try {
    const remotePackageJsonUrl = "";
    const response = await axios.get(remotePackageJsonUrl);
    return response.data.version;
  } catch (error) {
    throw new Error("Uzak sürüm bilgisi alınamadı");
  }
}

Module({
    pattern: "güncelle ?(.*)",
    fromMe: true,
    desc: "Bot güncellemelerini kontrol eder ve uygular.",
    use: "system",
  },
  async (message, match) => {
    if (!(await isGitRepo())) {
      return await message.sendReply("_❌ Bu bot bir Git deposundan çalıştırılmıyor. Otomatik güncellemeler mevcut değil._"
      );
    }

    const command = match[1] ? match[1].toLowerCase() : "";
    const processingMsg = await message.sendReply("_⏳ Güncellemeler kontrol ediliyor..._");

    try {
      // fetch remote version & commits
      await git.fetch();
      const commits = await git.log(["main" + "..origin/" + "main"]);
      const localVersion = localPackageJson.version;
      let remoteVersion;

      try {
        remoteVersion = await getRemoteVersion();
      } catch (error) {
        return await message.edit(
          "_❌ Uzak sürüm kontrol edilemedi. Lütfen daha sonra tekrar deneyin._",
          message.jid,
          processingMsg.key
        );
      }

      const hasCommits = commits.total > 0;
      const versionChanged = remoteVersion !== localVersion;

      if (!hasCommits && !versionChanged) {
        return await message.edit(
          "_✅ Bot güncel!_",
          message.jid,
          processingMsg.key
        );
      }

      const isBetaUpdate = hasCommits && !versionChanged;
      const isStableUpdate = hasCommits && versionChanged;

      if (!command) {
        let updateInfo = "";

        if (isStableUpdate) {
          updateInfo = `*_GÜNCELLEME MEVCUT_*\n\n`;
          updateInfo += `📦 Mevcut sürüm: *${localVersion}*\n`;
          updateInfo += `📦 Yeni sürüm: *${remoteVersion}*\n\n`;
          updateInfo += `*_DEĞİŞİKLİK GÜNLÜĞÜ:_*\n\n`;
          for (let i in commits.all) {
            updateInfo += `${parseInt(i) + 1}• *${commits.all[i].message}*\n`;
          }
          updateInfo += `\n_Güncellemeyi uygulamak için "${handler}update start" kullanın_`;
        } else if (isBetaUpdate) {
          updateInfo = `*_BETA GÜNCELLEMESİ MEVCUT_*\n\n`;
          updateInfo += `📦 Mevcut sürüm: *${localVersion}*\n`;
          updateInfo += `⚠️ Yeni commitler mevcut (sürüm değişmedi)\n\n`;
          updateInfo += `*_DEĞİŞİKLİK GÜNLÜĞÜ:_*\n\n`;
          for (let i in commits.all) {
            updateInfo += `${parseInt(i) + 1}• *${commits.all[i].message}*\n`;
          }
          updateInfo += `\n_Beta güncellemelerini uygulamak için "${handler}update beta" kullanın_`;
        }

        return await message.edit(updateInfo, message.jid, processingMsg.key);
      }

      if (command === "start") {
        if (!isStableUpdate) {
          if (isBetaUpdate) {
            return await message.edit(
              `_Sadece beta güncellemeleri mevcut. Uygulamak için "${handler}update beta" kullanın._`,
              message.jid,
              processingMsg.key
            );
          }
          return await message.edit(
            "_ℹ️ Kararlı güncelleme mevcut değil!_",
            message.jid,
            processingMsg.key
          );
        }

        await message.edit(
          "_⏳ Güncelleme başlatılıyor..._",
          message.jid,
          processingMsg.key
        );

        if (process.env.RENDER_SERVICE_ID) {
          if (!config.RENDER_API_KEY) {
            return await message.edit(
              "_⚠️ RENDER_API_KEY eksik!_",
              message.jid,
              processingMsg.key
            );
          }

          await renderDeploy(
            process.env.RENDER_SERVICE_ID,
            config.RENDER_API_KEY
          );
          return await message.edit(
            "_✅ Render dağıtımı başlatıldı!_",
            message.jid,
            processingMsg.key
          );
        }

        if (!__dirname.startsWith("/lds")) {
          await git.reset("hard", ["HEAD"]);
          await git.pull();
          await message.edit(
            `_Sürüm ${remoteVersion}'e başarıyla güncellendi! Gerekirse npm modüllerini manuel güncelleyin._`,
            message.jid,
            processingMsg.key
          );
          process.exit(0);
        } else {
          return await message.edit(
            "_Güncellemek için barındırma platformunu ziyaret edip dağıtımı başlatın._",
            message.jid,
            processingMsg.key
          );
        }
      } else if (command === "beta") {
        if (!hasCommits) {
          return await message.edit(
            "_Beta güncellemesi mevcut değil!_",
            message.jid,
            processingMsg.key
          );
        }

        await message.edit(
          "_Beta güncellemesi başlatılıyor..._",
          message.jid,
          processingMsg.key
        );

        if (process.env.RENDER_SERVICE_ID) {
          if (!config.RENDER_API_KEY) {
            return await message.edit(
              "_⚠️ RENDER_API_KEY eksik!_",
              message.jid,
              processingMsg.key
            );
          }

          await renderDeploy(
            process.env.RENDER_SERVICE_ID,
            config.RENDER_API_KEY
          );
          return await message.edit(
            "_Beta güncellemesi için Render dağıtımı başlatıldı!_",
            message.jid,
            processingMsg.key
          );
        }

        if (!__dirname.startsWith("/lds")) {
          await git.reset("hard", ["HEAD"]);
          await git.pull();
          await message.edit(
            `_Beta güncellemesi başarıyla uygulandı (${commits.total} commit). Gerekirse npm modüllerini manuel güncelleyin!_`,
            message.jid,
            processingMsg.key
          );
          process.exit(0);
        } else {
          return await message.edit(
            "_Güncellemek için barındırma platformunu ziyaret edip dağıtımı başlatın._",
            message.jid,
            processingMsg.key
          );
        }
      } else {
        return await message.edit(
          `_Geçersiz komut. Güncellemeleri kontrol için "${handler}update", kararlı güncelleme için "${handler}update start", beta güncelleme için "${handler}update beta" kullanın._`,
          message.jid,
          processingMsg.key
        );
      }
    } catch (error) {
      console.error("Güncelleme hatası:", error);
      return await message.edit(
        "_Güncellemeler kontrol edilirken bir hata oluştu._",
        message.jid,
        processingMsg.key
      );
    }
  }
);
