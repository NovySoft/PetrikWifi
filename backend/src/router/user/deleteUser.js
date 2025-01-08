import { db } from '../../database.js';
import logger from '../../logger.js';

export default async function deleteUser(req, rep) {
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

    const { username } = req.body;

    if (username === undefined || username == '') {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'BAD_REQUEST',
            message: 'Missing required fields.',
        });
        return;
    }

    const result = db.prepare('DELETE FROM Users WHERE username = ?').run(username);
    if (result.changes === 0 || result.changes === undefined) {
        rep.status(404).send({
            error: 'Not Found',
            code: 'NOT_FOUND',
            message: 'User not found.',
        });
        return;
    }

    logger.info(`User Deleted: ${username} by ${req.session.get('user').userPrincipalName}`);

    rep.status(200).send({
        code: 'OK',
        message: 'User Deleted',
    });

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);

}