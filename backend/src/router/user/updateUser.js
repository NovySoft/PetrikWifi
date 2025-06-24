import { db } from '../../database.js';
import { getSalt, SUPER_SECRET_KEY, getKeyFromPassword, encrypt } from '../../encryptor.js';
import logger from '../../logger.js';

export default async function updateUser(req, res) {
    if (req.session.get('login') !== true) {
        res.status(403).send({
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

    if (req.body.username == undefined) {
        res.status(400).send({
            error: 'Bad Request',
            code: 'USERNAME_MISSING',
            message: 'Username is missing.',
        });
        return;
    }

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);

    const user = db.prepare('SELECT 1 FROM Users WHERE username = ?').get(req.body.username);
    if (user == null) {
        res.status(404).send({
            error: 'Not Found',
            code: 'USER_NOT_FOUND',
            message: 'User not found.',
        });
        return;
    }

    let update = {};

    if (req.body.password != undefined) {
        const salt = await getSalt();
        const encryptor_password = Buffer.from(`${req.body.username}-${SUPER_SECRET_KEY}`);
        const encryptor_key = getKeyFromPassword(encryptor_password, salt);
        const password = Buffer.from(req.body.password);
        const encrypted_password = encrypt(password, encryptor_key);

        update.password = encrypted_password.toString('hex');
        update.salt = salt.toString('hex');

        salt.fill(0);
        encrypted_password.fill(0);
        encryptor_key.fill(0);
        encryptor_password.fill(0);
        password.fill(0);
    }

    if (req.body.admin != undefined) {
        update.admin = req.body.admin ? 1 : 0;
    }

    if (req.body.expireAfterInactiveDays != undefined) {
        update.expireAfterInactiveDays =
            (req.body.expireAfterInactiveDays == -1) ? null : parseInt(req.body.expireAfterInactiveDays);
    }

    if (req.body.expireAtDate != undefined) {
        update.expireAtDate = parseInt(req.body.expireAtDate);
    }
    if (update.expireAtDate == "") {
        update.expireAfterInactiveDays = null;
    }

    if (req.body.allowChangePassword != undefined) {
        update.allowChangePassword = req.body.allowChangePassword ? 1 : 0;
    }

    if (req.body.banned != undefined) {
        update.banned = req.body.banned ? 1 : 0;
    }

    if (req.body.comment != undefined) {
        update.comment = req.body.comment;
    }

    if (req.body.isManual != undefined) {
        update.isManual = req.body.isManual ? 1 : 0;
    }

    if (req.body.allowedDevices == "" || req.body.allowedDevices == [] || req.body.allowedDevices == "[]") {
        update.allowedDevices = null;
    } else if (req.body.allowedDevices != undefined) {
        update.allowedDevices = JSON.stringify(req.body.allowedDevices);
    }

    db.prepare(`UPDATE Users SET ${Object.keys(update).map(key => `${key} = ?`).join(', ')}, lastActive = ? WHERE username = ?`).run(
        ...Object.values(update),
        Date.now(),
        req.body.username,
    );

    update = null;

    res.status(200).send({
        success: true,
    });
}