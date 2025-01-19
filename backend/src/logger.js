import { Logger } from "tslog";
import { createStream } from "rotating-file-stream";

const pad = num => (num > 9 ? "" : "0") + num;
const fileNameGenerator = (time, index) => {
    if (!time) return "./logs/MAIN.log";

    return `./logs/${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}.log`;
};

const errFileNameGenerator = (time, index) => {
    if (!time) return "./logs/ERROS-MAIN.log";

    return `./logs/ERRORS-${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}.log`;
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
    const prefix = `${logObj._meta.date.toLocaleString('hu-HU', {timeZone: "Europe/Budapest"})} ${logObj._meta.logLevelName}: `
    const out = prefix + Object.values(Object.assign({}, logObj, {_meta: ''})).join(' ');
    stream.write(out + "\n");
    if (logObj._meta.logLevelName === 'ERROR' || logObj._meta.logLevelName === 'FATAL') {
        // Log to error stream as well
        if (logObj._meta.path.fullFilePath != undefined) {
            errStream.write(`(${logObj._meta.path.fullFilePath}) `);
        }
        errStream.write(out);
        errStream.write("\n");
    }
});

export default logger;