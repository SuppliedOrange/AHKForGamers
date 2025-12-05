export class PowershellNotFoundError extends Error {

    public readonly friendlyName: string;

    constructor(reason: string, log: string) {
        
        super(`Powershell not found: ${reason}\nLog:\n${log}`);
        this.friendlyName = "PowershellNotFoundError";

    }

}

export class PowershellCommandFailureError extends Error {

    public readonly friendlyName: string;

    constructor(reason: string, log: string) {
        
        super(`Powershell command failed: ${reason}\nLog:\n${log}`);
        this.friendlyName = "PowershellCommandFailureError";

    }

}

export class PowershellOutputParseError extends Error {

    public readonly friendlyName: string;

    constructor(reason: string, output: string) {
        
        super(`Powershell output parse error: ${reason}\nOutput:\n${output}`);
        this.friendlyName = "PowershellOutputParseError";

    }

}

export class EssentialFileMissingError extends Error {

    public readonly friendlyName: string;

    constructor(reason: string, filePath: string) {

        super(`Essential file missing: ${reason}\nFile Path:\n${filePath}`);
        this.friendlyName = "EssentialFileMissingError";

    }

}