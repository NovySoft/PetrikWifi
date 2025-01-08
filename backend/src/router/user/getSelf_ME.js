import { db } from '../../database.js';

export default async function (req, rep) {
    if (req.session.get('login') !== true) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_LOGGED_IN',
            message: 'You are not logged in.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);
    rep.status(200).send(req.session.get('user'));
}