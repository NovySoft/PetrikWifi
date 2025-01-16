import { db } from '../../database.js';

export default async function getAllDevices(req, rep) {
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

    const devices = db.prepare('SELECT Devices.userID, username, device AS mac, Devices.comment AS deviceComment, Users.comment as userComment, Devices.lastActive AS deviceLastActive, Users.lastActive AS userLastActive, Devices.banned AS deviceBanned, Users.banned AS userBanned FROM Devices LEFT JOIN Users ON Devices.userID = Users.userID ORDER BY Devices.userID').all();
    rep.status(200).send(devices);
}