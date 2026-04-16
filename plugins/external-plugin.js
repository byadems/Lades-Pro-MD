const { Module } = require("../main");
const config = require("../config");
const axios = require("axios");
const fs = require("fs");
const { PluginDB, installPlugin } = require("./sql/plugin");
const handler = config.HANDLER_PREFIX;
const { extractUrls, validateUrl } = require("../core/helpers");
const crypto = require("crypto");
const vm = require("vm");

Module({
  pattern: "modülyükle ?(.*)",
  fromMe: true,
  desc: "Modül yükler.",
  use: "sahip",
},
  async (message, match) => {
    match = match[1] !== "" ? match[1] : message.reply_message.text;
    if (!match) return await message.send("⚠️ Lütfen bir bağlantı giriniz!");

    const links = extractUrls(match);
    if (!links.length) return await message.send("⚠️ Lütfen bir bağlantı giriniz!");

    for (const link of links) {
      let url;
      try {
        url = new URL(link);
      } catch {
        return await message.send("❗️ ```Lütfen bir geçerli URL giriniz!```");
      }

      if (!validateUrl(link, "github_gist")) {
        return await message.sendReply(
          `_⚠️ Güvenlik: Yalnızca GitHub Gist bağlantıları desteklenir._`
        );
      }

      if (
        url.host === "gist.github.com" ||
        url.host === "gist.githubusercontent.com"
      ) {
        url = !url?.toString().endsWith("raw")
          ? url.toString() + "/raw"
          : url.toString();
      } else {
        url = url.toString();
      }
      let response;
      try {
        response = await axios(url + "?timestamp=" + new Date());
      } catch {
        return await message.send("❗️ ```Lütfen bir geçerli URL giriniz!```");
      }
      let plugin_name = /pattern: ["'](.*)["'],/g.exec(response.data);
      let plugin_name_temp = response.data.match(/pattern: ["'](.*)["'],/g)
        ? response.data
          .match(/pattern: ["'](.*)["'],/g)
          .map((e) => e.replace("pattern", "").replace(/[^a-zA-Z]/g, ""))
        : "temp";
      try {
        plugin_name = plugin_name[1].split(" ")[0].replace(/[^a-zA-Z0-9_]/g, "");
      } catch {
        return await message.sendReply("_❌ Geçersiz eklenti. Eklenti adı bulunamadı!_"
        );
      }
      const pluginHash = crypto.createHash("sha256").update(response.data).digest("hex");
      try {
        // VM validation parse
        const script = new vm.Script(response.data);
      } catch (err) {
        return await message.sendReply(`_❌ Güvenlik Duvarı: Eklenti sözdizimi asimetrik veya hatalı._`);
      }

      fs.writeFileSync("./plugins/" + plugin_name + ".js", response.data);
      plugin_name_temp =
        plugin_name_temp.length > 1 ? plugin_name_temp.join(", ") : plugin_name;
      try {
        require("./" + plugin_name);
      } catch (e) {
        fs.unlinkSync(__dirname + "/" + plugin_name + ".js");
        return await message.sendReply("*❌ Modülünüz hatalı!*\n*Hata:*" + e);
      }

      // Kayıtlara kodun kendisini de hash ile birlikte kaydet
      await installPlugin(url, plugin_name);
      await PluginDB.update({ code: pluginHash }, { where: { name: plugin_name } });
      await message.send("*✅ Modül başarılı bir şekilde yüklendi!*".format(plugin_name_temp) + `\n\n*🔒 Güvenlik Hash:* \`${pluginHash.slice(0, 8)}\``);
    }
  }
);

Module({
  pattern: "modül ?(.*)",
  fromMe: true,
  desc: "Yüklediğiniz eklentileri gösterir.",
  use: "sahip",
},
  async (message, match) => {
    let plugins = await PluginDB.findAll();
    if (match[1] !== "") {
      const plugin = plugins.filter(
        (_plugin) => _plugin.dataValues.name === match[1]
      );
      try {
        await message.sendReply(
          `_${plugin[0].dataValues.name}:_ ${plugin[0].dataValues.url}`
        );
      } catch {
        return await message.sendReply("```Böyle bir modül belki yüklediniz, belki de yüklemediniz... Ama şu an olmadığı kesin.```");
      }
      return;
    }
    let msg = "*✅ Modül başarılı bir şekilde yüklendi!*"_PLUGINS;
    plugins = await PluginDB.findAll();
    if (plugins.length < 1) {
      return await message.send("⚠️ *Dışarıdan hiç modül yüklememişsiniz!*");
    } else {
      plugins.map((plugin) => {
        msg +=
          "*" +
          plugin.dataValues.name +
          "* : " +
          (plugin.dataValues.url.endsWith("/raw")
            ? plugin.dataValues.url.replace("raw", "")
            : plugin.dataValues.url) +
          "\n\n";
      });
      return await message.sendReply(msg);
    }
  }
);

Module({
  pattern: "modülsil ?(.*)",
  fromMe: true,
  desc: "Modül kaldırır.",
  use: "sahip",
},
  async (message, match) => {
    if (match[1] === "") return await message.send("```Lütfen bir modül giriniz! Örnek: .plugin test```");
    const safePluginName = match[1].replace(/[^a-zA-Z0-9_]/g, "");
    const plugin = await PluginDB.findAll({
      where: {
        name: safePluginName,
      },
    });
    if (plugin.length < 1) {
      return await message.send("⚠️ *Dışarıdan hiç modül yüklememişsiniz!*");
    } else {
      await plugin[0].destroy();
      const Message = "*✅ Modül başarıyla silindi!*".format(safePluginName);
      await message.sendReply(Message);
      delete require.cache[require.resolve("./" + safePluginName + ".js")];
      fs.unlinkSync("./plugins/" + safePluginName + ".js");
    }
  }
);

Module({
  pattern: "mgüncelle ?(.*)",
  fromMe: true,
  desc: "Bir eklentiyi (plugin) günceller",
  use: "sahip",
  usage: ".mgüncelle eklenti_adı",
},
  async (m, match) => {
    let plugin = match[1];
    if (!plugin) return await m.send("```Lütfen bir modül giriniz! Örnek: .plugin test```");
    plugin = plugin.replace(/[^a-zA-Z0-9_]/g, "");
    await PluginDB.sync();
    const plugins = await PluginDB.findAll({
      where: {
        name: plugin,
      },
    });
    if (plugins.length < 1) {
      return await m.send("```Böyle bir modül belki yüklediniz, belki de yüklemediniz... Ama şu an olmadığı kesin.```");
    }
    const url = plugins[0].dataValues.url;
    let response;
    try {
      response = await axios(url + "?timestamp=" + new Date());
    } catch {
      return await m.send("❗️ ```Lütfen bir geçerli URL giriniz!```");
    }
    const pluginHash = crypto.createHash("sha256").update(response.data).digest("hex");
    if (plugins[0].dataValues.code && plugins[0].dataValues.code === pluginHash) {
      return await m.send(`_⚠️ Eklenti güncel, değişiklik yok._`);
    }

    try {
      const script = new vm.Script(response.data);
    } catch (e) {
      return await m.send(`_❌ Güvenlik Duvarı Reddedildi._`);
    }

    fs.writeFileSync("./plugins/" + plugin + ".js", response.data);
    delete require.cache[require.resolve("./" + plugin + ".js")];
    try {
      require("./" + plugin);
    } catch (e) {
      fs.unlinkSync(__dirname + "/" + plugin + ".js");
      return await m.send("*❌ Modülünüz hatalı!*\n*Hata:*" + e);
    }
    await PluginDB.update({ code: pluginHash }, { where: { name: plugin } });
    await m.send("_Eklenti '{}' güncellendi!_".format(plugin) + `\n\n*🔒 Yeni Hash:* \`${pluginHash.slice(0, 8)}\``);
    process.exit(0);
    return;
  }
);

