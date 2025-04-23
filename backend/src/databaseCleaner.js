import { db } from './database.js';
import logger from './logger.js';
import * as Sentry from "@sentry/node";

export async function cleanDatabase() {
    Sentry.startSpan(
        {
            name: "Database Cleanup",
            op: "cron.dbcleanup",
        },
        async (span) => {
            const res = db.prepare('DELETE FROM Users WHERE expireAtDate IS NOT NULL AND expireAtDate < ?').run(Date.now());
            logger.info('Deleted ' + res.changes + ' expired users.');

            const res2 = db.prepare(`
                DELETE FROM Users 
                WHERE expireAfterInactiveDays IS NOT NULL 
                AND expireAfterInactiveDays != -1 
                AND lastActive < (? - (expireAfterInactiveDays * 24 * 60 * 60 * 1000))
            `).run(Date.now());
            logger.info('Deleted ' + res2.changes + ' inactive users.');
        },
    );
}