const { WhatsappSession, initializeDatabase } = require('./core/database');
initializeDatabase().then(() => {
  WhatsappSession.findByPk('lades-session').then(s => {
    const d = JSON.parse(s.sessionData);
    console.log(Object.keys(d.creds.signedPreKey || {}));
    if (d.creds.signedPreKey) {
        console.log("keyPair is:", d.creds.signedPreKey.keyPair ? "present" : "missing");
        console.log("public is:", d.creds.signedPreKey.public ? "present" : "missing");
    }
    process.exit(0);
  });
});
