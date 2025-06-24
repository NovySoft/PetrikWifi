import { db } from '../../database.js';
import logger from '../../logger.js';

export default async function getAllUsers(req, rep) {
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

    const users = db.prepare('SELECT username, isManual, allowChangePassword, admin, banned, lastActive, expireAfterInactiveDays, expireAtDate, comment, allowedDevices FROM Users').all();
    for (const user of users) {
        if (user.allowedDevices != null && user.allowedDevices !== '') {
            try {
                user.allowedDevices = JSON.parse(user.allowedDevices);
            } catch (e) {
                logger.error('Error parsing allowedDevices:', e);
                user.allowedDevices = [];
            }
        } else {
            user.allowedDevices = [];
        }
    }
    rep.status(200).send(users);
}