import { db } from '../../database.js';

export default async function getSelfDevices(req, rep) {
    if (req.session?.get('login') !== true) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_LOGGED_IN',
            message: 'You are not logged in.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);

    const userID = db.prepare('SELECT userID FROM Users WHERE username = ?').get(req.session.get('user').userPrincipalName).userID;
    const devices = db.prepare('SELECT device AS mac, lastActive, banned FROM Devices WHERE userID = ?').all(userID);

    const others = db.prepare('SELECT username, device AS mac, Devices.banned, Devices.lastActive FROM Devices LEFT JOIN Users ON Users.userID = Devices.userID WHERE device IN (?) AND Devices.userID != ?').all(devices.map(d => d.mac).join(','), userID);

    rep.send({
        devices,
        others,
    });
}