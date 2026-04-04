const { MessageStats, initializeDatabase } = require("./core/database");
const { sequelize } = require("./config");

(async () => {
    try {
        const models = await initializeDatabase();
        if (MessageStats) {
            const latest = await MessageStats.findAll({
                order: [['lastMessageAt', 'DESC']],
                limit: 5
            });
            console.log("--- LATEST MESSAGES IN DB ---");
            latest.forEach(m => {
                console.log(`JID: ${m.jid} | User: ${m.userJid} | Total: ${m.totalMessages} | Last: ${m.lastMessageAt}`);
            });
        } else {
            console.log("MessageStats model not found.");
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
