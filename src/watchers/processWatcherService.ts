import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import EventEmitter from "events";
import fs from "fs";
import path from "path";
import readline from "readline";
import type { AHKProcess, PotentialIncompatibleProcess } from "../handlers/processHandler";
import {
    upsertAhkProcess,
    deleteAhkProcessByPid,
    upsertIncompatibleProcess,
    deleteIncompatibleProcessByPid
} from "../handlers/dbHandler";
import logger from "../logger/logger";
import { getProcessWatcherDebugPath, getProcessWatcherPath, getGameListPath, getConfigPath } from "../utils/paths";
import { EssentialFileMissingError } from "../errors/errors";

export type ProcessEventType = "start" | "stop";

interface RawProcessEvent {

    type: ProcessEventType;
    category: "ahk" | "watchlist";
    pid: number;
    ppid: number;
    name: string;
    exe: string;
    cmd: string;
    
}

export type WatcherEvent =
    | { kind: "ahk"; type: ProcessEventType; process: AHKProcess }
    | { kind: "incompatible"; type: ProcessEventType; process: PotentialIncompatibleProcess };

interface ProcessWatcherPaths {
    
    exePath: string;
    namesPath: string;
    configPath: string;

}

/**
 * Wraps the C# ProcessWatcher.exe and emits process start/stop events for configured names.
 */
export class ProcessWatcherService {

    private child: ChildProcessWithoutNullStreams | null = null;

    private readonly emitter = new EventEmitter();

    /**
     * Registers a listener for process events.
     * @param listener callback invoked for each watcher event
     * @returns unsubscribe function
     * @example
     * ```jsonl
     *  {
            "kind": "ahk",
            "type": "start",
            "process": {
                "pid": 19764,
                "ppid": 28612,
                "exe": "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
                "cmd": "\"C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe\" \"C:\\Users\\Dhruv\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Media Controller.ahk\"",
                "scriptPath": "C:\\Users\\Dhruv\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Media Controller.ahk"
            }
        },
        {
            "kind": "incompatible",
            "type": "start",
            "process": { 
                "pid": 11616, 
                "ppid": 1100, 
                "processName": "EasyAntiCheat_EOS.exe" 
            }
        },
        {
            "kind": "incompatible",
            "type": "start",
            "process": { 
                "pid": 38428, 
                "ppid": 15548, 
                "processName": "r5apex_dx12.exe" 
            }
        }
    ```
     * 
     */
    onEvent(
        
        listener: (evt: WatcherEvent) => void
    
    ): () => void {

        this.emitter.on("event", listener);
        return () => this.emitter.off("event", listener);
        
    }

    /**
     * Starts the process watcher.
     * @returns void
     */
    start(): void {

        if (this.child) return; // already running

        const { exePath, namesPath, configPath } = resolveWatcherPaths();

        // Start ProcessWatcher.exe with the path to game_process_names.txt
        
        const child = spawn(exePath, [namesPath, configPath], {
            cwd: path.dirname(exePath),
            windowsHide: true,
            detached: false // lol it'll run as daemon anyway i guess, whatever bro.

        });

        // When we get an error from the .exe
        child.on("error", (err) => {

            logger.error(`Process watcher failed to start: ${err}`);

        });

        // When the .exe exits
        child.on("exit", (code, signal) => {

            this.child = null;
            logger.warn(`Process watcher exited (code=${code}, signal=${signal})`);

        });

        const readlineInterface = readline.createInterface({ input: child.stdout });

        // When a new line is received from stdout

        readlineInterface.on( "line", (line) => {

            try {

                // Parse the raw event
                const event = JSON.parse(line) as RawProcessEvent;

                // Ensure there's a name for the event

                if (!event?.name) return;

                // Infer category if missing

                if (!event.category) {

                    const inferred = inferCategory(event.name);
                    
                    // If can't infer category, skip it.

                    if (!inferred) return;

                    event.category = inferred;

                }

                const mapped = mapEvent(event);

                // Update the database and emit mapped event if valid

                if (mapped) {

                    updateDatabase(mapped);
                    this.emitter.emit("event", mapped);

                }

            } catch {
                // Ignore malformed lines
            }

        });

        // When we get stderr output from the .exe
        child.stderr.on("data", (buf) => {

            const msg = buf.toString();
            logger.error(msg.trim());

        });

        this.child = child;

    }

    /**
     * Stops the process watcher.
     * @returns void
     */
    stop(): void {

        if (!this.child) return;

        this.child.kill();
        this.child = null;

    }
}

/**
 * Updates the database based on the watcher event.
 * 
 * - On "start" events: Inserts/updates the process record in the appropriate table
 * - On "stop" events: Removes the process record from the appropriate table
 * 
 * @param event - The mapped watcher event containing process info and event type
 */
function updateDatabase(event: WatcherEvent): void {

    if (event.kind === "ahk") {

        if (event.type === "start") {
            upsertAhkProcess(event.process);
        } 
        
        else if (event.type === "stop") {
            deleteAhkProcessByPid(event.process.pid);
        }

    } else if (event.kind === "incompatible") {

        if (event.type === "start") {
            upsertIncompatibleProcess(event.process);
        } 
        
        else if (event.type === "stop") {
            deleteIncompatibleProcessByPid(event.process.pid);
        }

    }

}

/**
 * Maps a raw process event to a watcher event.
 * 
 * @param event Raw process event from ProcessWatcher.exe
 * @returns Mapped watcher event {WatcherEvent} or null if unrecognized
 */
function mapEvent(event: RawProcessEvent): WatcherEvent | null {

    if (event.category === "ahk") {

        // Get the full command i.e the initial executable along with its params

        const cmd = event.cmd;

        // Ensure we found a command at all

        if (!cmd) return null;

        // Get the ahk script file from the command string

        const match1 = cmd.match(/"([^"]+\.ahk)"/i);
        const match2 = cmd.match(/([^\s"]+\.ahk)/i);

        const scriptPath = (match1 && (match1[1] || match1[0])) || (match2 && (match2[1] || match2[0])) || null;

        // Ensure we found a scriptPath match
        if (!scriptPath) return null;

        // Ensure exePath is valid

        const exePath = event.exe;

        if (!exePath) return null;

        const process: AHKProcess = {

            pid: event.pid,
            ppid: event.ppid,
            exe: exePath,
            cmd,
            scriptPath

        };

        return { kind: "ahk", type: event.type, process };

    }

    if (event.category === "watchlist") {

        // Ensure we have an event name

        if (!event.name) return null;

        const process: PotentialIncompatibleProcess = {

            pid: event.pid,
            ppid: event.ppid,
            processName: event.name

        };

        return { kind: "incompatible", type: event.type, process };

    }

    return null;
}

/**
 * Infers a category for the process. If it's prefixed with "AutoHotkey", it's "ahk", else "watchlist".
 * @param name The name/executable of the process
 * @returns {"ahk" | "watchlist" | null}
 */
function inferCategory(name: string): "ahk" | "watchlist" | null {

    if (name.toLowerCase().startsWith("autohotkey")) return "ahk";
    return "watchlist";

}

/**
 * Resolves paths for ProcessWatcher.exe and game_process_names.txt.
 * @returns {ProcessWatcherPaths}
 */
function resolveWatcherPaths(): ProcessWatcherPaths {

    // Try release path first, then debug path as fallback
    const candidates = [
        getProcessWatcherPath(),
        getProcessWatcherDebugPath(),
    ];

    // ProcessWatcher.exe - location depends on dev vs production mode

    const exePath = candidates.find(fs.existsSync);

    if (!exePath) {
        throw new Error(`ProcessWatcher.exe not found. Build it via 'npm run build:process-watcher'.`);
    }

    // game_process_names.txt at app root

    const namesPath = getGameListPath();

    const configPath = getConfigPath();

    // Ensure names file exists

    if (!fs.existsSync(namesPath)) {
        throw new EssentialFileMissingError("Game process names file is missing.", namesPath);
    }

    // Ensure config file exists

    if (!fs.existsSync(configPath)) {
        throw new EssentialFileMissingError("Process watcher config file is missing.", configPath);
    }

    return { exePath, namesPath, configPath };

}

export const processWatcherService = new ProcessWatcherService();
