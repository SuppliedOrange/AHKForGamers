using System.Management;
using System.Text.Json;

/// <summary>
    /// Monitors Windows processes for game and AutoHotkey executables using WMI (Windows Management Instrumentation).
    /// 
    /// This watcher serves two purposes:
    /// 1. Detects when games from a configurable watchlist start or stop
    /// 2. Detects when AutoHotkey scripts start or stop (for script lifecycle tracking)
    /// 
    /// Output is JSON lines written to stdout, consumed by a parent Node.js process.
    /// Each JSON object contains: type (start/stop), category (ahk/watchlist), pid, ppid, name, exe, cmd.
/// </summary>
class ProcessWatcher
{
    /// <summary>
        /// Set of process names to watch for (case-insensitive).
        /// Loaded from an external text file at startup.
    /// </summary>
    private static readonly HashSet<string> _names = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
        /// WMI polling interval in seconds, derived from config's process_query_poll_wait_seconds.
    /// </summary>
    private static double _pollingInterval;

    /// <summary>
        /// Application entry point. Sets up process monitoring and runs indefinitely.
        /// 
        /// Workflow:
        /// 1. Loads configuration from config.json
        /// 2. Loads the watchlist of process names from a text file
        /// 3. Emits "start" events for any matching processes already running (snapshot)
        /// 4. Creates WMI event watchers for process creation and deletion
        /// 5. Blocks forever, emitting JSON events as processes start/stop
        /// 
        /// The process is designed to be spawned and managed by a parent process,
        /// which reads JSON lines from stdout and terminates this process when done.
    /// </summary>
    /// <param name="args">
        /// Command-line arguments:
        /// - args[0]: Path to the process names file (default: "game_process_names.txt")
        /// - args[1]: Path to the config.json file (default: "config.json")
    /// </param>
    static void Main(string[] args) {
        
        var namesPath = args.Length > 0 ? args[0] : "game_process_names.txt";
        var configPath = args.Length > 1 ? args[1] : "config.json";

        if (!File.Exists(namesPath)) {

            Console.Error.WriteLine($"Names file not found: {namesPath}");
            Environment.Exit(1);

        }

        LoadConfig(configPath);
        LoadNames(namesPath);

        // Emit current matching processes as initial "start" events
        EmitSnapshot();

        using var startWatcher = CreateWatcher("__InstanceCreationEvent");
        using var stopWatcher = CreateWatcher("__InstanceDeletionEvent");

        startWatcher.EventArrived += (s, e) => HandleEvent(e, "start");
        stopWatcher.EventArrived += (s, e) => HandleEvent(e, "stop");

        startWatcher.Start();
        stopWatcher.Start();

        Console.Out.WriteLine("Process watcher running. Press Ctrl+C to exit.");
        // Block forever; process lifetime controlled by parent
        Thread.Sleep(Timeout.Infinite);
        
    }

    /// <summary>
        /// Loads process names from a text file into the watchlist HashSet.
        /// 
        /// File format:
        /// - One process name per line (e.g., "game.exe")
        /// - Lines starting with '#' are treated as comments and ignored
        /// - Blank lines are ignored
        /// - Names are stored case-insensitively for matching
    /// </summary>
    /// <param name="path">
        /// Absolute or relative path to the names file.
    /// </param>
    private static void LoadNames(string path) {

        foreach (var line in File.ReadLines(path)) {

            var trimmed = line.Trim();

            if (string.IsNullOrWhiteSpace(trimmed)) continue;
            if (trimmed.StartsWith("#")) continue;

            _names.Add(trimmed);

        }
        
    }

    /// <summary>
        /// Loads configuration from config.json file.
        /// 
        /// Required configuration:
        /// - process_query_poll_wait_seconds: Number of seconds to wait between polls (must be > 0)
        ///   This is used as the polling interval for WMI's WITHIN clause.
        /// 
        /// Throws an error and exits if:
        /// - Config file doesn't exist
        /// - Config file is not valid JSON
        /// - process_query_poll_wait_seconds is missing, not a number, or <= 0
    /// </summary>
    /// <param name="path">
        /// Absolute or relative path to the config.json file.
    /// </param>
    private static void LoadConfig(string path) {

        if (!File.Exists(path)) {
            Console.Error.WriteLine($"Config file not found: {path}");
            Environment.Exit(1);
        }

        string jsonContent;

        try {
            jsonContent = File.ReadAllText(path);
        }

        catch (Exception ex) {
            Console.Error.WriteLine($"Failed to read config file: {ex.Message}");
            Environment.Exit(1);
            return;
        }

        JsonDocument doc;

        try {
            doc = JsonDocument.Parse(jsonContent);
        }

        catch (JsonException ex) {
            Console.Error.WriteLine($"Config file is not valid JSON: {ex.Message}");
            Environment.Exit(1);
            return;
        }

        using (doc) {

            if (!doc.RootElement.TryGetProperty("process_query_poll_wait_seconds", out JsonElement pollElement)) {
                Console.Error.WriteLine("Config error: 'process_query_poll_wait_seconds' is missing from config.json");
                Environment.Exit(1);
                return;
            }

            double pollingInterval;

            if (pollElement.ValueKind == JsonValueKind.Number) {
                pollingInterval = pollElement.GetDouble();
            }

            else {
                Console.Error.WriteLine($"Config error: 'process_query_poll_wait_seconds' must be a number, got {pollElement.ValueKind}");
                Environment.Exit(1);
                return;
            }

            if (pollingInterval <= 0) {
                Console.Error.WriteLine($"Config error: 'process_query_poll_wait_seconds' must be greater than 0, got {pollingInterval}");
                Environment.Exit(1);
                return;
            }

            // Convert polls per second to interval in seconds
            _pollingInterval = pollingInterval;

        }

    }

    /// <summary>
        /// Creates a WMI event watcher that monitors for process lifecycle events.
        /// 
        /// Uses WMI's intrinsic event classes to detect when Win32_Process instances
        /// are created or deleted. The WITHIN clause specifies a 1-second polling interval,
        /// which provides near-real-time detection with minimal CPU overhead.
        /// 
        /// Note: WMI event subscriptions require appropriate permissions. Running as admin
        /// ensures all process events are captured, though most user-level processes
        /// can be monitored without elevation.
    /// </summary>
    /// <param name="eventType">
        /// The WMI intrinsic event class to subscribe to:
        /// - "__InstanceCreationEvent" for process starts
        /// - "__InstanceDeletionEvent" for process stops
    /// </param>
    /// <returns>
        /// A configured ManagementEventWatcher ready to be started.
        /// Caller is responsible for disposing when done.
    /// </returns>
    private static ManagementEventWatcher CreateWatcher(string eventType) {

        // WITHIN specifies the polling interval for WMI's internal event detection.
        // The interval is derived from config's process_query_poll_wait_seconds.
        // This is not true real-time but provides responsive detection with low overhead.
        var query = new WqlEventQuery($"SELECT * FROM {eventType} WITHIN {_pollingInterval.ToString(System.Globalization.CultureInfo.InvariantCulture)} WHERE TargetInstance ISA 'Win32_Process'");

        var scope = new ManagementScope("\\\\.\\root\\cimv2");

        scope.Connect();

        return new ManagementEventWatcher(scope, query);

    }

    /// <summary>
        /// Queries all currently running processes and emits "start" events for any that match.
        /// 
        /// This provides the initial state when the watcher starts, ensuring the parent process
        /// knows about games or AHK scripts that were already running before monitoring began.
        /// Without this, we'd only detect processes that start AFTER the watcher is running.
        /// 
        /// Each matching process is passed through HandleProcess() with type="start",
        /// producing the same JSON output format as real-time events.a
    /// </summary>
    private static void EmitSnapshot() {

        try {

            var scope = new ManagementScope("\\\\.\\root\\cimv2");
            scope.Connect();

            var query = new ObjectQuery("SELECT Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine FROM Win32_Process");
            
            using var searcher = new ManagementObjectSearcher(scope, query);

            foreach (ManagementBaseObject proc in searcher.Get()) {
                HandleProcess(proc, "start");
            }

        }

        catch (Exception ex) {
            Console.Error.WriteLine($"Snapshot error: {ex.Message}");
        }

    }

    /// <summary>
        /// Callback handler for WMI process creation/deletion events.
        /// 
        /// Extracts the Win32_Process object from the WMI event's TargetInstance property
        /// and delegates to HandleProcess() for filtering and JSON output.
        /// 
        /// Errors are logged to stderr but don't crash the watcher, ensuring robustness
        /// against transient WMI issues or permission problems on specific processes.
    /// </summary>
    /// <param name="e">
        /// The WMI event arguments containing the process information.
    /// </param>
    /// <param name="type">
        /// Event type string: "start" or "stop".
    /// </param>
    private static void HandleEvent(EventArrivedEventArgs e, string type) {

        try {

            if (e.NewEvent?["TargetInstance"] is ManagementBaseObject proc) {
                HandleProcess(proc, type);
            }

        }

        catch (Exception ex) {
            Console.Error.WriteLine($"Watcher error: {ex.Message}");
        }

    }

    /// <summary>
        /// Filters and serializes process information to JSON, writing to stdout if it matches.
        /// 
        /// A process is considered a match if:
        /// 1. Its name starts with "AutoHotkey" (case-insensitive) - categorized as "ahk"
        /// 2. Its name is in the watchlist loaded from file - categorized as "watchlist"
        /// 
        /// Output JSON schema:
        /// {
        ///   "type": "start" | "stop",           // Event type
        ///   "category": "ahk" | "watchlist",    // Why this process matched
        ///   "pid": number,                      // Process ID
        ///   "ppid": number,                     // Parent Process ID (useful for AHK script tracking)
        ///   "name": string,                     // Process name (e.g., "game.exe")
        ///   "exe": string,                      // Full executable path
        ///   "cmd": string                       // Full command line (includes arguments)
        /// }
        /// 
        /// The command line is especially useful for AHK processes, as it contains
        /// the script path being executed (e.g., "AutoHotkey.exe C:\scripts\game.ahk").
    /// </summary>
    /// <param name="proc">
       /// WMI ManagementBaseObject representing a Win32_Process.
    /// </param>
    /// <param name="type">
         /// Event type: "start" when process begins, "stop" when it ends.
    /// </param>
    private static void HandleProcess(ManagementBaseObject proc, string type) {

        var name = (proc["Name"] as string) ?? string.Empty;

        var isAhk = name.StartsWith("AutoHotkey", StringComparison.OrdinalIgnoreCase);
        var isWatchList = _names.Contains(name);

        if (!isAhk && !isWatchList) return;

        var pid = Convert.ToInt32(proc["ProcessId"]);
        var ppid = Convert.ToInt32(proc["ParentProcessId"]);
        var exe = (proc["ExecutablePath"] as string) ?? string.Empty;
        var cmd = (proc["CommandLine"] as string) ?? string.Empty;

        var category = isAhk ? "ahk" : "watchlist";

        var payload = new {
            type,
            category,
            pid,
            ppid,
            name,
            exe,
            cmd
        };

        Console.WriteLine(JsonSerializer.Serialize(payload));
    }
}
