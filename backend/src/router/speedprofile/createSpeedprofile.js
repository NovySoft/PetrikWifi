import { db } from '../../database.js';
import logger from '../../logger.js';
import { createSpeedProfile } from '../../unifi.js';

export default async function createSpeedprofile(req, rep) {
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

    if ([
        req.body.group_name,
        req.body.group_dn,
        req.body.group_up
    ].some(x => x === undefined || x === null)) {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'MISSING_PARAMETERS',
            message: 'One or more required parameters are missing.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);
    try {
        await createSpeedProfile(
            req.body.group_name,
            req.body.group_dn,
            req.body.group_up
        );
        rep.send({
            code: 'OK',
            message: 'Speedprofile Created',
        });
        logger.info(`Speed profile created: ${req.body.group_name} by ${req.session.get('user').userPrincipalName}`);
    } catch (error) {
        logger.error('Error creating speed profile:', error);
        rep.status(500).send({
            error: 'Internal Server Error',
            code: 'INTERNAL_ERROR',
            message: 'An error occurred while creating the speed profile.',
        });
    }
}
