import logger from "../../logger.js";
import { db } from "../../database.js";
import { getSalt, SUPER_SECRET_KEY, getKeyFromPassword, encrypt } from "../../encryptor.js";

export default async function updateSelfPassword(req, res) {
    if (req.session.get('login') !== true) {
        res.status(403).send({
            error: 'Forbidden',
            code: 'NOT_LOGGED_IN',
            message: 'You are not logged in.',
        });
        return;
    }
    
    if (req.body.password == undefined) {
        res.status(400).send({
            error: 'Bad Request',
            code: 'PASSWORD_MISSING',
            message: 'Password is missing.',
        });
        return;
    }

    const user = req.session.get('user');
    const user_exists = db.prepare('SELECT allowChangePassword FROM Users WHERE username = ?').get(user.userPrincipalName);
    if (user_exists?.allowChangePassword == 0) {
        res.status(403).send({
            error: 'Forbidden',
            code: 'PASSWORD_CHANGE_NOT_ALLOWED',
            message: 'Password change is not allowed for this user.',
        });
        logger.warn(`User ${user.userPrincipalName} tried to change their password but is not allowed to.`);
        return;
    }

    const salt = await getSalt();
    const encryptor_password = Buffer.from(`${user.userPrincipalName}-${SUPER_SECRET_KEY}`);
    const encryptor_key = getKeyFromPassword(encryptor_password, salt);
    const password = Buffer.from(req.body.password);
    const encrypted_password = encrypt(password, encryptor_key);

    if (user_exists == undefined || user_exists?.length == 0) {
        //Insert new user
        db.prepare('INSERT INTO Users (username, password, salt, lastActive) VALUES (?, ?, ?, ?)').run(user.userPrincipalName, encrypted_password.toString('hex'), salt.toString('hex'), Date.now());
        req.session.set('user', {
            ...user,
            allowChangePassword: 1
        });
    } else {
        //Update existing user
        db.prepare('UPDATE Users SET password = ?, salt = ?, lastActive = ? WHERE username = ?').run(encrypted_password.toString('hex'), salt.toString('hex'), Date.now(), user.userPrincipalName);
    }

    res.status(200).send({
        message: 'OK'
    });
    logger.info(`User ${user.userPrincipalName} updated their password`);

    //Clear all buffers - best practice
    salt.fill(0);
    encryptor_password.fill(0);
    encryptor_key.fill(0);
    password.fill(0);
    encrypted_password.fill(0);
}