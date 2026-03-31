const { PluginDB } = require("../utils/db/models");

async function installPlugin(address, file) {
  const existing = await PluginDB.findAll({
    where: { url: address },
  });

  if (existing.length >= 1) {
    return false;
  }
  return await PluginDB.create({ url: address, name: file });
}

module.exports = { PluginDB, installPlugin };
