import { db } from '../../database.js';
import logger from '../../logger.js';
import { deleteSpeedProfile } from '../../unifi.js';

export default async function deleteSpeedprofile(req, rep) {
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
    try {
        const speedprofiles = await deleteSpeedProfile(req.body.id);
        rep.send({
            code: 'OK',
            message: 'Speedprofile Deleted',
        });
        logger.info(`Speed profile deleted: ${req.body.id} by ${req.session.get('user').userPrincipalName}`);
    } catch (error) {
        if (error.code === 'SPEED_PROFILE_IN_USE') {
            logger.warn(`Speed profile deletion failed: ${error.message}`);
            rep.status(400).send({
                error: 'Bad Request',
                code: 'SPEED_PROFILE_IN_USE',
                message: error.message,
            });
            return;
        }
        logger.error('Error deleting speed profile:', error);
        rep.status(500).send({
            error: 'Internal Server Error',
            code: 'INTERNAL_ERROR',
            message: 'An error occurred while deleting the speed profile.',
        });
    }
}