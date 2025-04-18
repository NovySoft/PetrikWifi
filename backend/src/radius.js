import logger from './logger.js';
import { db } from './database.js';
import { SUPER_SECRET_KEY, getKeyFromPassword, decrypt } from "./encryptor.js";
export const FREERADIUS_IP = "172.18.1.2";

export default async function handler(request, reply) {
    // request.body {username: 'novylevi', password: '', source: 'EA-B7-EE-4E-58-57', destination: '78-8A-20-8D-71-79:Petrik-Radius-Test', 'IP': '127.0.0.1', 'NAS': '78-8A-20-8D-71-79'}
    logger.silly(request.body);

    if (process.env.NODE_ENV === 'production') {
        // Healthtest User
        if (request.body.username === 'radtest') {
            // Check if the request is coming from the FreeRADIUS server itself
            if (request.body.source != "02-00-00-00-00-01" || request.body.IP != "127.0.0.1") {
                reply.status(403).send({
                    error: 'Forbidden',
                    code: 'FORBIDDEN',
                    message: 'You are not allowed to access this resource.',
                });
                logger.warn(`RADIUS: Healthtest User Request from ${request.body.IP} is not allowed.`, request.body);
                return;
            }
        } else {
            // Check if the request is coming from the FreeRADIUS server
            if (request.realip !== FREERADIUS_IP) {
                reply.status(403).send({
                    error: 'Forbidden',
                    code: 'FORBIDDEN',
                    message: 'You are not allowed to access this resource.',
                });
                logger.warn(`RADIUS: Request from ${request.body.IP} is not an allowed IP address.`, request.body);
                return;
            }

            // Check if the request is coming from authorized NAS
            const nas = db.prepare('SELECT * FROM APs WHERE AP = ?').get(request.body.NAS.toUpperCase());
            if (nas == undefined || nas?.length == 0) {
                reply.status(403).send({
                    error: 'Forbidden',
                    code: 'FORBIDDEN',
                    message: 'You are not allowed to access this resource.',
                });
                logger.warn(`RADIUS: Request from ${request.body.destination} is not an allowed NAS.`, request.body);
                return;
            }

            // Check if the request is coming from the correct IP address - Mac Binding
            if (nas.IP !== request.body.IP) {
                reply.status(403).send({
                    error: 'Forbidden',
                    code: 'FORBIDDEN',
                    message: 'You are not allowed to access this resource.',
                });
                logger.warn(`RADIUS: Request from ${request.body.IP} is not an allowed IP address of ${request.body.destination}. Expected: ${nas.IP}`, request.body);
                return;
            }
        }
    }

    if (request.url == "/radius/authorize") {
        const user = db.prepare('SELECT * FROM Users WHERE username = ?').get(request.body.username);

        if (user == undefined) {
            reply.status(404).send({
                error: 'Not Found',
                code: 'NOT_FOUND',
                message: 'The requested user was not found.',
            });
            logger.info(`RADIUS: User Not Found: ${request.body.username}`, request.body);
            return;
        }

        db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), request.body.username);

        if (user.banned == 1) {
            reply.status(403).send({
                error: 'Forbidden',
                code: 'FORBIDDEN',
                message: 'You are not allowed to access this resource.',
            });
            logger.warn(`RADIUS: User Banned: ${request.body.username} tried to authenticate.`, request.body);
            return;
        }

        const deviceInfo = db.prepare('SELECT * FROM Devices WHERE device = ?').all(request.body.source);
        if (deviceInfo == undefined || deviceInfo?.length == 0) {
            // This device is not in the database
            db.prepare('INSERT INTO Devices (userID, device, lastActive) VALUES (?, ?, ?)').run(user.userID, request.body.source, Date.now());
        } else {
            // Devices is in the database
            db.prepare('UPDATE Devices SET lastActive = ? WHERE device = ?').run(Date.now(), request.body.source);

            // This device is not associated with this user (but it is in the database)
            if (!deviceInfo.some(device => device.userID == user.userID)) {
                db.prepare('INSERT INTO Devices (userID, device, lastActive) VALUES (?, ?, ?)').run(user.userID, request.body.source, Date.now());
            }
        }

        // Check if the device is banned
        if (deviceInfo.banned == 1 || deviceInfo.some(device => device.banned == 1)) {
            reply.status(403).send({
                error: 'Forbidden',
                code: 'FORBIDDEN',
                message: 'You are not allowed to access this resource.',
            });
            logger.warn(`RADIUS: Device Banned: ${request.body.source} tried to authenticate.`, request.body);
            return;
        }

        const password = Buffer.from(user.password, 'hex');
        const salt = Buffer.from(user.salt, 'hex');
        const encryptor_password = Buffer.from(`${user.username}-${SUPER_SECRET_KEY}`);
        const encryptor_key = getKeyFromPassword(encryptor_password, salt);
        const decrypted_password = decrypt(password, encryptor_key);

        reply
            .status(200)
            .header('Content-Type', 'application/json; charset=utf-8')
            .send({
                'control:Cleartext-Password': decrypted_password.toString('utf8'),
                'Cleartext-Password': decrypted_password.toString('utf8'),
                'Session-Timeout': 1 * 60 * 60, // 1 hours
            });

        if (request.body.username === 'radtest') {
            logger.debug(`RADIUS: Healthtest User: ${request.body.username} (${request.body.source}) auth info sent to ${request.body.destination}`);
        } else {
            logger.info(`RADIUS SUCCESS: ${request.body.username} (${request.body.source}) auth info sent to ${request.body.destination}`);
        }

        //Clear all buffers - best practice
        salt.fill(0);
        encryptor_password.fill(0);
        encryptor_key.fill(0);
        password.fill(0);
        decrypted_password.fill(0);
    } else {
        reply.status(404).send({
            error: 'Not Found',
            code: 'NOT_FOUND',
            message: 'The requested resource was not found.',
        });
        logger.error(`RADIUS: Not Found: ${request.url}`, request.body);
    }
}