import { db } from '../../database.js';
import { SUPER_SECRET_KEY, getKeyFromPassword, decrypt } from '../../encryptor.js';
import logger from '../../logger.js';

export default async function userLogin(req, rep) {
    if (req.session?.get('login') === true) {
        rep.status(200).send({ code: 'OK' });
        return;
    }

    if (req.body.username == null || req.body.password == null) {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'BAD_REQUEST',
            message: 'Username and password must be provided.',
        });
        return;
    }

    const user = db.prepare('SELECT password, salt, banned, isManual, admin, allowChangePassword FROM Users WHERE username = ?').get(req.body.username);
    logger.silly(user);

    if (user == null) {
        rep.status(404).send({
            error: 'Not Found',
            code: 'NOT_FOUND',
            message: 'User not found.',
        });
        return;
    }

    if (user.banned === 1) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'BANNED',
            message: 'User is banned.',
        });
        return;
    }

    if (user.isManual !== 1) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_MANUAL',
            message: 'User is not manually managed. Login with SSO instead.',
        });
        return;
    }

    const password = Buffer.from(user.password, 'hex');
    const salt = Buffer.from(user.salt, 'hex');
    const encryptor_password = Buffer.from(`${req.body.username}-${SUPER_SECRET_KEY}`);
    const encryptor_key = getKeyFromPassword(encryptor_password, salt);
    const decrypted_password = decrypt(password, encryptor_key);

    if (decrypted_password.toString('utf8') !== req.body.password) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'WRONG_PASSWORD',
            message: 'Wrong password.',
        });
        password.fill(0);
        salt.fill(0);
        encryptor_password.fill(0);
        encryptor_key.fill(0);
        decrypted_password.fill(0);
        return;
    }

    password.fill(0);
    salt.fill(0);
    encryptor_password.fill(0);
    encryptor_key.fill(0);
    decrypted_password.fill(0);

    req.session.set('login', true);
    req.session.set('user', {
        user: req.body.username,
        userPrincipalName: req.body.username,
        displayName: req.body.username,
        givenName: req.body.username,
        isAdmin: user.admin === 1,
        isBanned: user.banned === 1,
        allowChangePassword: user.allowChangePassword === 1,
    });

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.body.username);

    rep.status(200).send({
        code: 'OK',
    });
}