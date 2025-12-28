import { db } from '../../database.js';

export default async function getAllAps(req, rep) {
    if (req.session?.get('login') !== true) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_LOGGED_IN',
            message: 'You are not logged in.',
        });
        return;
    }

    if (req.session.get('user').isAdmin !== true) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_ADMIN',
            message: 'You are not an admin.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);

    // 'uncanonicalize' function for frontend display
    function uncanonicalizeMac(mac) {
        if (!mac) return '';
        // Display in AA:BB:CC:DD:EE:FF format
        return mac.toUpperCase().match(/.{1,2}/g)?.join(':') || mac;
    }
    const apsRaw = db.prepare('SELECT AP, IP, comment FROM APs').all();
    const aps = apsRaw.map(ap => ({...ap, AP: uncanonicalizeMac(ap.AP)}));
    rep.status(200).send(aps);
}