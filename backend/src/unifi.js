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
        if (unifi._isInit === true) {
            unifi._isInit = false; // Reset the connection state
            if (unifi._cookieJar && typeof unifi._cookieJar.removeAllCookiesSync === 'function') {
                unifi._cookieJar.removeAllCookiesSync(); // Clear cookies so UniFiOS detection doesn't break on retry
            }
        }

        const loginData = await unifi.login(process.env.UNIFI_USERNAME, process.env.UNIFI_PASSWORD);
        if (loginData === true) {
            logger.debug('Connected to UniFi controller successfully');
        } else {
            logger.error('Failed to connect to UniFi controller:', loginData);
            throw new Error('UniFi connection failed', loginData);
        }
    } catch (error) {
        logger.error('Error connecting to UniFi:', error);
        Sentry.captureException(error);
        await Sentry.flush(10000); // Wait for Sentry to send the event
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
        await Sentry.flush(10000); // Wait for Sentry to send the event
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
        let device = null;
        try {
            device = await unifi.getClientDevice(mac.toLowerCase().replaceAll('-', ':'));
            // HTTP 400
            /* data: {
                meta: {
                  rc: 'error',
                  mac: '9e:70:a8:8d:1b:d7',
                  msg: 'api.err.UnknownUser'
                },
                data: []
            } */
        } catch (error) {
            // Check if error is 401 Unauthorized
            if (error?.response?.status === 401 || (error?.response?.data?.meta?.rc === 'error' && error?.response?.data?.meta?.msg === 'api.err.LoginRequired')) {
                logger.debug('Session expired, re-authenticating with UniFi controller...');
                await doTheConnection();
                await Promise.resolve(new Promise(resolve => setTimeout(resolve, 50)));
                device = await unifi.getClientDevice(mac.toLowerCase().replaceAll('-', ':'));
            } else if (error?.response?.data?.meta?.rc === 'error' && error?.response?.data?.meta?.msg === 'api.err.UnknownUser') {
                logger.error(`UNIFI: Device with MAC ${mac} not found:`, error?.response?.data?.meta);
                return;
            } else {
                throw error;
            }
        }

        if (device == null || device.length !== 1) {
            logger.error(`UNIFI: Device with MAC ${mac} not found`);
            return;
        }
        logger.debug(`Found device with MAC ${mac}:`, device[0]);

        const newName = `${device[0].hostname ?? 'NoHostname'} - ${username}`;
        const result = await unifi.setClientName(device[0]._id, newName);
        logger.debug(`Updated client name for ${mac} to "${newName}"`, result);
    } catch (error) {
        logger.error('Error updating client description:', error);
        Sentry.captureException(error);
        await Sentry.flush(10000); // Wait for Sentry to send the event
    }
}

export async function rebootLongRunningDevices() {
    try {
        logger.debug('Connecting to UniFi for reboot task...');
        await doTheConnection();

        // 2. Fetch all UniFi devices
        logger.debug('Fetching UniFi devices...');
        const devices = await unifi.getAccessDevices();

        if (!devices || devices.length === 0) {
            logger.warn('No devices found.');
            return;
        }

        // Calculate 30 days in seconds
        const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

        // 3. Iterate through devices to check adoption status and uptime
        for (const device of devices) {
            // Only check devices that are adopted by this controller
            if (device.adopted) {
                const uptimeDays = (device.uptime / (24 * 60 * 60)).toFixed(2);

                if (device.uptime > THIRTY_DAYS_IN_SECONDS) {
                    logger.info(`[Rebooting] Device: ${device.name || device.mac} | Uptime: ${uptimeDays} days`);
                    // 4. Reboot the device using its MAC address
                    //await unifi.restartDevice(device.mac, 'soft');
                } else {
                    logger.debug(`[Skipping] Device: ${device.name || device.mac} | Uptime: ${uptimeDays} days (under 30 days)`);
                }
            }
        }

    } catch (error) {
        logger.error('Error occurred in rebootLongRunningDevices:', error);
        if (error.response) {
            logger.error(`Status: ${error.response.status}`);
            logger.error('URL requested:', error.response.config?.url);
            logger.error('Data:', error.response.data);
        }
        Sentry.captureException(error);
        await Sentry.flush(10000); // Wait for Sentry to send the event
    }
}

export async function getSpeedProfiles() {
    try {
        try {
            const result = await unifi.getUserGroups();
            return result;
        } catch (error) {
            if (error?.response?.status === 401) {
                logger.debug('Session expired, re-authenticating with UniFi controller...');
                await doTheConnection();
                await Promise.resolve(new Promise(resolve => setTimeout(resolve, 50)));
                const result = await unifi.getUserGroups();
                return result;
            }
            throw error;
        }
    } catch (error) {
        logger.error('Error fetching speed profiles from UniFi:', error);
        Sentry.captureException(error);
        await Sentry.flush(10000);
        return [];
    }
}

export async function deleteSpeedProfile(id) {
    try {
        try {
            const result = await unifi.deleteUserGroup(id);
            /*
            failed delete response example:
                {
    "meta": {
        "rc": "error",
        "type": "User",
        "id": "67ab0079541cee3198aaf7ca",
        "name": "c8:6e:08:37:d1:4c",
        "msg": "api.err.ObjectReferredBy"
    },
    "data": []
}
            */
            return result;
        } catch (error) {
            if (error?.response?.status === 401) {
                logger.debug('Session expired, re-authenticating with UniFi controller...');
                await doTheConnection();
                await Promise.resolve(new Promise(resolve => setTimeout(resolve, 50)));
                const result = await unifi.deleteUserGroup(id);
                return result;
            } else if (error?.response?.data?.meta?.rc === 'error' && error?.response?.data?.meta?.msg === 'api.err.ObjectReferredBy') {
                logger.error(`Failed to delete speed profile with id ${id} because it is still in use by a client.`, error?.response?.data?.meta);
                const e = new Error('Cannot delete speed profile because it is still in use by a client.');
                e.code = 'SPEED_PROFILE_IN_USE';
                throw e;
            }
            throw error;
        }
    } catch (error) {
        if (error.code === 'SPEED_PROFILE_IN_USE') {
            throw error;
        }
        logger.error('Error deleting speed profile from UniFi:', error);
        Sentry.captureException(error);
        await Sentry.flush(10000);
        throw error;
    }
}