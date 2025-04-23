import { Cron } from 'croner';
import { cleanDatabase } from './databaseCleaner.js';
import { createClient } from "webdav";
import logger from './logger.js';
import fs from 'fs';
import * as Sentry from "@sentry/node";
import { db } from './database.js';

if (process.env.NX_CLOUD_URL == null || process.env.NX_CLOUD_USER == null || process.env.NX_CLOUD_PASS == null) {
    logger.warn("NextCloud credentials not set. Database and log will not be backed up!");
}
// Every minute: '* * * * *'
// Every day at 2:00: '0 2 * * *'
const job = new Cron('* * * * *', async () => {
    logger.info('Database cleaning started.');
    let time = Date.now();
    await cleanDatabase();
    logger.info('Database cleaning finished. Took ' + (Date.now() - time) + 'ms.');

    logger.info('Database backup started.');
    const backupTime = Date.now();
    const backupDate = new Date(backupTime);
    const pad = num => (num > 9 ? "" : "0") + num;
    const backupFileName = `./database/backup-${backupDate.getFullYear()}-${pad(backupDate.getMonth() + 1)}-${pad(backupDate.getDate())}.db`
    db.backup(backupFileName)
        .then(async () => {
            logger.info(`Database backup finished. (${backupFileName}) Took ${Date.now() - backupTime}ms.`);

            if (process.env.NX_CLOUD_URL == null || process.env.NX_CLOUD_USER == null || process.env.NX_CLOUD_PASS == null) {
                logger.warn("NextCloud credentials not set. Database and log will not be backed up!");
                return;
            }

            try {
                const client = createClient(
                    process.env.NX_CLOUD_URL + '/remote.php/dav/files/' + process.env.NX_CLOUD_USER,
                    {
                        username: process.env.NX_CLOUD_USER,
                        password: process.env.NX_CLOUD_PASS,
                    }
                );
                const directoryItems = await client.getDirectoryContents("/");

                if (!directoryItems.some(item => item.filename === '/Databases')) {
                    logger.info('Creating /Databases directory on NextCloud...');
                    await client.createDirectory('/Databases');
                }
                if (!directoryItems.some(item => item.filename === '/Logs')) {
                    logger.info('Creating /Logs directory on NextCloud...');
                    await client.createDirectory('/Logs');
                }

                let time = Date.now();
                logger.info('Uploading database backup to NextCloud...');
                await client.putFileContents('/Databases/' + backupFileName.split('/').pop(), fs.createReadStream(backupFileName), { overwrite: true });
                logger.info('Today\'s database backup uploaded to NextCloud. Took ' + (Date.now() - time) + 'ms.');

                time = Date.now();
                logger.info('Uploading log file to NextCloud...');
                const date = new Date(time);
                // Subtract 1 day to get the correct date for the log file name (saving yesterday's logs to yesterday's file)
                date.setDate(date.getDate() - 1);
                const logFilePath = `./logs/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
                if (fs.existsSync(logFilePath)) {
                    await client.putFileContents('/Logs/' + logFilePath.split('/').pop(), fs.createReadStream(logFilePath), { overwrite: true });
                    logger.info('Yesterday\'s log file uploaded to NextCloud. Took ' + (Date.now() - time) + 'ms.');
                } else {
                    logger.warn(`Yesterday's log file not found. (${logFilePath}) Skipping upload.`);
                }
            } catch (err) {
                logger.error('Error while uploading database backup to NextCloud: ' + err);
                Sentry.captureException(err);
            }
        })
        .catch((err) => {
            logger.error('Database backup failed: ' + err);
            Sentry.captureException(err);
        });

    logger.info('Log file cleaning started.');
    time = Date.now();
    // Delete empty log files
    const logFiles = fs.readdirSync('./logs/').filter(file => file.endsWith('.log'));
    for (const file of logFiles) {
        if (file === 'MAIN.log' || file === 'ERROS-MAIN.log') continue; // Skip main log files
        // Check if file is empty
        const stats = fs.statSync(`./logs/${file}`);
        if (stats.size === 0) {
            fs.unlinkSync(`./logs/${file}`);
            logger.info(`Deleted empty log file: ${file}`);
        }
    }
    logger.info('Log file cleaning finished. Took ' + (Date.now() - time) + 'ms.');
});

export default job;