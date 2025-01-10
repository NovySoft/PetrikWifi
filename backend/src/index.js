import "./instrument.js";
import * as Sentry from "@sentry/node";
import Fastify from 'fastify';
import radius from './radius.js';
import logger from './logger.js';
import { initDB, db } from './database.js';

const fastify = Fastify({
    logger: false,
});

import rateLimiter from '@fastify/rate-limit';
await fastify.register(rateLimiter, {
    max: 500,
    timeWindow: 60000, // 60 seconds
});

fastify.addHook('onRequest', (request, reply, done) => {
    request.realip = request.headers['x-real-ip'] ?? request.ip;
    done();
});

fastify.addHook('onSend', (request, reply, payload, done) => {
    const user = request?.session?.get('user')?.userPrincipalName;
    if (request.url.toLowerCase().startsWith('/login/microsoft/callback')) {
        logger.info(`REQUEST: ${request.realip} ${user != null ? '(' + user + ')' : ''} ${request.headers['user-agent'] ?? 'Unknown'}: ${request.method} /login/microsoft/callback/*** - ${reply.statusCode}`);
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
})

import secureSession from "@fastify/secure-session";
import fs from 'fs';
fastify.register(secureSession, {
    sessionName: 'session',
    cookieName: 'SessionID',
    key: fs.readFileSync('./secret-key'),
    expiry: 24 * 60 * 60, // Default 1 day
    cookie: {
        path: '/'
        // options for setCookie, see https://github.com/fastify/fastify-cookie
    }
});

fastify.post('/radius/*', radius);
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

import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../frontend'),
});

import { Cron } from 'croner';
import { cleanDatabase } from './databaseCleaner.js';
// Every minute: '* * * * *'
// Every day at 2:00: '0 2 * * *'
const job = new Cron('0 2 * * *', async () => {
    logger.info('Database cleaning started.');
    const time = Date.now();
    await cleanDatabase();
    logger.info('Database cleaning finished. Took ' + (Date.now() - time) + 'ms.');
});

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