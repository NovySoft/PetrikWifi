import { db } from "../../database.js";
import logger from "../../logger.js";

export default async function deleteDevice(req, rep) {
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

    const { userID, device } = req.body;
    if (userID === undefined || device === undefined || device == '' || userID == '') {
        rep.status(400).send({
            error: 'Bad Request',
            code: 'BAD_REQUEST',
            message: 'Missing required fields.',
        });
        return;
    }

    const existing = db.prepare('SELECT 1 FROM Devices WHERE device = ? AND userID = ?').get(device, userID);
    if (existing == undefined || existing?.length == 0) {
        rep.status(404).send({
            error: 'Not Found',
            code: 'NOT_FOUND',
            message: 'Device not found.',
        });
        return;
    }

    db.prepare('DELETE FROM Devices WHERE device = ? AND userID = ?').run(device, userID);
    logger.info(`Device Deleted: ${device} (userID ${userID}) by ${req.session.get('user').userPrincipalName}`);
    rep.status(200).send({
        code: 'OK',
        message: 'Device Deleted',
    });
}