const { Module } = require("../main");
const config = require("../config");
const axios = require("axios");
const fs = require("fs");
const { PluginDB, installPlugin } = require("./sql/plugin");
let { getString } = require("./utils/lang");
let Lang = getString("external_plugin");
const handler = config.HANDLER_PREFIX;
const { extractUrls, validateUrl } = require("../core/helpers");

Module({
    pattern: "modülyükle ?(.*)",
    fromMe: true,
    desc: Lang.INSTALL_DESC,
    use: "owner",
  },
  async (message, match) => {
    match = match[1] !== "" ? match[1] : message.reply_message.text;
    if (!match) return await message.send(Lang.NEED_URL);
    
    const links = extractUrls(match);
    if (!links.length) return await message.send(Lang.NEED_URL);
    
    for (const link of links) {
      let url;
      try {
        url = new URL(link);
      } catch {
        return await message.send(Lang.INVALID_URL);
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
        return await message.send(Lang.INVALID_URL);
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
      fs.writeFileSync("./plugins/" + plugin_name + ".js", response.data);
      plugin_name_temp =
        plugin_name_temp.length > 1 ? plugin_name_temp.join(", ") : plugin_name;
      try {
        require("./" + plugin_name);
      } catch (e) {
        fs.unlinkSync(__dirname + "/" + plugin_name + ".js");
        return await message.sendReply(Lang.INVALID_PLUGIN + e);
      }
      await installPlugin(url, plugin_name);
      await message.send(Lang.INSTALLED.format(plugin_name_temp));
    }
  }
);

Module({
    pattern: "modül ?(.*)",
    fromMe: true,
    desc: Lang.PLUGIN_DESC,
    use: "owner",
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
        return await message.sendReply(Lang.PLUGIN_NOT_FOUND);
      }
      return;
    }
    let msg = Lang.INSTALLED_PLUGINS;
    plugins = await PluginDB.findAll();
    if (plugins.length < 1) {
      return await message.send(Lang.NO_PLUGIN);
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
    desc: Lang.REMOVE_DESC,
    use: "owner",
  },
  async (message, match) => {
    if (match[1] === "") return await message.send(Lang.NEED_PLUGIN);
    const safePluginName = match[1].replace(/[^a-zA-Z0-9_]/g, "");
    const plugin = await PluginDB.findAll({
      where: {
        name: safePluginName,
      },
    });
    if (plugin.length < 1) {
      return await message.send(Lang.NO_PLUGIN);
    } else {
      await plugin[0].destroy();
      const Message = Lang.DELETED.format(safePluginName);
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
    use: "owner",
    usage: ".mgüncelle eklenti_adı",
  },
  async (m, match) => {
    let plugin = match[1];
    if (!plugin) return await m.send(Lang.NEED_PLUGIN);
    plugin = plugin.replace(/[^a-zA-Z0-9_]/g, "");
    await PluginDB.sync();
    const plugins = await PluginDB.findAll({
      where: {
        name: plugin,
      },
    });
    if (plugins.length < 1) {
      return await m.send(Lang.PLUGIN_NOT_FOUND);
    }
    const url = plugins[0].dataValues.url;
    let response;
    try {
      response = await axios(url + "?timestamp=" + new Date());
    } catch {
      return await m.send(Lang.INVALID_URL);
    }
    fs.writeFileSync("./plugins/" + plugin + ".js", response.data);
    delete require.cache[require.resolve("./" + plugin + ".js")];
    try {
      require("./" + plugin);
    } catch (e) {
      fs.unlinkSync(__dirname + "/" + plugin + ".js");
      return await m.send(Lang.INVALID_PLUGIN + e);
    }
    await m.send(Lang.PLUGIN_UPDATED.format(plugin));
    process.exit(0);
    return;
  }
);
