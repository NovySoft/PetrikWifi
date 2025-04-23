import fs from 'fs';
import { createClient } from "webdav";
import logger from './logger.js';
import * as Sentry from "@sentry/node";
import { db } from './database.js';

export default function backupDatabase() {
    Sentry.startSpan(
        {
            name: "Database Backup",
            op: "cron.dbbackup",
        },
        (span) => {
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

                    Sentry.startSpan(
                        {
                            name: "Database Backup - Upload to NextCloud",
                            op: "cron.dbbackup_upload",
                        },
                        async (uploadSpan) => {
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

                                Sentry.startSpan(
                                    {
                                        name: "Database Backup - Upload to NextCloud - Database",
                                        op: "cron.dbbackup_upload_db",
                                    },
                                    async (uploadDbSpan) => {
                                        const time = Date.now();
                                        logger.info('Uploading database backup to NextCloud...');
                                        await client.putFileContents('/Databases/' + backupFileName.split('/').pop(), fs.createReadStream(backupFileName), { overwrite: true });
                                        logger.info('Today\'s database backup uploaded to NextCloud. Took ' + (Date.now() - time) + 'ms.');
                                    }
                                );

                                Sentry.startSpan(
                                    {
                                        name: "Database Backup - Upload to NextCloud - Logs",
                                        op: "cron.dbbackup_upload_logs",
                                    },
                                    async (uploadLogsSpan) => {
                                        const time = Date.now();
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
                                    }
                                );
                            } catch (err) {
                                logger.error('Error while uploading database backup to NextCloud: ' + err);
                                Sentry.captureException(err);
                            }
                        });
                })
                .catch((err) => {
                    logger.error('Database backup failed: ' + err);
                    Sentry.captureException(err);
                });
        });
}