import { Logger } from "tslog";
import { createStream } from "rotating-file-stream";
import { inspect } from "util";

const pad = num => (num > 9 ? "" : "0") + num;
const fileNameGenerator = (time, index) => {
    if (!time) return "./logs/MAIN.log";
    const date = new Date(time);
    // Subtract 1 day to get the correct date for the log file name (saving yesterday's logs to yesterday's file)
    date.setDate(date.getDate() - 1);

    return `./logs/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
};

const errFileNameGenerator = (time, index) => {
    if (!time) return "./logs/ERROS-MAIN.log";
    const date = new Date(time);
    // Subtract 1 day to get the correct date for the log file name (saving yesterday's logs to yesterday's file)
    date.setDate(date.getDate() - 1);

    return `./logs/ERRORS-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`;
};

const stream = createStream(fileNameGenerator, {
    interval: "1d", // rotate daily
    maxFiles: 90, // Keep 90 days of logs
    initialRotation: true,
    history: "logs-history.txt",
});
const errStream = createStream(errFileNameGenerator, {
    interval: "1d", // rotate daily
    maxFiles: 90, // Keep 90 days of logs
    initialRotation: true,
    history: "errors-history.txt",
});

const logger = new Logger({
    minLevel: process.env.NODE_ENV === 'production' ? 3 : 0,
    prettyLogTimeZone: "local",
    maskValuesOfKeys: [],
});
logger.attachTransport((logObj) => {
    const prefix = `${logObj._meta.date.toLocaleString('hu-HU', { timeZone: "Europe/Budapest" })} ${logObj._meta.logLevelName}: `
    let out = prefix;

    // Extract 5 depths of nested objects using util.inspect
    const copyOfMeta = { ...logObj._meta };
    delete logObj._meta;
    const objValues = Object.values(logObj);

    if (objValues.length === 1 && typeof objValues[0] === 'string') {
        out += objValues.join(' ');
    } else {
        if ('0' in logObj && logObj['0'] !== undefined && logObj['0'] !== null && typeof logObj['0'] === 'string') {
            out += logObj['0'];
            delete logObj['0'];
        }
        if (Object.keys(logObj).length > 0) {
            out += "\n";
            out += inspect(logObj, {
                depth: 5,
                colors: false,
            });
        }
    }

    stream.write(out + "\n");

    // Log errors and fatal logs to a separate file as well
    if (copyOfMeta.logLevelName === 'ERROR' || copyOfMeta.logLevelName === 'FATAL') {
        if (copyOfMeta.path.fullFilePath != undefined) {
            errStream.write(`(${copyOfMeta.path.fullFilePath}) `);
        }
        errStream.write(out + "\n");
    }
});

export default logger;