import { processWatcherService } from "./watchers/processWatcherService";
import { handleProcessEvent } from "./handlers/processHandler";
import logger from "./logger/logger";

let keepRunning = true;

// Start process watcher for configured game processes (event-driven)
processWatcherService.start();
processWatcherService.onEvent(handleProcessEvent);

function shutdown(signal: string) {

    if (!keepRunning) return;

    keepRunning = false;

    processWatcherService.stop();

    logger.info(`Received ${signal}. Shutting down...`);
    process.exit(0);

}

process.once("SIGINT", () => shutdown("SIGINT"));

process.once("SIGTERM", () => shutdown("SIGTERM"));

process.once("exit", () => {

    processWatcherService.stop();

});

// Just for testing or whatever idk.