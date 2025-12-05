/** 
 * Checks if better-sqlite3 native module is compiled for the current Node version.
 * If not, rebuilds it automatically.
 * 
 * Usage: node scripts/check-native.js [--target=18.5.0]
 *   --target=X.X.X  Build for specific Node version (for pkg builds)
 *   (no args)       Build for current Node version (for development)
 * 
 * IMPORTANT: This script reads the module version from a marker file instead of
 * loading the .node binary, which would lock the file and prevent rebuilding.
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Parse arguments
const args = process.argv.slice(2);
const targetArg = args.find(a => a.startsWith("--target="));
const targetVersion = targetArg ? targetArg.split("=")[1] : null;

// Node module version mapping (major Node version -> NODE_MODULE_VERSION)
const NODE_MODULE_VERSIONS = {
    "14": 83,
    "15": 88,
    "16": 93,
    "17": 102,
    "18": 108,
    "19": 111,
    "20": 115,
    "21": 120,
    "22": 127,
    "23": 131,
    "24": 137,
};

// Path to marker file that stores which version the module was built for
const MARKER_FILE = path.join(
    __dirname,
    "..",
    "node_modules",
    "better-sqlite3",
    ".node_module_version"
);

const NATIVE_MODULE_PATH = path.join(
    __dirname,
    "..",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
);

/**
 * Get the expected NODE_MODULE_VERSION for a Node version string
 */
function getExpectedModuleVersion(nodeVersion) {
    const major = nodeVersion.split(".")[0];
    return NODE_MODULE_VERSIONS[major] || null;
}

/**
 * Get the NODE_MODULE_VERSION that better-sqlite3 was compiled for.
 * Reads from marker file to avoid loading and locking the .node binary.
 */
function getCompiledModuleVersion() {
    // If the .node file doesn't exist, module isn't built
    if (!fs.existsSync(NATIVE_MODULE_PATH)) {
        return null;
    }

    // Try to read from marker file first (fast, no locking)
    if (fs.existsSync(MARKER_FILE)) {
        try {
            const version = fs.readFileSync(MARKER_FILE, "utf-8").trim();
            if (version && /^\d+$/.test(version)) {
                return version;
            }
        } catch (e) {
            // Fall through to probe method
        }
    }

    // Marker file missing or invalid - probe by spawning a subprocess
    // This isolates the module load so it doesn't lock in our process
    const result = spawnSync(process.execPath, [
        "-e",
        `try { require(${JSON.stringify(NATIVE_MODULE_PATH)}); console.log(process.versions.modules); } catch(e) { const m = e.message.match(/NODE_MODULE_VERSION (\\d+)/); console.log(m ? m[1] : ""); }`
    ], { encoding: "utf-8", timeout: 5000 });

    const version = result.stdout?.trim();
    if (version && /^\d+$/.test(version)) {
        // Write marker file for next time
        try {
            fs.writeFileSync(MARKER_FILE, version);
        } catch (e) {
            // Ignore write errors
        }
        return version;
    }

    return null;
}

/**
 * Rebuild better-sqlite3 for the specified or current Node version
 */
function rebuild(targetNodeVersion) {
    const targetMajor = targetNodeVersion ? targetNodeVersion.split(".")[0] : process.version.slice(1).split(".")[0];
    const expectedVersion = NODE_MODULE_VERSIONS[targetMajor];
    
    console.log(`Rebuilding better-sqlite3 for Node ${targetNodeVersion || process.version}...`);
    
    // Remove the build folder to ensure clean rebuild
    const buildPath = path.join(__dirname, "..", "node_modules", "better-sqlite3", "build");
    
    try {
        if (fs.existsSync(buildPath)) {
            fs.rmSync(buildPath, { recursive: true, force: true });
            console.log("Cleaned old build folder.");
        }
    } catch (cleanErr) {
        // On Windows, try PowerShell as fallback
        if (process.platform === "win32") {
            try {
                execSync(`powershell -Command "Remove-Item -Recurse -Force '${buildPath}'" `, {
                    stdio: "pipe"
                });
                console.log("Cleaned old build folder (PowerShell).");
            } catch (e) {
                console.warn(`Warning: Could not clean build folder: ${cleanErr.message}`);
            }
        }
    }
    
    // Remove old marker file
    try {
        if (fs.existsSync(MARKER_FILE)) {
            fs.unlinkSync(MARKER_FILE);
        }
    } catch (e) {
        // Ignore
    }
    
    try {
        if (targetNodeVersion) {
            execSync(`npm rebuild better-sqlite3 --target=${targetNodeVersion} --arch=x64`, {
                stdio: "inherit",
                cwd: path.join(__dirname, "..")
            });
        } else {
            execSync("npm rebuild better-sqlite3", {
                stdio: "inherit", 
                cwd: path.join(__dirname, "..")
            });
        }

        // Write marker file with the version we just built for
        if (expectedVersion) {
            try {
                fs.writeFileSync(MARKER_FILE, String(expectedVersion));
            } catch (e) {
                // Ignore
            }
        }

        console.log("Rebuild complete!");

    } catch (err) {
        console.error("Rebuild failed:", err.message);
        process.exit(1);
    }
}

// Main logic
const currentNodeVersion = process.version.slice(1); // Remove 'v' prefix
const targetNodeVersionForBuild = targetVersion || currentNodeVersion;

const expectedModuleVersion = getExpectedModuleVersion(targetNodeVersionForBuild);
const compiledModuleVersion = getCompiledModuleVersion();

console.log(`Target Node: ${targetNodeVersionForBuild} (MODULE_VERSION: ${expectedModuleVersion})`);
console.log(`Compiled for MODULE_VERSION: ${compiledModuleVersion || "unknown/missing"}`);

if (!compiledModuleVersion || compiledModuleVersion !== String(expectedModuleVersion)) {
    console.log("Native module version mismatch - rebuilding...");
    rebuild(targetVersion);
} else {
    console.log("Native module is up to date!");
}
