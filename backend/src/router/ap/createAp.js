import { db } from "../../database.js";
import logger from "../../logger.js";

export default async function createAp(req, rep) {
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

    const { ip, ap, comment } = req.body;
    if (ip === undefined || ap === undefined || ap == '' || ip == '') {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'BAD_REQUEST',
            message: 'Missing required fields.',
        });
        return;
    }

    const existing = db.prepare('SELECT 1 FROM APs WHERE IP = ? or AP = ?').get(ip, ap);
    if (existing !== undefined && existing?.length > 0) {
        rep.status(409).send({
            error: 'Conflict',
            code: 'CONFLICT',
            message: 'AP already exists.',
        });
        return;
    }

    db.prepare('INSERT INTO APs (IP, AP, comment) VALUES (?, ?, ?)').run(ip, ap, comment);

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);
    logger.info(`AP Created: ${ap} (${ip}) - ${comment} by ${req.session.get('user').userPrincipalName}`);

    rep.status(201).send({
        code: 'OK',
        message: 'AP Created',
    });
}