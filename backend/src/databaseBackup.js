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
        (rootBackupSpan) => {
            Sentry.startSpan({
                name: "Database Backup",
                op: "cron.dbbackup"
            }, async (dbbackupSpan) => {
                logger.info('Database backup started.');
                const backupTime = Date.now();
                const backupDate = new Date(backupTime);
                const pad = num => (num > 9 ? "" : "0") + num;
                const backupFileName = `./database/backup-${backupDate.getFullYear()}-${pad(backupDate.getMonth() + 1)}-${pad(backupDate.getDate())}.db`
                db.backup(backupFileName)
                    .then(async () => {
                        dbbackupSpan.end();
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
                                        await client.createDirectory('/Databases/Archive');
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

                                    if (backupDate.getDate() == 1) {
                                        uploadDbSpan.setAttribute('isFirstDayOfMonth', true);
                                        Sentry.startSpan(
                                            {
                                                name: "Database Backup - Upload to NextCloud - Archive",
                                                op: "cron.dbbackup_upload_archive",
                                            },
                                            async (uploadArchiveSpan) => {
                                                const time = Date.now();
                                                // If today is the first day of the month, create an archive of the last month
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
                                                logger.info(`Copying last month's database backup to archive finished. Took ${(Date.now() - time)}ms. (/Databases/Archive/${lastMonth.getFullYear()}/${backupFileName.split('/').pop()})`);
                                            }
                                        );
                                    }

                                    // Delete remote backups older than 30 days
                                    Sentry.startSpan(
                                        {
                                            name: "Database Backup - Upload to NextCloud - Delete Old Backups",
                                            op: "cron.dbbackup_upload_delete_old_backups",
                                        },
                                        async (deleteOldBackupsSpan) => {
                                            // Delete backups older than 30 days
                                            const time = Date.now();
                                            logger.info('Deleting remote backups older than 30 days...');
                                            const thirtyDaysAgo = new Date(backupDate.getTime() - (30 * 24 * 60 * 60 * 1000));
                                            const items = (await client.getDirectoryContents('/Databases/')).filter(item => item.type === 'file' && new Date(item.lastmod) < thirtyDaysAgo);
                                            for (const item of items) {
                                                logger.info(`Deleting backup ${item.filename}...`);
                                                await client.deleteFile(item.filename);
                                            }
                                            logger.info('Deleting remote backups older than 30 days finished. Took ' + (Date.now() - time) + 'ms.');
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
                        logger.error('Backup failed: ' + err);
                        Sentry.captureException(err);
                    });
            });

            // Delete local backups older than 30 days
            Sentry.startSpan(
                {
                    name: "Database Backup - Delete Local Backups",
                    op: "cron.dbbackup_delete_local_backups",
                },
                (deleteLocalBackupsSpan) => {
                    const time = Date.now();
                    logger.info('Deleting local backups older than 30 days...');
                    const thirtyDaysAgo = new Date(backupDate.getTime() - (30 * 24 * 60 * 60 * 1000));
                    const files = fs.readdirSync('./database/').filter(file => file.endsWith('.db'));
                    for (const file of files) {
                        const stats = fs.statSync(`./database/${file}`);
                        if (stats.mtime < thirtyDaysAgo) {
                            logger.info(`Deleting local backup ${file}...`);
                            fs.unlinkSync(`./database/${file}`);
                        }
                    }
                    logger.info('Deleting local backups older than 30 days finished. Took ' + (Date.now() - time) + 'ms.');
                }
            );
        });
}