import { execFile, spawn } from 'child_process';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';
import { PowershellCommandFailureError, PowershellNotFoundError, PowershellOutputParseError } from '../errors/errors';
import getGameProcessNames from './gameProcessNamesParser';
import type { WatcherEvent } from '../watchers/processWatcherService';
import { clearAhkProcesses, clearBufferedAhkProcesses, getAllAhkProcesses, getAllBufferedAhkProcesses, getAllIncompatibleProcesses, upsertBufferedAhkProcesses } from './dbHandler';
import logger from '../logger/logger';

export interface AHKProcess {
    pid: number;
    ppid: number;
    exe: string;
    cmd: string;
    scriptPath: string | null;
}

export interface PotentialIncompatibleProcess {

    pid: number;
    ppid: number;
    processName: string;

}

/**
 * Gets all current AHK processes and potentially incompatible processes from powershell.
 * [OBSOLETE: Use ProcessWatcherService instead. I was gonna use this to poll before I realised I could just use win32 events.]
 * 
 * @returns AHKProcess[] and PotentialIncompatibleProcess[] objects.
 */
export async function getProcesses(): Promise<{ ahkProcesses: AHKProcess[], potentiallyIncompatibleProcesses: PotentialIncompatibleProcess[] }> {

    const psCommand = `
        Get-CimInstance Win32_Process |
        Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine |
        ConvertTo-Json -Depth 4
    `;

    const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {

        let parsedProcesses: {
            ahkProcesses: AHKProcess[],
            potentiallyIncompatibleProcesses: PotentialIncompatibleProcess[]
        } = {
            ahkProcesses: [],
            potentiallyIncompatibleProcesses: []
        }

        // Check if powershell.exe works at all

        execFile(

            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output "PowerShell is working"'],
            { windowsHide: true },

            (err, _stdout, stderr) => {

                if (err) {

                    return reject(
                        new PowershellNotFoundError(
                            "Powershell (powershell.exe) is not available on this system or current scope.",
                            stderr
                        )
                    );

                }

            }

        )

        // Get all AHK processes

        execFile(

            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { windowsHide: true },

            (err, stdout, stderr) => {

                if (err) {

                    // Powershell.exe doesn't exist in scope? Error.

                    return reject(
                        new PowershellCommandFailureError(
                            `Failed to execute Powershell command to get AHK processes. Command: ${psCommand.replace(/\s+/g, ' ')}`,
                            stderr
                        )
                    )

                }

                const out = (stdout || '').trim();

                if (!out) return resolve(parsedProcesses); // No AHK processes found

                // Parse the output

                let data: any | null = null;

                try {

                    data = JSON.parse(out);

                }

                catch (e) {

                    // Parsing the output failed

                    return reject(

                        new PowershellOutputParseError(
                            "Failed to parse Powershell output as JSON.",
                            out
                        )

                    );

                }

                // Eh, should this happen? Should I error? Oh well.

                if (!data) return resolve(parsedProcesses);

                const processArray: Record<string, any>[] = (Array.isArray(data) ? data : [data]);

                // Parse them for AHKProcess objects

                const AHKProcessList: AHKProcess[] = parseAHKProcessList(processArray);

                parsedProcesses.ahkProcesses = AHKProcessList;

                // Parse potentially incompatible processes

                const incompatibleProcesses: PotentialIncompatibleProcess[] = parsePotentiallyIncompatibleProcessList(processArray);

                parsedProcesses.potentiallyIncompatibleProcesses = incompatibleProcesses;

                resolve(parsedProcesses);

            }

        );

    });

};

/**
 * Parses AHK processes from the parsed powershell output.
 * 
 * @param processArray The process array recieved from the parsed powershell output
 * @returns {AHKProcess[]} A list of AHK processes
 */
function parseAHKProcessList(processArray: Record<string, any>[]): AHKProcess[] {

    const AHKProcessList: AHKProcess[] = processArray.map(process => {

        // Get the full command from the CommandLine property
        const cmd = process.CommandLine || '';

        // Ensure we found a command at all
        if (!cmd) return null;

        // Get the ahk script file path from the command string

        const match1 = cmd.match(
            /"([^"]+\.ahk)"/i
        );

        const match2 = cmd.match(
            /([^\s"]+\.ahk)/i
        );

        const ahkMatch = match1 || match2;

        // Ensure we found a scriptPath match
        if (!ahkMatch) {
            return null;
        }

        // Ensure exePath is valid

        const exePath: string = process.ExecutablePath || '';

        if (!exePath) return null;

        return {

            pid: process.ProcessId,
            ppid: process.ParentProcessId,
            exe: exePath,
            cmd: cmd,
            scriptPath: ahkMatch ? ahkMatch[1] || ahkMatch[0] : null

        } as AHKProcess;

    })

    // Filter out nulls
    .filter(
        (process): process is AHKProcess => process !== null
    );

    return AHKProcessList;

}

/**
 * Parses potentially incompatible processes from the parsed powershell output.
 * 
 * @param processArray The process array recieved from the parsed powershell output
 * @returns {PotentialIncompatibleProcess} A list of potentially incompatible processes
 */
function parsePotentiallyIncompatibleProcessList(processArray: Record<string, any>[]): PotentialIncompatibleProcess[] {

    const gameProcessNames = getGameProcessNames().map(name => name.toLowerCase());

    const detectedProcesses: PotentialIncompatibleProcess[] = [];

    for (const process of processArray) {

        const processName: string = (process.Name || '').toLowerCase();

        if (gameProcessNames.includes(processName)) {

            // idc abt these values but include them anyway ig lol

            const pid = process.ProcessId;
            const ppid = process.ParentProcessId;

            detectedProcesses.push({
                pid,
                ppid,
                processName
            });

        }

    }

    return detectedProcesses;

}

/**
 * Kills all currently running AHK processes and moves them to the buffer table.
 * Called when an incompatible game/anti-cheat process starts.
 */
export function bufferAndKillAhkProcesses(): void {

    const ahkProcesses = getAllAhkProcesses();

    if (ahkProcesses.length === 0) {
        logger.info("No AHK processes to buffer.");
        return;
    }

    logger.info(`Buffering ${ahkProcesses.length} AHK process(es) due to incompatible process...`);

    // Move all AHK processes to the buffer table
    upsertBufferedAhkProcesses(ahkProcesses);

    // Kill each AHK process
    for (const proc of ahkProcesses) {
        try {
            process.kill(proc.pid);
            logger.info(`Killed AHK process: PID ${proc.pid} (${proc.scriptPath})`);
        } catch (err) {
            // Process may have already exited
            logger.warn(`Failed to kill PID ${proc.pid}: ${err}`);
        }
    }

    // Clear the active AHK process table (they'll be removed by stop events anyway,
    // but this ensures clean state)
    clearAhkProcesses();

}

/**
 * Validates that an executable path is a valid AutoHotkey executable.
 * This is a security measure to prevent arbitrary code execution.
 * 
 * @param exePath - The path to validate
 * @returns true if the path is a valid AutoHotkey executable, false otherwise
 */
function isValidAhkExecutable(exePath: string): boolean {

    // Check if the file exists
    if (!fs.existsSync(exePath)) {
        return false;
    }

    // Validate that the executable name starts with "AutoHotkey" (case-insensitive)
    const fileName = path.basename(exePath).toLowerCase();
    if (!fileName.startsWith('autohotkey') || !fileName.endsWith('.exe')) {
        return false;
    }

    return true;

}

/**
 * Restarts all buffered AHK processes as detached processes.
 * Called when all incompatible processes have stopped.
 */
export function restoreBufferedAhkProcesses(): void {

    const bufferedProcesses = getAllBufferedAhkProcesses();

    if (bufferedProcesses.length === 0) {
        logger.info("No buffered AHK processes to restore.");
        return;
    }

    logger.info(`Restoring ${bufferedProcesses.length} buffered AHK process(es)...`);

    for (const proc of bufferedProcesses) {
        try {
            // Spawn the AHK process detached using the original exe and script path
            // The script path is the argument to the AutoHotkey executable
            if (proc.scriptPath && proc.exe) {

                // Validate the executable is a legitimate AutoHotkey executable
                // to prevent arbitrary code execution
                if (!isValidAhkExecutable(proc.exe)) {
                    logger.warn(`Skipping process restoration - invalid or non-existent AHK executable: ${proc.exe}`);
                    continue;
                }

                // Validate the script file exists
                if (!fs.existsSync(proc.scriptPath)) {
                    logger.warn(`Skipping process restoration - script file not found: ${proc.scriptPath}`);
                    continue;
                }

                const child = spawn(proc.exe, [proc.scriptPath], {
                    detached: true,
                    stdio: "ignore",
                    windowsHide: false
                });

                // Unref so the parent process can exit independently
                child.unref();

                logger.info(`Restored AHK script: ${proc.scriptPath}`);
            } else {
                logger.warn(`Cannot restore process - missing exe or scriptPath: ${JSON.stringify(proc)}`);
            }
        } catch (err) {
            logger.error(`Failed to restore AHK process (${proc.scriptPath}): ${err}`);
        }
    }

    // Clear the buffer table - new PIDs will be tracked via start events
    clearBufferedAhkProcesses();

}

/**
 * Handles incoming process events from the watcher.
 * 
 * Logic:
 * - When an incompatible process starts: Buffer and kill all AHK processes
 * - When an incompatible process stops: If no more incompatible processes remain, restore buffered AHK processes
 * - AHK start/stop events are logged (database updates happen in processWatcherService)
 */
export function handleProcessEvent(evt: WatcherEvent): void {

    logger.info(`Process event: ${evt.kind} ${evt.type} ${evt.kind === "ahk" ? evt.process.scriptPath : evt.process.processName}`);

    if (evt.kind === "incompatible") {

        if (evt.type === "start") {
            // An incompatible game/anti-cheat started - buffer and kill AHK processes
            bufferAndKillAhkProcesses();
        } 
        else if (evt.type === "stop") {
            // An incompatible process stopped - check if any remain
            const remainingIncompatible = getAllIncompatibleProcesses();

            if (remainingIncompatible.length === 0) {
                // No more incompatible processes - safe to restore AHK scripts
                logger.info("All incompatible processes have stopped.");
                restoreBufferedAhkProcesses();
            } else {
                logger.info(`${remainingIncompatible.length} incompatible process(es) still running.`);
            }
        }

    }

}