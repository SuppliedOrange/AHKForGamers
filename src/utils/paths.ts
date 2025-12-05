import path from "path";

/**
 * Gets the application root directory.
 * When running as a pkg executable, this returns the directory containing the executable.
 * When running in development, this returns the repository root.
 */
export function getAppRoot(): string {

    // Check if running inside pkg

    // @ts-ignore - pkg sets process.pkg when running as executable
    if (process.pkg) {

        // When running as pkg executable, use the directory containing the executable
        return path.dirname(process.execPath);

    }
    
    // Development mode - resolve relative to this file's location
    // This file is in src/utils/, so go up two levels to reach repo root
    return path.resolve(__dirname, "..", "..");

}

/**
 * Gets the logs directory path.
 */
export function getLogsDir(): string {
    return path.join(getAppRoot(), "logs");
}

/**
 * Gets the assets directory path.
 */
export function getAssetsDir(): string {
    return path.join(getAppRoot(), "assets");
}

/**
 * Gets the config file path.
 */
export function getConfigPath(): string {
    return path.join(getAppRoot(), "config.json");
}

/**
 * Gets the game list file path.
 */
export function getGameListPath(): string {
    return path.join(getAppRoot(), "game_process_names.txt");
}

/**
 * Gets the process watcher executable path.
 * In production (pkg), it's at process_watcher/ProcessWatcher.exe
 * In development, it's at process_watcher/bin/Release/net8.0-windows/ProcessWatcher.exe
 */
export function getProcessWatcherPath(): string {
    // @ts-ignore - pkg sets process.pkg when running as executable
    if (process.pkg) {
        // Production: flattened structure
        return path.join(getAppRoot(), "process_watcher", "ProcessWatcher.exe");
    }
    
    // Development: full build path
    return path.join(
        getAppRoot(),
        "process_watcher",
        "bin",
        "Release",
        "net8.0-windows",
        "ProcessWatcher.exe"
    );
}

/**
 * Gets the process watcher debug executable path (development only).
 */
export function getProcessWatcherDebugPath(): string {
    return path.join(
        getAppRoot(),
        "process_watcher",
        "bin",
        "Debug",
        "net8.0-windows",
        "ProcessWatcher.exe"
    );
}
