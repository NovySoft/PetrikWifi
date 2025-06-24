import Database from 'better-sqlite3';
import logger from './logger.js';
export const db = new Database('./database/database.db', {
	verbose: (msg, ...args) => {
		logger.debug("SQLITE: " + msg, ...args);
	},
});

export function initDB() {
	db.pragma('journal_mode = WAL');
	db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
	    userID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	    username TEXT NOT NULL,
	    password TEXT NOT NULL,
	    salt TEXT NOT NULL,
		allowChangePassword INTEGER DEFAULT (1) NOT NULL,
	    admin INTEGER DEFAULT (0) NOT NULL,
	    isManual INTEGER DEFAULT (0) NOT NULL,
		banned INTEGER DEFAULT (0) NOT NULL,
	    lastActive INTEGER,
		expireAfterInactiveDays INTEGER DEFAULT (100),
		expireAtDate INTEGER,
		comment TEXT,
		allowedDevices TEXT
    );
    `);

	try {
		db.exec(`
    		CREATE UNIQUE INDEX Users_username_IDX ON Users (username);
    	`);
	} catch (_) { }

	db.exec(`
		CREATE TABLE IF NOT EXISTS APs (
			AP TEXT NOT NULL PRIMARY KEY,
			IP TEXT NOT NULL,
			comment TEXT
		);
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS Devices (
			userID INTEGER NOT NULL,
			device TEXT NOT NULL,
			comment TEXT,
	    	lastActive INTEGER,
			banned INTEGER DEFAULT (0) NOT NULL,
			CONSTRAINT Devices_Users_FK FOREIGN KEY (userID) REFERENCES Users(userID) ON DELETE CASCADE ON UPDATE CASCADE
		);
	`);

	try {
		db.exec(`
			CREATE INDEX Devices_device_IDX ON Devices (device);
		`);
	} catch (_) { }
}