/**
 * Debug Module for Email Signature Generator
 * Provides debugging utilities that can be enabled/disabled via CONFIG
 */

const DEBUG = {
    // Reads config.debug.{enabled,logLevel}; absent config leaves the module disabled at 'info'.
    init: function(config) {
        this.enabled = config && config.debug && config.debug.enabled;
        this.logLevel = (config && config.debug && config.debug.logLevel) || 'info';
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4
        };
        
        // Log initialization status
        this.info('Debug module initialized', { enabled: this.enabled, logLevel: this.logLevel });
    },
    
    // Returns "[file:line]" for whoever called the log method, or '' if the stack cannot be read.
    // Frame 3 is that caller: 0 is the Error line, 1 is here, 2 is the log method. Adding a wrapper
    // layer between a caller and a log method shifts this and silently misattributes every line.
    _getCallerInfo: function() {
        try {
            const err = new Error();
            const stackLines = err.stack.split('\n');
            let callerLine = stackLines[3] || '';
            const fileMatch = callerLine.match(/at\s+(?:.*\s+\()?(?:.*\/)?([^\/]*):(\d+)(?::(\d+))?\)?$/);
            
            if (fileMatch) {
                const [, file, line] = fileMatch;
                return `[${file}:${line}]`;
            }
            
            return '';
        } catch (e) {
            // If anything goes wrong, return empty string
            return '';
        }
    },
    
    // Every method below takes (message, data) and no-ops unless `enabled` and the call's level is at
    // or under `logLevel`. Only the deviations from that shape are commented.
    error: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.error) {
            const callerInfo = this._getCallerInfo();
            console.error(`%c[ERROR]${callerInfo} ${message}`, 'color: #ff0000; font-weight: bold;', data || '');
        }
    },
    
    warn: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.warn) {
            const callerInfo = this._getCallerInfo();
            console.warn(`%c[WARN]${callerInfo} ${message}`, 'color: #ff9900; font-weight: bold;', data || '');
        }
    },
    
    info: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.info) {
            const callerInfo = this._getCallerInfo();
            console.info(`%c[INFO]${callerInfo} ${message}`, 'color: #0099ff; font-weight: bold;', data || '');
        }
    },
    
    debug: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.debug(`%c[DEBUG]${callerInfo} ${message}`, 'color: #9900cc; font-weight: bold;', data || '');
        }
    },
    
    trace: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.trace) {
            const callerInfo = this._getCallerInfo();
            console.groupCollapsed(`%c[TRACE]${callerInfo} ${message}`, 'color: #999999; font-weight: bold;');
            console.trace(data || '');
            console.groupEnd();
        }
    },
    
    // Runs `callback` inside a collapsed console group. Gated on `enabled` only, not on logLevel.
    group: function(groupName, callback) {
        if (this.enabled) {
            const callerInfo = this._getCallerInfo();
            console.groupCollapsed(`%c[GROUP]${callerInfo} ${groupName}`, 'color: #00cc99; font-weight: bold;');
            callback();
            console.groupEnd();
        }
    },
    
    // Logged at debug level, not info, despite going out through console.info.
    variable: function(name, value) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.info(`%c[VAR]${callerInfo} ${name}:`, 'color: #cc6600; font-weight: bold;', value);
        }
    },
    
    // Times `fn` and returns its result. Calls `fn` either way, so wrapping a call in this is never
    // what stops it running when debug is off.
    time: function(name, fn) {
        if (!this.enabled) {
            return fn();
        }
        
        const callerInfo = this._getCallerInfo();
        console.time(`[TIME]${callerInfo} ${name}`);
        const result = fn();
        console.timeEnd(`[TIME]${callerInfo} ${name}`);
        return result;
    },
    
    // Prints `message` followed by a swatch of `color`. Logged at debug level.
    color: function(message, color, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.info(
                `%c[COLOR]${callerInfo} ${message}`, 
                `color: ${color}; font-weight: bold;`,
                `%c■■■■■■■■■■`, 
                `background-color: ${color}; color: transparent;`,
                data || ''
            );
        }
    },
    
    // Ctrl+Shift+D toggles the `debug-mode` class on <body>, which the stylesheet uses to outline
    // clickable areas. Bound on load, below, so the shortcut is live without any caller opting in.
    initDebugModeToggle: function() {
        document.addEventListener('keydown', function(event) {
            // Check if Ctrl+Shift+D was pressed
            if (event.ctrlKey && event.shiftKey && event.key === 'D') {
                document.body.classList.toggle('debug-mode');
                DEBUG.info('Debug mode toggled:', document.body.classList.contains('debug-mode'));
            }
        });
    }
};

// Initialize debug mode toggle
DEBUG.initDebugModeToggle();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DEBUG;
}