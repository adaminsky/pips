/**
 * Logger utility for PIPS application
 */
export class Logger {
    static log(message, ...args) {
        console.log(`[DEBUG] ${message}`, ...args);
    }

    static warn(message, ...args) {
        console.warn(`[DEBUG] ${message}`, ...args);
    }

    static error(message, ...args) {
        console.error(`[DEBUG] ${message}`, ...args);
    }

    static debug(context, message, data = null) {
        if (data) {
            console.log(`[DEBUG] ${context}: ${message}`, data);
        } else {
            console.log(`[DEBUG] ${context}: ${message}`);
        }
    }

    static time(label) {
        console.time(`[DEBUG] ${label}`);
    }

    static timeEnd(label) {
        console.timeEnd(`[DEBUG] ${label}`);
    }
} 