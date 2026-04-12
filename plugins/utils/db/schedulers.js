const { DataTypes, Op, sequelize } = require("../../../core/database");
const { logger, ...config } = require("../../../config");

async function updateOrCreate(model, findCriteria, createData) {
  try {
    if (typeof model.upsert === "function") {
      await model.upsert(createData);
      return true;
    }
  } catch (_) {}
  const existingRecord = await model.findOne({ where: findCriteria });
  if (existingRecord) {
    await existingRecord.update(createData);
  } else {
    await model.create(createData);
  }
  return true;
}

const AutoMuteDB = sequelize.define("automute", {
  chat: { type: DataTypes.STRING, allowNull: false },
  time: { type: DataTypes.STRING, allowNull: false },
}, { 
  indexes: [{ fields: ['chat'] }],
  timestamps: false,
});

let _autoMuteSynced = false;

const automute = {
  async get() {
    if (!_autoMuteSynced) {
      await AutoMuteDB.sync({ alter: false }).catch(() => {});
      _autoMuteSynced = true;
    }
    return await AutoMuteDB.findAll();
  },
  async set(jid, time) {
    return await updateOrCreate(AutoMuteDB, { chat: jid }, { chat: jid, time });
  },
  async delete(jid) {
    const result = await AutoMuteDB.destroy({ where: { chat: jid } });
    return result > 0;
  },
};

const AutoUnMuteDB = sequelize.define("autounmute", {
  chat: { type: DataTypes.STRING, allowNull: false },
  time: { type: DataTypes.STRING, allowNull: false },
}, { 
  indexes: [{ fields: ['chat'] }],
  timestamps: false,
});

let _autoUnMuteSynced = false;

const autounmute = {
  async get() {
    if (!_autoUnMuteSynced) {
      await AutoUnMuteDB.sync({ alter: false }).catch(() => {});
      _autoUnMuteSynced = true;
    }
    return await AutoUnMuteDB.findAll();
  },
  async set(jid, time) {
    return await updateOrCreate(
      AutoUnMuteDB,
      { chat: jid },
      { chat: jid, time }
    );
  },
  async delete(jid) {
    const result = await AutoUnMuteDB.destroy({ where: { chat: jid } });
    return result > 0;
  },
};

const StickyCmdDB = sequelize.define("stickcmd", {
  command: { type: DataTypes.STRING(1000), allowNull: false },
  file: { type: DataTypes.STRING(1000), allowNull: false },
}, { 
  indexes: [{ fields: ['command'] }, { fields: ['file'] }],
  timestamps: false,
});

let _stickyCmdSynced = false;

const stickcmd = {
  async get() {
    if (!_stickyCmdSynced) {
      await StickyCmdDB.sync({ alter: false }).catch(() => {});
      _stickyCmdSynced = true;
    }
    return await StickyCmdDB.findAll();
  },
  async set(commandName, fileContent) {
    const existingRecord = await StickyCmdDB.findOne({
      where: { file: fileContent },
    });
    if (existingRecord) {
      await existingRecord.destroy();
    }
    await StickyCmdDB.create({ command: commandName, file: fileContent });
    return true;
  },
  async delete(identifier, type = "file") {
    const whereClause =
      type === "file"
        ? { file: identifier }
        : type === "command"
        ? { command: identifier }
        : null;
    if (!whereClause) return false;

    const result = await StickyCmdDB.destroy({ where: whereClause });
    return result > 0;
  },
};

const ScheduledMessageDB = sequelize.define("scheduled_messages", {
  jid: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.STRING(2048), allowNull: false },
  scheduleTime: { type: DataTypes.DATE, allowNull: false },
  isSent: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { 
  indexes: [{ fields: ['scheduleTime', 'isSent'] }, { fields: ['jid'] }],
  timestamps: false,
});

let _scheduledMsgSynced = false;

const scheduledMessages = {
  async getDueForSending() {
    if (!_scheduledMsgSynced) {
      await ScheduledMessageDB.sync({ alter: false }).catch(() => {});
      _scheduledMsgSynced = true;
    }
    return await ScheduledMessageDB.findAll({
      where: {
        scheduleTime: { [Op.lte]: new Date() },
      },
    });
  },
  async getAllPending() {
    if (!_scheduledMsgSynced) {
      await ScheduledMessageDB.sync({ alter: false }).catch(() => {});
      _scheduledMsgSynced = true;
    }
    return await ScheduledMessageDB.findAll();
  },
  async add(jid, message, scheduleTime) {
    await ScheduledMessageDB.create({
      jid,
      message,
      scheduleTime,
      isSent: false,
    });
    return true;
  },
  async markAsSent(messageId) {
    const result = await ScheduledMessageDB.destroy({
      where: { id: messageId },
    });
    return result > 0;
  },
  async delete(messageId) {
    const result = await ScheduledMessageDB.destroy({
      where: { id: messageId },
    });
    return result > 0;
  },
};

module.exports = {
  automute,
  autounmute,
  stickcmd,
  scheduledMessages,
  AutoMuteDB,
  AutoUnMuteDB,
  StickyCmdDB,
  ScheduledMessageDB,
};
