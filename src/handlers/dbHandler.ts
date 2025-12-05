import betterSQLLite3 from 'better-sqlite3';
import { type AHKProcess, type PotentialIncompatibleProcess } from './processHandler';

const db = new betterSQLLite3(':memory:');

/**
 * Initializes the in-memory database and creates necessary tables.
 * 
 * Creates three tables:
 * - `ahk_processes`: Stores currently running AutoHotkey process information (pid, ppid, exe, cmd, scriptPath)
 * - `buffered_ahk_processes`: Stores AHK processes that are temporarily paused/buffered (same schema as ahk_processes)
 * - `incompatible_processes`: Stores potentially incompatible game/anti-cheat processes (pid, ppid, processName)
 * 
 * @see AHKProcess in processHandler.ts
 * @see PotentialIncompatibleProcess in processHandler.ts
 */
export function initializeDatabase(): void {

    db.exec(`
        CREATE TABLE IF NOT EXISTS ahk_processes (
            pid INTEGER PRIMARY KEY,
            ppid INTEGER NOT NULL,
            exe TEXT NOT NULL,
            cmd TEXT NOT NULL,
            scriptPath TEXT
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS buffered_ahk_processes (
            pid INTEGER PRIMARY KEY,
            ppid INTEGER NOT NULL,
            exe TEXT NOT NULL,
            cmd TEXT NOT NULL,
            scriptPath TEXT
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS incompatible_processes (
            pid INTEGER PRIMARY KEY,
            ppid INTEGER NOT NULL,
            processName TEXT NOT NULL
        )
    `);

}

// ==================== AHK Processes ====================

/**
 * Inserts or replaces an AHK process record in the database.
 * Uses INSERT OR REPLACE to handle both new processes and updates to existing ones.
 * 
 * @param process - The AHK process to upsert.
 */
export function upsertAhkProcess(process: AHKProcess): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO ahk_processes (pid, ppid, exe, cmd, scriptPath)
        VALUES (@pid, @ppid, @exe, @cmd, @scriptPath)
    `);

    query.run(process);

}

/**
 * Inserts or replaces multiple AHK process records in the database.
 * Wrapped in a transaction for better performance with bulk inserts.
 * 
 * @param processes - Collection of AHK processes to persist.
 */
export function upsertAhkProcesses(processes: AHKProcess[]): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO ahk_processes (pid, ppid, exe, cmd, scriptPath)
        VALUES (@pid, @ppid, @exe, @cmd, @scriptPath)
    `);

    const insertMany = db.transaction((processes: AHKProcess[]) => {
        for (const process of processes) {
            query.run(process);
        }
    });

    insertMany(processes);

}

/**
 * Retrieves all stored AHK process records.
 * 
 * @returns All tracked AHK processes.
 */
export function getAllAhkProcesses(): AHKProcess[] {

    const query = db.prepare(`
        SELECT pid, ppid, exe, cmd, scriptPath FROM ahk_processes
    `);

    return query.all() as AHKProcess[];

}

/**
 * Retrieves a single AHK process by its PID.
 * 
 * @param pid - Process identifier to look up.
 * @returns Matching AHK process or null if not found.
 */
export function getAhkProcessByPid(pid: number): AHKProcess | null {

    const query = db.prepare(`
        SELECT pid, ppid, exe, cmd, scriptPath FROM ahk_processes WHERE pid = ?
    `);

    const process = query.get(pid) as AHKProcess | undefined;
    return process ?? null;

}

/**
 * Deletes an AHK process record by its PID.
 * Called when an AHK process stops.
 * 
 * @param pid - Process identifier to remove.
 */
export function deleteAhkProcessByPid(pid: number): void {

    const query = db.prepare(`
        DELETE FROM ahk_processes WHERE pid = ?
    `);

    query.run(pid);

}

/**
 * Removes all AHK process records from the table.
 */
export function clearAhkProcesses(): void {

    db.prepare(`DELETE FROM ahk_processes`).run();

}

// ==================== Buffered AHK Processes ====================

/**
 * Inserts or replaces a buffered AHK process record in the database.
 * Buffered processes are AHK scripts that have been temporarily suspended
 * (e.g., when an incompatible game is running) and will be restored later.
 * 
 * @param process - The AHK process to buffer.
 */
export function upsertBufferedAhkProcess(process: AHKProcess): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO buffered_ahk_processes (pid, ppid, exe, cmd, scriptPath)
        VALUES (@pid, @ppid, @exe, @cmd, @scriptPath)
    `);

    query.run(process);

}

/**
 * Inserts or replaces multiple buffered AHK process records in the database.
 * Wrapped in a transaction for better performance with bulk inserts.
 * 
 * @param processes - Collection of AHK processes to buffer.
 */
export function upsertBufferedAhkProcesses(processes: AHKProcess[]): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO buffered_ahk_processes (pid, ppid, exe, cmd, scriptPath)
        VALUES (@pid, @ppid, @exe, @cmd, @scriptPath)
    `);

    const insertMany = db.transaction((processes: AHKProcess[]) => {
        for (const process of processes) {
            query.run(process);
        }
    });

    insertMany(processes);

}

/**
 * Retrieves all stored buffered AHK process records.
 * 
 * @returns All buffered AHK processes.
 */
export function getAllBufferedAhkProcesses(): AHKProcess[] {

    const query = db.prepare(`
        SELECT pid, ppid, exe, cmd, scriptPath FROM buffered_ahk_processes
    `);

    return query.all() as AHKProcess[];

}

/**
 * Retrieves a single buffered AHK process by its PID.
 * 
 * @param pid - Process identifier to look up.
 * @returns Matching buffered AHK process or null if not found.
 */
export function getBufferedAhkProcessByPid(pid: number): AHKProcess | null {

    const query = db.prepare(`
        SELECT pid, ppid, exe, cmd, scriptPath FROM buffered_ahk_processes WHERE pid = ?
    `);

    const process = query.get(pid) as AHKProcess | undefined;
    return process ?? null;

}

/**
 * Deletes a buffered AHK process record by its PID.
 * Called when a buffered process is restored or no longer needed.
 * 
 * @param pid - Process identifier to remove.
 */
export function deleteBufferedAhkProcessByPid(pid: number): void {

    const query = db.prepare(`
        DELETE FROM buffered_ahk_processes WHERE pid = ?
    `);

    query.run(pid);

}

/**
 * Removes all buffered AHK process records from the table.
 */
export function clearBufferedAhkProcesses(): void {

    db.prepare(`DELETE FROM buffered_ahk_processes`).run();

}

// ==================== Incompatible Processes ====================

/**
 * Inserts or replaces an incompatible process record in the database.
 * These are game processes or anti-cheat software that may conflict with AHK.
 * 
 * @param process - The potentially incompatible process to upsert.
 */
export function upsertIncompatibleProcess(process: PotentialIncompatibleProcess): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO incompatible_processes (pid, ppid, processName)
        VALUES (@pid, @ppid, @processName)
    `);

    query.run(process);

}

/**
 * Inserts or replaces multiple incompatible process records in the database.
 * Wrapped in a transaction for better performance with bulk inserts.
 * 
 * @param processes - Collection of incompatible processes to persist.
 */
export function upsertIncompatibleProcesses(processes: PotentialIncompatibleProcess[]): void {

    const query = db.prepare(`
        INSERT OR REPLACE INTO incompatible_processes (pid, ppid, processName)
        VALUES (@pid, @ppid, @processName)
    `);

    const insertMany = db.transaction((processes: PotentialIncompatibleProcess[]) => {
        for (const process of processes) {
            query.run(process);
        }
    });

    insertMany(processes);

}

/**
 * Retrieves all stored incompatible process records.
 * 
 * @returns All tracked incompatible processes.
 */
export function getAllIncompatibleProcesses(): PotentialIncompatibleProcess[] {

    const query = db.prepare(`
        SELECT pid, ppid, processName FROM incompatible_processes
    `);

    return query.all() as PotentialIncompatibleProcess[];

}

/**
 * Retrieves a single incompatible process by its PID.
 * 
 * @param pid - Process identifier to look up.
 * @returns Matching incompatible process or null if not found.
 */
export function getIncompatibleProcessByPid(pid: number): PotentialIncompatibleProcess | null {

    const query = db.prepare(`
        SELECT pid, ppid, processName FROM incompatible_processes WHERE pid = ?
    `);

    const process = query.get(pid) as PotentialIncompatibleProcess | undefined;
    return process ?? null;

}

/**
 * Deletes an incompatible process record by its PID.
 * Called when an incompatible process stops.
 * 
 * @param pid - Process identifier to remove.
 */
export function deleteIncompatibleProcessByPid(pid: number): void {

    const query = db.prepare(`
        DELETE FROM incompatible_processes WHERE pid = ?
    `);

    query.run(pid);

}

/**
 * Removes all incompatible process records from the table.
 */
export function clearIncompatibleProcesses(): void {

    db.prepare(`DELETE FROM incompatible_processes`).run();

}

// ==================== General ====================

/**
 * Closes the underlying database connection.
 * Should be called during application shutdown.
 */
export function closeDatabase(): void {
 
    db.close();

}

// Initialize database tables at module load
initializeDatabase();