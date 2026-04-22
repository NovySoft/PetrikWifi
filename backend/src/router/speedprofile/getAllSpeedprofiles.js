import { db } from '../../database.js';
import logger from '../../logger.js';
import { getSpeedProfiles } from '../../unifi.js';

export default async function getAllSpeedprofiles(req, rep) {
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
    const speedprofiles = await getSpeedProfiles();
    rep.send({ speedprofiles });
}