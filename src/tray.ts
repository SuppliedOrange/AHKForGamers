// f.y.i a lot of this file was ai generated

import { exec } from "child_process";
import path from "path";
import fs from "fs";
import systray2 from "systray2";

import { processWatcherService } from "./watchers/processWatcherService";

import {
    handleProcessEvent,
    bufferAndKillAhkProcesses,
    restoreBufferedAhkProcesses
} from "./handlers/processHandler";

import {
    getAllAhkProcesses,
    getAllBufferedAhkProcesses,
    getAllIncompatibleProcesses,
    closeDatabase
} from "./handlers/dbHandler";

import logger from "./logger/logger";
import { getConfigPath, getGameListPath, getAssetsDir } from "./utils/paths";

// ==================== Systray Setup ====================

interface MenuItem {

    title: string;
    tooltip: string;
    checked?: boolean;
    enabled?: boolean;
    hidden?: boolean;
    items?: MenuItem[];

}

interface SystrayConfig {

    menu: {
        icon: string;
        title: string;
        tooltip: string;
        items: MenuItem[];
    };

    debug?: boolean;
    copyDir?: boolean;

}

// ==================== Application State ====================

let isWatcherRunning = false;
let isSystrayReady = false;
let systray: any = null;

// Paths for config and game list (uses path utilities for pkg compatibility)
const configPath = getConfigPath();
const gameListPath = getGameListPath();
const assetsDir = getAssetsDir();
const activeIconPath = path.join(assetsDir, "active_logo.ico");
const inactiveIconPath = path.join(assetsDir, "inactive_logo.ico");

// Cached base64 icons
let activeIconBase64: string = "";
let inactiveIconBase64: string = "";

/**
 * Loads ICO icon files and converts them to base64.
 * Falls back to a default icon if files are not found.
 */
function loadIcons(): void {

    try {

        // Active icon
        if (fs.existsSync(activeIconPath)) {
            activeIconBase64 = fs.readFileSync(activeIconPath).toString("base64");
            logger.info("Loaded active icon");
        }

        // Inactive icon
        if (fs.existsSync(inactiveIconPath)) {
            inactiveIconBase64 = fs.readFileSync(inactiveIconPath).toString("base64");
            logger.info("Loaded inactive icon");
        }

    } catch (err) {

        logger.warn(`Failed to load icon files, using defaults: ${err}`);

    }
    
    if (!activeIconBase64 || !inactiveIconBase64) {

        throw new Error("Icon files not found. Please ensure active_logo.ico and inactive_logo.ico exist in the assets/ folder.");

    }
}

// ==================== Menu Actions ====================

/**
 * Opens a file in the default text editor (notepad on Windows).
 * @param filePath - Path to the file to edit
 */
function openInEditor(filePath: string): void {

    // Use notepad on Windows, or fall back to the system default

    exec(`notepad "${filePath}"`, (err) => {

        if (err) {
            logger.error(`Failed to open ${filePath}: ${err}`);
        }

    });

}

/**
 * Starts the process watcher service.
 */
function startWatcher(): void {

    if (isWatcherRunning) {
        logger.info("Watcher is already running.");
        return;
    }

    logger.info("Starting process watcher...");

    // Start watcher
    processWatcherService.start();

    // Handle events
    processWatcherService.onEvent(handleProcessEvent);

    isWatcherRunning = true;

    updateMenu();

}

/**
 * Stops the process watcher service.
 */
function stopWatcher(): void {

    if (!isWatcherRunning) {
        logger.info("Watcher is not running.");
        return;
    }

    logger.info("Stopping process watcher...");

    // Stop watcher
    processWatcherService.stop();
    
    isWatcherRunning = false;
    
    updateMenu();

}

/**
 * Manually hides (kills and buffers) all AHK processes.
 */
function manualHideAhk(): void {

    const ahkCount = getAllAhkProcesses().length;

    if (ahkCount === 0) {
        logger.info("No AHK processes currently running to hide.");
        return;
    }

    logger.info(`Manually hiding ${ahkCount} AHK process(es)...`);

    bufferAndKillAhkProcesses();
    updateMenu();

}

/**
 * Manually restores all buffered AHK processes.
 */
function manualRestoreAhk(): void {

    const bufferedCount = getAllBufferedAhkProcesses().length;

    if (bufferedCount === 0) {
        logger.info("No buffered AHK processes to restore.");
        return;
    }

    logger.info(`Manually restoring ${bufferedCount} AHK process(es)...`);

    restoreBufferedAhkProcesses();
    updateMenu();

}

/**
 * Builds a status string for the tray icon tooltip.
 * Tooltip has a ~128 char limit on Windows, so keep it concise.
 */
function buildStatusTooltip(): string {

    const ahkProcesses = getAllAhkProcesses();
    const bufferedProcesses = getAllBufferedAhkProcesses();
    const incompatibleProcesses = getAllIncompatibleProcesses();

    const status = isWatcherRunning ? "Active" : "Stopped";
    return `AHK for Gamers [${status}]\nAHK: ${ahkProcesses.length} | Buffered: ${bufferedProcesses.length} | Games: ${incompatibleProcesses.length}`;

}
/**
 * Builds the menu items array for the system tray.
 */
function buildMenuItems(): MenuItem[] {
    return [
        {
            title: isWatcherRunning ? "Stop Watcher" : "Start Watcher",
            tooltip: isWatcherRunning ? "Stop monitoring processes" : "Start monitoring processes",
            enabled: true
        },
        {
            title: "─────────────",
            tooltip: "",
            enabled: false
        },
        {
            title: "Hide AHK Processes",
            tooltip: "Manually kill and buffer all AHK processes",
            enabled: true
        },
        {
            title: "Restore AHK Processes",
            tooltip: "Manually restore all buffered AHK processes",
            enabled: true
        },
        {
            title: "─────────────",
            tooltip: "",
            enabled: false
        },
        {
            title: "Edit Config",
            tooltip: "Open config.json in editor",
            enabled: true
        },
        {
            title: "Edit Game List",
            tooltip: "Open game_process_names.txt in editor",
            enabled: true
        },
        {
            title: "─────────────",
            tooltip: "",
            enabled: false
        },
        {
            title: "Quit",
            tooltip: "Exit the application",
            enabled: true
        }
    ];
}

/**
 * Quits the application gracefully.
 */
function quitApp(): void {
    logger.info("Quitting application...");
    
    // Stop watcher if running
    if (isWatcherRunning) {
        processWatcherService.stop();
    }

    // Close database
    closeDatabase();

    // Kill systray
    if (systray) {
        systray.kill(false);
    }

    process.exit(0);
}

// ==================== Menu Configuration ====================

/**
 * Creates the menu configuration for the system tray.
 */
function createMenuConfig(): SystrayConfig {

    return {

        menu: {
            // Use inactive icon initially (watcher not started yet)
            icon: inactiveIconBase64,
            title: "AHK for Gamers",
            tooltip: buildStatusTooltip(),
            items: buildMenuItems()
        },

        debug: false,
        copyDir: true

    };

}

/**
 * Updates the system tray menu and icon based on watcher state.
 * Uses individual update actions for reliability.
 */
function updateMenu(): void {

    if (!systray || !isSystrayReady) return;

    // Update the tray icon
    systray.sendAction({

        type: "update-menu",

        menu: {
            icon: isWatcherRunning ? activeIconBase64 : inactiveIconBase64,
            title: "AHK for Gamers",
            tooltip: buildStatusTooltip(),
            items: buildMenuItems()
        }

    });

    // Also update the Start/Stop menu item directly (seq_id 0)
    systray.sendAction({

        type: "update-item",

        item: {
            title: isWatcherRunning ? "Stop Watcher" : "Start Watcher",
            tooltip: isWatcherRunning ? "Stop monitoring processes" : "Start monitoring processes",
            enabled: true
        },

        seq_id: 0

    });

}

/**
 * Handles menu item clicks based on the sequence ID.
 */
function handleMenuClick(seq_id: number): void {

    switch (seq_id) {

        case 0: // Start/Stop Watcher

            if (isWatcherRunning) {
                stopWatcher();
            } else {
                startWatcher();
            }
            break;

        case 2: // Hide AHK Processes

            manualHideAhk();
            break;

        case 3: // Restore AHK Processes

            manualRestoreAhk();
            break;

        case 5: // Edit Config
            openInEditor(configPath);
            break;

        case 6: // Edit Game List
            openInEditor(gameListPath);
            break;

        case 8: // Quit
            quitApp();
            break;

    }
}

// ==================== Main Entry Point ====================

async function main(): Promise<void> {

    try {

        logger.info("Starting AFG tray application...");

        // Load icons from files
        loadIcons();

        // Create system tray
        systray = new systray2(createMenuConfig());

        // Handle menu clicks
        systray.onClick((action: { seq_id: number }) => {
            handleMenuClick(action.seq_id);
        });

        // Wait for systray to be ready using the ready() promise
        await systray.ready();
        isSystrayReady = true;
        
        logger.info("Tray application is running. Right-click the tray icon for options.");
        
        // Start the watcher by default
        startWatcher();

        // Auto-refresh tooltip status every 5 seconds
        setInterval(() => {
            if (isSystrayReady) {
                updateMenu();
            }
        }, 5000);

    } catch (err: any) {

        logger.error(`Failed to start tray application: ${err}`);
        logger.error(`Stack: ${err.stack}`);
        
        process.exit(1);

    }

}

// Handle process signals for graceful shutdown
process.once("SIGINT", () => quitApp());
process.once("SIGTERM", () => quitApp());

// Run the application
main().catch((err) => {

    logger.error(`Fatal error: ${err}`);
    process.exit(1);

});
