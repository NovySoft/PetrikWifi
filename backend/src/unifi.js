import Unifi from 'node-unifi';
import logger from './logger.js';
import * as Sentry from '@sentry/node';

export const unifi = new Unifi.Controller({
    host: process.env.UNIFI_HOST,
    port: process.env.UNIFI_PORT,
    username: process.env.UNIFI_USERNAME,
    password: process.env.UNIFI_PASSWORD,
    sslverify: false,
});

async function doTheConnection() {
    try {
        unifi._isInit = false; // Reset the connection state
        const loginData = await unifi.login(process.env.UNIFI_USERNAME, process.env.UNIFI_PASSWORD);
        if (loginData === true) {
            logger.debug('Connected to UniFi controller successfully');
        } else {
            logger.error('Failed to connect to UniFi controller:', loginData);
            throw new Error('UniFi connection failed', loginData);
        }
    } catch (error) {
        console.error('Error connecting to UniFi:', error);
        Sentry.captureException(error);
        await Sentry.flush(5000); // Wait for Sentry to send the event
    }
}

export async function connectToUnifi() {
    if (!process.env.UNIFI_HOST || !process.env.UNIFI_PORT || !process.env.UNIFI_USERNAME || !process.env.UNIFI_PASSWORD) {
        logger.error('Missing UniFi environment variables: UNIFI_HOST, UNIFI_PORT, UNIFI_USERNAME, UNIFI_PASSWORD');
        logger.error('Please set these variables, skipping UniFi connection');
        return;
    }

    try {
        await doTheConnection();
        logger.info('Connected to UniFi controller');
    } catch (error) {
        logger.error('Failed to connect to UniFi controller:', error);
        Sentry.captureException(error);
        await Sentry.flush(5000); // Wait for Sentry to send the event
    }
}

export async function updateUnifiClientName(mac, username) {
    if (!process.env.UNIFI_HOST || !process.env.UNIFI_PORT || !process.env.UNIFI_USERNAME || !process.env.UNIFI_PASSWORD) {
        // If UniFi environment variables are not set, skip the update
        return;
    }

    if (!mac || !username) {
        logger.error('MAC address and username are required to update client description');
        return;
    }

    try {
        try {
            await unifi.logout();
            await Promise.resolve(new Promise(resolve => setTimeout(resolve, 50)));
        } catch (error) {
            logger.warn('Error during logout - Session might have expired, continuing with connection:', error);
            Sentry.captureException(error);
            await Sentry.flush(5000); // Wait for Sentry to send the event
        }

        //Wait for 50ms to ensure the connection is established
        await doTheConnection();
        await Promise.resolve(new Promise(resolve => setTimeout(resolve, 50)));

        const device = await unifi.getClientDevice(mac.toLowerCase().replaceAll('-', ':'));
        if (device == null || device.length !== 1) {
            logger.error(`Device with MAC ${mac} not found`);
            return;
        }
        logger.debug(`Found device with MAC ${mac}:`, device[0]);

        const newName = `${device[0].hostname ?? 'NoHostname'} - ${username}`;
        const result = await unifi.setClientName(device[0]._id, newName);
        logger.debug(`Updated client name for ${mac} to "${newName}"`, result);
    } catch (error) {
        logger.error('Error updating client description:', error);
        Sentry.captureException(error);
        await Sentry.flush(5000); // Wait for Sentry to send the event
    }
}