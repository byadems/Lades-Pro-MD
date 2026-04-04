const { WhatsappSession, initializeDatabase } = require('./core/database');

(async () => {
    try {
        await initializeDatabase();
        const s = await WhatsappSession.findByPk('lades-session');
        if(s) {
            console.log('Session exists! Length:', s.sessionData.length);
            const data = JSON.parse(s.sessionData);
            console.log('Has creds:', !!data.creds);
            console.log('Has me:', !!data.creds?.me);
            console.log('Has signedPreKey:', !!data.creds?.signedPreKey);
        } else {
            console.log('Session NOT FOUND in DB');
        }
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
