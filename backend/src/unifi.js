import Unifi from 'node-unifi';
import logger from './logger.js';
import * as Sentry from '@sentry/node';

export const unifi = new Unifi.Controller({ host: process.env.UNIFI_HOST, port: process.env.UNIFI_PORT, sslverify: false });

async function doTheConnection() {
    try {
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
        setInterval(async () =>{
            await unifi.logout();
            logger.debug('Logged out from UniFi controller');
            // Wait a bit before reconnecting
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.debug('Reconnecting to UniFi controller...');
            await doTheConnection();
            logger.debug('Reconnected to UniFi controller');
        }, 1000 * 60 * 5); // Keep the connection alive every 5 minutes
        logger.info('Connected to UniFi controller');
    } catch (error) {
        logger.error('Failed to connect to UniFi controller:', error);
        Sentry.captureException(error);
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
        await doTheConnection();
        const device = await unifi.getClientDevice(mac.toLowerCase().replaceAll('-', ':'));
        if (device == null || device.length !== 1) {
            logger.error(`Device with MAC ${mac} not found`);
            return;
        }

        const newName = `${device[0].hostname ?? 'NoHostname'} - ${username}`;
        const result = await unifi.setClientName(device[0]._id, newName);
        logger.debug(`Updated client name for ${mac} to "${newName}"`, result);
    } catch (error) {
        logger.error('Error updating client description:', error);
        Sentry.captureException(error);
    }
}