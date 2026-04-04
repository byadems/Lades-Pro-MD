const { WhatsappSession, initializeDatabase } = require('./core/database');
initializeDatabase().then(() => {
  WhatsappSession.findByPk('lades-session').then(s => {
    const d = JSON.parse(s.sessionData);
    console.log(JSON.stringify(d.creds.signedPreKey, null, 2));
    process.exit(0);
  });
});
