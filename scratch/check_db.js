const { BotMetric, CommandStat, UserData, GroupSettings, WhatsappSession, WarnLog, Filter, Schedule, ExternalPlugin, AiCommand, MessageStats, CommandRegistry, sequelize } = require("../core/database");

(async () => {
    try {
        await sequelize.authenticate();
        console.log("Connected to DB.");

        const metrics = await BotMetric.findAll();
        console.log("--- Bot Metrics ---");
        metrics.forEach(m => console.log(`${m.key}: ${m.value}`));

        const cmdCount = await CommandStat.count();
        console.log(`Command Stats Count: ${cmdCount}`);

        const userCount = await UserData.count();
        console.log(`User Data Count: ${userCount}`);

        const groupCount = await GroupSettings.count();
        console.log(`Group Settings Count: ${groupCount}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
