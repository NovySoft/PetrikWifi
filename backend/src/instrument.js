import * as Sentry from "@sentry/node"
import {nodeProfilingIntegration} from "@sentry/profiling-node";
Sentry.init({
    dsn: process.env.SENTRY_DSN,
    debug: process.env.NODE_ENV === 'development',
    integrations: [
        nodeProfilingIntegration(),
    ],
    // Tracing
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
});