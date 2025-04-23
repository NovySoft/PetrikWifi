import { Cron } from 'croner';
import { cleanDatabase } from './databaseCleaner.js';
import logger from './logger.js';
import fs from 'fs';
import * as Sentry from "@sentry/node";
import backupDatabase from './databaseBackup.js';

if (process.env.NX_CLOUD_URL == null || process.env.NX_CLOUD_USER == null || process.env.NX_CLOUD_PASS == null) {
    logger.warn("NextCloud credentials not set. Database and log will not be backed up!");
}
// Every minute: '* * * * *'
// Every day at 2:00: '0 2 * * *'
const job = new Cron('0 2 * * *', () => {
    Sentry.startSpan(
        {
            name: "Daily Cron job",
            op: "cron.job",
        },
        async (wholeCronSpan) => {
            // Your database operation here
            logger.info('Database cleaning started.');
            let cleanDbTime = Date.now();
            cleanDatabase().then(() => {
                logger.info('Database cleaning finished. Took ' + (Date.now() - cleanDbTime) + 'ms.');
            });

            logger.info('Log file cleaning started.');
            let time = Date.now();
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

            backupDatabase();
        },
    );
});

export default job;