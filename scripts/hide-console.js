/**
 * Post-build script to modify the PE header of a Windows executable
 * to change it from a Console subsystem to a Windows GUI subsystem.
 * This prevents the console window from appearing when the exe runs.
 */

const fs = require('fs');
const path = require('path');

const exePath = process.argv[2] || path.join(__dirname, '..', 'build', 'ahk-for-gamers.exe');

if (!fs.existsSync(exePath)) {
    console.error(`Executable not found: ${exePath}`);
    process.exit(1);
}

console.log(`Modifying PE header to hide console: ${exePath}`);

const buffer = fs.readFileSync(exePath);

// DOS Header: e_lfanew at offset 0x3C (4 bytes) points to PE header
const peOffset = buffer.readUInt32LE(0x3C);

// Verify PE signature "PE\0\0"
const peSignature = buffer.toString('ascii', peOffset, peOffset + 4);
if (peSignature !== 'PE\0\0') {
    console.error('Invalid PE signature');
    process.exit(1);
}

// Optional header starts at PE + 24 bytes
// Subsystem field is at offset 68 (0x44) into the Optional Header for PE32+
// For PE32 it's at offset 68 as well
const optionalHeaderOffset = peOffset + 24;

// Check if PE32 or PE32+ (magic number)
const magic = buffer.readUInt16LE(optionalHeaderOffset);
let subsystemOffset;

if (magic === 0x10b) {
    // PE32
    subsystemOffset = optionalHeaderOffset + 68;
} else if (magic === 0x20b) {
    // PE32+ (64-bit)
    subsystemOffset = optionalHeaderOffset + 68;
} else {
    console.error(`Unknown PE format: 0x${magic.toString(16)}`);
    process.exit(1);
}

// Read current subsystem value
const currentSubsystem = buffer.readUInt16LE(subsystemOffset);
console.log(`Current subsystem: ${currentSubsystem} (${currentSubsystem === 3 ? 'CONSOLE' : currentSubsystem === 2 ? 'WINDOWS_GUI' : 'OTHER'})`);

if (currentSubsystem === 3) {
    // Change from CONSOLE (3) to WINDOWS_GUI (2)
    buffer.writeUInt16LE(2, subsystemOffset);
    fs.writeFileSync(exePath, buffer);
    console.log('Successfully changed subsystem to WINDOWS_GUI (2)');
} else if (currentSubsystem === 2) {
    console.log('Subsystem is already WINDOWS_GUI, no changes needed');
} else {
    console.log(`Subsystem ${currentSubsystem} is not CONSOLE, skipping modification`);
}
