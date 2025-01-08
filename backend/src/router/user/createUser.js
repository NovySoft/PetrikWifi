import { db } from '../../database.js';
import { getSalt, SUPER_SECRET_KEY, getKeyFromPassword, encrypt } from '../../encryptor.js';
import logger from '../../logger.js';

export default async function createUser(req, rep) {
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

    logger.silly(req.body);

    if (req.body.username == undefined || req.body.password == undefined) {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'USERNAME_PASSWORD_MISSING',
            message: 'Username or password is missing.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);

    const user = db.prepare('SELECT 1 FROM Users WHERE username = ?').get(req.body.username);
    if (user != null) {
        rep.status(409).send({
            error: 'Conflict',
            code: 'USER_EXISTS',
            message: 'User already exists.',
        });
        return;
    }

    const salt = await getSalt();
    const encryptor_password = Buffer.from(`${req.body.username}-${SUPER_SECRET_KEY}`);
    const encryptor_key = getKeyFromPassword(encryptor_password, salt);
    const password = Buffer.from(req.body.password);
    const encrypted_password = encrypt(password, encryptor_key);

    db.prepare('INSERT INTO Users (username, password, salt, lastActive, admin, expireAfterInactiveDays, expireAtDate, allowChangePassword, banned, isManual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').run(
        req.body.username,
        encrypted_password.toString('hex'),
        salt.toString('hex'),
        Date.now(),
        req.body.admin ? 1 : 0,
        req.body.expireAfterInactiveDays == -1 ? null : (req.body.expireAfterInactiveDays ?? 100),
        req.body.expireAtDate ?? null,
        req.body.allowChangePassword ? 1 : 0,
        req.body.banned ? 1 : 0,
    );

    salt.fill(0);
    encryptor_password.fill(0);
    encryptor_key.fill(0);
    password.fill(0);
    encrypted_password.fill(0);

    rep.status(201).send({
        message: 'User created.',
        code: 'OK',
    });
    logger.info(`User ${req.body.username} created by ${req.session.get('user').userPrincipalName}`);
}