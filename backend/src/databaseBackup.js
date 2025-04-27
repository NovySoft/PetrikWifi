import fs from 'fs';
import { createClient } from "webdav";
import logger from './logger.js';
import * as Sentry from "@sentry/node";
import { db } from './database.js';

export default function backupDatabase() {
    Sentry.startSpan(
        {
            name: "Backup Tasks",
            op: "cron.backup",
        },
        async () => {
            logger.info('Database backup started.');
            const backupTime = Date.now();
            const backupDate = new Date(backupTime);
            const pad = num => (num > 9 ? "" : "0") + num;
            let backupFileName = `./database/backup-${backupDate.getFullYear()}-${pad(backupDate.getMonth() + 1)}-${pad(backupDate.getDate())}.db`;
            if (process.env.NODE_ENV !== 'production') {
                backupFileName += '.test';
            }
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
                            await client.createDirectory('/Databases/Archive');
                        }

                        if (!directoryItems.some(item => item.filename === '/Logs')) {
                            logger.info('Creating /Logs directory on NextCloud...');
                            await client.createDirectory('/Logs');
                        }

                        const time = Date.now();
                        logger.info('Uploading database backup to NextCloud...');
                        await client.putFileContents('/Databases/' + backupFileName.split('/').pop(), fs.createReadStream(backupFileName), { overwrite: true });
                        logger.info('Today\'s database backup uploaded to NextCloud. Took ' + (Date.now() - time) + 'ms.');

                        if (backupDate.getDate() == 1) {
                            const archiveTime = Date.now();
                            const lastMonth = new Date(backupDate.getFullYear(), backupDate.getMonth() - 1, 1);
                            if (!(await client.exists('/Databases/Archive/' + lastMonth.getFullYear()))) {
                                logger.info('Creating /Databases/Archive/' + lastMonth.getFullYear() + ' directory on NextCloud...');
                                await client.createDirectory('/Databases/Archive/' + lastMonth.getFullYear());
                            }

                            logger.info('Copying last month\'s database backup to archive...');
                            await client.copyFile(
                                '/Databases/' + backupFileName.split('/').pop(),
                                `/Databases/Archive/${lastMonth.getFullYear()}/${backupFileName.split('/').pop()}`
                            );
                            logger.info(`Copying last month's database backup to archive finished. Took ${(Date.now() - archiveTime)}ms. (/Databases/Archive/${lastMonth.getFullYear()}/${backupFileName.split('/').pop()})`);
                        }

                        const deleteOldBackupsTime = Date.now();
                        logger.info('Deleting remote backups older than 30 days...');
                        const thirtyDaysAgo = new Date(backupDate.getTime() - (30 * 24 * 60 * 60 * 1000));
                        const items = (await client.getDirectoryContents('/Databases/')).filter(item => item.type === 'file' && new Date(item.lastmod) < thirtyDaysAgo);
                        for (const item of items) {
                            logger.info(`Deleting backup ${item.filename}...`);
                            await client.deleteFile(item.filename);
                        }
                        logger.info('Deleting remote backups older than 30 days finished. Took ' + (Date.now() - deleteOldBackupsTime) + 'ms.');

                        let logTime = Date.now();
                        logger.info('Uploading log file to NextCloud...');
                        let date = new Date(logTime);
                        date.setDate(date.getDate() - 1);
                        const logFilePath = `./logs/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
                        if (fs.existsSync(logFilePath)) {
                            let createNewFileName = '/Logs/' + logFilePath.split('/').pop();
                            if (process.env.NODE_ENV !== 'production') {
                                createNewFileName += '.test';
                            }
                            await client.putFileContents(createNewFileName, fs.createReadStream(logFilePath), { overwrite: true });
                            logger.info('Yesterday\'s log file uploaded to NextCloud. Took ' + (Date.now() - logTime) + 'ms.');
                        } else {
                            logger.warn(`Yesterday's log file not found. (${logFilePath}) Skipping upload.`);
                        }

                        logTime = Date.now();
                        const errorLogFilePath = `./logs/ERRORS-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
                        if (fs.existsSync(errorLogFilePath)) {
                            let createNewFileName = '/Logs/' + errorLogFilePath.split('/').pop();
                            if (process.env.NODE_ENV !== 'production') {
                                createNewFileName += '.test';
                            }
                            await client.putFileContents(createNewFileName, fs.createReadStream(errorLogFilePath), { overwrite: true });
                            logger.info('Yesterday\'s error log file uploaded to NextCloud. Took ' + (Date.now() - logTime) + 'ms.');
                        } else {
                            logger.info(`Yesterday's error log was probably empty. (${errorLogFilePath}) Skipping upload.`);
                        }

                        const deleteLogsTime = Date.now();
                        logger.info('Deleting remote logs older than 365 days...');
                        const aYearAgo = new Date(backupDate.getTime() - (365 * 24 * 60 * 60 * 1000));
                        const logItems = (await client.getDirectoryContents('/Logs/')).filter(item => item.type === 'file' && new Date(item.lastmod) < aYearAgo);
                        for (const item of logItems) {
                            logger.info(`Deleting log ${item.filename}...`);
                            await client.deleteFile(item.filename);
                        }
                        logger.info('Deleting remote logs older than 365 days finished. Took ' + (Date.now() - deleteLogsTime) + 'ms.');
                    } catch (err) {
                        logger.error('Error while uploading database backup to NextCloud: ' + err);
                        Sentry.captureException(err);
                    }
                })
                .catch((err) => {
                    logger.error('Backup failed: ' + err);
                    Sentry.captureException(err);
                });

            const deleteLocalBackupsTime = Date.now();
            logger.info('Deleting local backups older than 30 days...');
            const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
            const files = fs.readdirSync('./database/').filter(file => file.endsWith('.db'));
            for (const file of files) {
                const stats = fs.statSync(`./database/${file}`);
                if (stats.mtime < thirtyDaysAgo) {
                    logger.info(`Deleting local backup ${file}...`);
                    fs.unlinkSync(`./database/${file}`);
                }
            }
            logger.info('Deleting local backups older than 30 days finished. Took ' + (Date.now() - deleteLocalBackupsTime) + 'ms.');
        });
}
