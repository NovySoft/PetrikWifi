import "./instrument.js";
import * as Sentry from "@sentry/node";
import Fastify from 'fastify';
import logger from './logger.js';
import { initDB, db } from './database.js';

process.on('unhandledRejection', (reason, p) => {
    logger.fatal("Unhandled Rejection at: Promise ", p, " reason: ", reason);
    Sentry.captureException(reason, p);
});

const fastify = Fastify({
    logger: false,
});

import rateLimiter from '@fastify/rate-limit';
await fastify.register(rateLimiter, {
    max: 500,
    timeWindow: 60000, // 60 seconds
});

fastify.addHook('onRequest', (request, reply, done) => {
    request.realip = (request.headers['x-real-ip'] ?? request.headers['cf-connecting-ip']) ?? request.ip;
    done();
});

fastify.addHook('onSend', (request, reply, payload, done) => {
    const user = request?.session?.get('user')?.userPrincipalName;

    if (request.url.toLowerCase().startsWith('/login/microsoft/callback')) {
        // Do not log the callback request, as it contains sensitive information
        logger.info(`REQUEST: ${request.realip} ${user != null ? '(' + user + ')' : ''} ${request.headers['user-agent'] ?? 'Unknown'}: ${request.method} /login/microsoft/callback/*** - ${reply.statusCode}`);
        done();
        return;
    }
    if (request.method === 'POST' && request.url == "/radius/authorize" && request.realip == FREERADIUS_IP && reply.statusCode == 200) {
        // Do not log the RADIUS authorize (only debug) request if it comes from the FreeRADIUS server and is a 200 OK response
        // Logging should be done in the radius.js file
        logger.debug(`REQUEST: ${request.realip} ${user != null ? '(' + user + ')' : ''} ${request.headers['user-agent'] ?? 'Unknown'}: ${request.method} ${request.url} - ${reply.statusCode}`);
        done();
        return;
    }

    if (request.method === 'HEAD' && request.url == "/ping" && request.realip === '127.0.0.1') {
        // Do not log the ping request if it comes from localhost
        logger.debug(`REQUEST: ${request.realip} ${user != null ? '(' + user + ')' : ''} ${request.headers['user-agent'] ?? 'Unknown'}: ${request.method} ${request.url} - ${reply.statusCode}`);
        done();
        return;
    }

    logger.info(`REQUEST: ${request.realip} ${user != null ? '(' + user + ')' : ''} ${request.headers['user-agent'] ?? 'Unknown'}: ${request.method} ${request.url} - ${reply.statusCode}`);
    done();
});

fastify.setErrorHandler(function (error, request, reply) {
    // Log error
    logger.error(error);
    Sentry.captureException(error);

    const errorResponse = {
        message: error.message,
        error: error.error,
        statusCode: error.statusCode || 500
    };

    reply.code(errorResponse.statusCode).send(errorResponse);
});

import oauthPlugin from '@fastify/oauth2';

if (process.env.MS_CLIENT_ID == null || process.env.MS_CLIENT_SECRET == null || process.env.MS_AUTHORIZE_PATH == null || process.env.MS_TOKEN_PATH == null) {
    logger.error('Microsoft OAuth2 not configured properly. Exiting...');
    process.exit(1);
}

fastify.register(oauthPlugin, {
    name: 'microsoftOAuth2',
    scope: ['user.read'],
    credentials: {
        client: {
            id: process.env.MS_CLIENT_ID,
            secret: process.env.MS_CLIENT_SECRET
        },
        auth: {
            authorizeHost: 'https://login.microsoftonline.com',
            authorizePath: process.env.MS_AUTHORIZE_PATH,
            tokenHost: 'https://login.microsoftonline.com',
            tokenPath: process.env.MS_TOKEN_PATH,
        },
    },
    // register a fastify url to start the redirect flow to the service provider's OAuth2 login
    startRedirectPath: '/login/microsoft',
    // service provider redirects here after user login
    callbackUri: process.env.REDIRECT_BASE + '/login/microsoft/callback'
});

fastify.get('/login/microsoft/callback', async function (request, reply) {
    try {
        const { token } = await this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)

        const me = await (await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
                Authorization: `Bearer ${token.access_token}`
            }
        })).json();

        if (!me.userPrincipalName.toLowerCase().includes('@petrik.hu')) {
            reply.status(403).send({
                error: 'Forbidden',
                code: 'PETRIK_HU_ONLY',
                message: 'Only Petrik.hu users are allowed to login.',
            });
            return;
        }

        request.session.set('login', true);

        const user = db.prepare('SELECT banned, admin, allowChangePassword FROM Users WHERE username = ?').get(me.userPrincipalName);
        logger.silly(user);

        if (user == null) {
            request.session.set('user', me);
        } else {
            db.prepare('UPDATE Users SET lastActive = ? WHERE username = ?').run(Date.now(), me.userPrincipalName);
            request.session.set('user', {
                ...me,
                isAdmin: user.admin === 1,
                isBanned: user.banned === 1,
                allowChangePassword: user.allowChangePassword === 1,
            });
        }

        reply.redirect('/dashboard.html');
    } catch (error) {
        logger.error(error);
        Sentry.captureException(error);
        // Try to include more details in the error message
        let errorDetails = error.message || 'Unknown error';
        if (error.cause && typeof error.cause === 'object') {
            if (error.cause.message) {
            errorDetails += `: ${error.cause.message}`;
            } else if (error.cause.code) {
            errorDetails += `: ${error.cause.code}`;
            }
        }
        if (error.code && !errorDetails.includes(error.code)) {
            errorDetails += ` (${error.code})`;
        }
        const errorMessage = encodeURIComponent(errorDetails);
        // Redirect to index page with error query parameter
        reply.redirect(`/index.html?error=microsoft_connection_error&error_details=${errorMessage}`);
    }
})

import secureSession from "@fastify/secure-session";
import fs from 'fs';
if (!fs.existsSync('./secret-key')) {
    logger.error('Secret key not found. Please generate a secret key using the following command:\n' +
        'npx --yes @fastify/secure-session > secret-key\n' +
        'or\n' +
        './node_modules/@fastify/secure-session/genkey.js > secret-key\n' +
        'Then restart the server.');
    process.exit(1);
}
fastify.register(secureSession, {
    sessionName: 'session',
    cookieName: 'SessionID',
    key: fs.readFileSync('./secret-key'),
    expiry: 24 * 60 * 60, // Default 1 day
    cookie: {
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
        secure: process.env.NODE_ENV === 'production',
        // options for setCookie, see https://github.com/fastify/fastify-cookie
    }
});

import radius, { FREERADIUS_IP } from './radius.js';
fastify.post('/radius/*', {
    config: {
        rateLimit: {
            allowList: [FREERADIUS_IP], // DO NOT rate limit FreeRADIUS server
        }
    }
}, radius);

fastify.get('/ping', (req, rep) => {
    req.session.touch();
    rep.status(200).send('Pong!');
});

/* User operations */
import userLogin from './router/user/userlogin.js';
fastify.post('/userlogin', {
    config: {
        rateLimit: {
            max: 5,
            timeWindow: 10000, // 10 seconds
        }
    }
}, userLogin);


const userConfig = {
    config: {
        rateLimit: {
            max: 20,
            timeWindow: 30000, // 30 seconds
        }
    }
};


import updateSelfPassword from './router/user/updateSelfPassword.js';
fastify.post('/update-password', userConfig, updateSelfPassword);

import logout from './router/user/logout.js';
fastify.post('/logout', userConfig, logout);

import me from './router/user/getSelf_ME.js';
fastify.post('/me', userConfig, me);

/* Admin activities no need to ratelimit */

import createUser from './router/user/createUser.js';
fastify.post('/createUser', createUser);

import updateUser from './router/user/updateUser.js';
fastify.post('/updateUser', updateUser);

import getAllUsers from './router/user/getAllUsers.js';
fastify.post('/getAllUsers', getAllUsers);

import deleteUser from './router/user/deleteUser.js';
fastify.post('/deleteUser', deleteUser);

/* AP operations */

import getAllAps from './router/ap/getAllAps.js';
fastify.post('/getAllAps', getAllAps);

import createAp from './router/ap/createAp.js';
fastify.post('/createAp', createAp);

import updateAp from './router/ap/updateAp.js';
fastify.post('/updateAp', updateAp);

import deleteAp from './router/ap/deleteAp.js';
fastify.post('/deleteAp', deleteAp);

/* Device operations */
import getAllDevices from './router/devices/getAllDevices.js';
fastify.post('/getAllDevices', getAllDevices);

import updateDevice from "./router/devices/updateDevice.js";
fastify.post('/updateDevice', updateDevice);

import getSelfDevices from './router/devices/getSelfDevices.js';
fastify.post('/getSelfDevices', getSelfDevices);

import deleteDevice from './router/devices/deleteDevice.js';
fastify.post('/deleteDevice', deleteDevice);

import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../frontend'),
});

fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../logs'),
    prefix: '/logs/',
    decorateReply: false, // the reply decorator has been added by the first plugin registration,
    index: false,
    list: true, // List all files in the directory
    allowedPath: (path, root, req) => {
        // Only allow admins to access logs
        return req.session?.get('login') === true && req.session.get('user').isAdmin === true;
    }
});

import cronJob from './cron.js';
logger.info('Cron job registered. Next 3 runs:', cronJob.nextRuns(3).map((date) => date.toLocaleString('hu-HU', { timeZone: "Europe/Budapest" })));

async function main() {
    try {
        initDB();
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        logger.info('Server listening: 3000');
    } catch (err) {
        fastify.log.error(err);
        logger.fatal(err);
        process.exit(1);
    }
}

main();