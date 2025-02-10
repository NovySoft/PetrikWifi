// creating function declarations for better stacktraces (otherwise they'd be anonymous function expressions)
var oldConsoleError = console.error;
console.error = reportingConsoleError; // defined via function hoisting
function reportingConsoleError() {
    var args = Array.prototype.slice.call(arguments);
    Sentry.captureException(reduceConsoleArgs(args));
    return oldConsoleError.apply(console, args);
};

var oldConsoleWarn = console.warn;
console.warn = reportingConsoleWarn; // defined via function hoisting
function reportingConsoleWarn() {
    var args = Array.prototype.slice.call(arguments);
    Sentry.captureMessage(reduceConsoleArgs(args), 'warning');
    return oldConsoleWarn.apply(console, args);
}

var oldConsoleLog = console.log;
console.log = reportingConsoleLog;
function reportingConsoleLog() {
    var args = Array.prototype.slice.call(arguments);
    Sentry.addBreadcrumb({ level: 'log', message: reduceConsoleArgs(args) });
    return oldConsoleLog.apply(console, args);
}

function reduceConsoleArgs(args) {
    let errorMsg = args[0];
    // Make sure errorMsg is either an error or string.
    // It's therefore best to pass in new Error('msg') instead of just 'msg' since
    // that'll give you a stack trace leading up to the creation of that new Error
    // whereas if you just pass in a plain string 'msg', the stack trace will include
    // reportingConsoleError and reportingConsoleCall
    if (!(errorMsg instanceof Error)) {
        // stringify all args as a new Error (which creates a stack trace)
        errorMsg = new Error(
            args.reduce(function (accumulator, currentValue) {
                return accumulator.toString() + ' ' + currentValue.toString();
            }, '')
        );
    }
    return errorMsg;
}