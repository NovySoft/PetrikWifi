import { db } from "../../database.js";
import logger from "../../logger.js";

export default async function updateAp(req, rep) {
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

    const canonicalizeMac = s => s.toLowerCase().replace(/[-:]/g, '');
    const { ip, ap: apRaw, comment } = req.body;
    if (ip === undefined || apRaw === undefined || apRaw == '' || ip == '') {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'BAD_REQUEST',
            message: 'Missing required fields.',
        });
        return;
    }

    const ap = canonicalizeMac(apRaw);
    const existing = db.prepare('SELECT 1 FROM APs WHERE AP = ?').get(ap);
    if (existing == undefined || Object.keys(existing).length == 0) {
        rep.status(404).send({
            error: 'Not Found',
            code: 'NOT_FOUND',
            message: 'AP not found.',
        });
        return;
    }

    db.prepare('UPDATE APs SET IP = ?, comment = ? WHERE AP = ?').run(ip, comment, ap);

    db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), req.session.get('user').userPrincipalName);
    logger.info(`AP Updated: ${ap} (${ip}) - ${comment} by ${req.session.get('user').userPrincipalName}`);

    rep.status(200).send({
        code: 'OK',
        message: 'AP Updated',
    });
}