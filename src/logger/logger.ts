import winston from "winston";
import path from "path";
import fs from "fs";
import { getLogsDir } from "../utils/paths";

// Resolve the logs directory (handles both dev and pkg modes)
const logsDir = getLogsDir();
const debugLogPath = path.join(logsDir, "debug.log");

// Ensure the logs directory exists

if (!fs.existsSync(logsDir)) {

    fs.mkdirSync(logsDir, { recursive: true });

}

// Clear the existing debug.log file on startup (overwrite mode)

if (fs.existsSync(debugLogPath)) {

    fs.writeFileSync(debugLogPath, "");

}

// Create the winston logger

const logger = winston.createLogger({

    level: "debug",

    format: winston.format.combine(

        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),

        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })

    ),

    transports: [

        // Console transport

        new winston.transports.Console({

            format: winston.format.combine(

                winston.format.colorize(),
                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),

                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] [${level}] ${message}`;
                })

            )
        }),

        // File transport - writes to logs/debug.log

        new winston.transports.File({

            filename: debugLogPath,

            format: winston.format.combine(

                winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),

                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
                })

            )

        })
        
    ]
});

export default logger;
