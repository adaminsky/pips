/**
 * Storage utilities for PIPS application
 */
import { Logger } from './logger.js';

export class StorageManager {
    constructor() {
        this.SESSION_STORAGE_KEY = 'pips_sessions';
        this.API_KEYS_STORAGE_KEY = 'pips_api_keys';
        this.USER_SETTINGS_STORAGE_KEY = 'pips_user_settings';
        this.DEFAULT_SESSIONS_KEY = 'pips_default_session_ids';
    }

    // Session storage management
    loadSessions() {
        try {
            const stored = localStorage.getItem(this.SESSION_STORAGE_KEY);
            let sessions = stored ? JSON.parse(stored) : {};

            // MIGRATION: Older versions stored sessions as an array. Convert to
            // an object keyed by session.id so the rest of the app can work
            // uniformly.
            if (Array.isArray(sessions)) {
                const converted = {};
                sessions.forEach((sess) => {
                    if (sess && sess.id) {
                        converted[sess.id] = sess;
                    }
                });

                // Persist the converted structure back to localStorage so we
                // do this migration only once.
                localStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(converted));
                sessions = converted;

                Logger.debug('Storage', `Migrated legacy array-based sessions to object with ${Object.keys(converted).length} entries`);
            }

            Logger.debug('Storage', `Loaded ${Object.keys(sessions).length} sessions from localStorage`);
            return sessions;
        } catch (e) {
            Logger.error('Storage', 'Error loading sessions from localStorage:', e);
            return {};
        }
    }

    saveSessions(sessions) {
        // Sanity check: if an array was passed in by mistake, convert it to
        // object form immediately so we never persist the wrong structure.
        if (Array.isArray(sessions)) {
            const obj = {};
            sessions.forEach((sess) => {
                if (sess && sess.id) {
                    obj[sess.id] = sess;
                }
            });
            sessions = obj;
            Logger.warn('Storage', 'saveSessions received array – converted to object before persisting');
        }

        try {
            localStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(sessions));
            Logger.debug('Storage', `Saved ${Object.keys(sessions).length} sessions to localStorage`);
        } catch (e) {
            Logger.error('Storage', 'Error saving sessions to localStorage:', e);
        }
    }

    saveSession(sessionId, sessionData) {
        const sessions = this.loadSessions();
        sessions[sessionId] = sessionData;
        this.saveSessions(sessions);
    }

    deleteSession(sessionId) {
        const sessions = this.loadSessions();
        delete sessions[sessionId];
        this.saveSessions(sessions);
        Logger.debug('Storage', `Deleted session ${sessionId}`);
    }

    clearAllSessions() {
        localStorage.removeItem(this.SESSION_STORAGE_KEY);
        Logger.debug('Storage', 'Cleared all sessions from localStorage');
    }

    // API keys storage
    loadApiKeys() {
        try {
            const saved = localStorage.getItem(this.API_KEYS_STORAGE_KEY);
            if (saved) {
                const apiKeys = JSON.parse(saved);
                Logger.debug('Storage', 'Loaded API keys from localStorage');
                return apiKeys;
            }
            return {};
        } catch (e) {
            Logger.warn('Storage', 'Could not load API keys from localStorage:', e);
            return {};
        }
    }

    saveApiKeys(apiKeys) {
        try {
            localStorage.setItem(this.API_KEYS_STORAGE_KEY, JSON.stringify(apiKeys));
            Logger.debug('Storage', 'Saved API keys to localStorage');
        } catch (e) {
            Logger.warn('Storage', 'Could not save API keys to localStorage:', e);
        }
    }

    // User settings storage
    loadUserSettings() {
        try {
            const saved = localStorage.getItem(this.USER_SETTINGS_STORAGE_KEY);
            if (saved) {
                const settings = JSON.parse(saved);
                Logger.debug('Storage', 'Loaded user settings from localStorage');
                return settings;
            }
            return {};
        } catch (e) {
            Logger.warn('Storage', 'Could not load user settings from localStorage:', e);
            return {};
        }
    }

    saveUserSettings(settings) {
        try {
            localStorage.setItem(this.USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
            Logger.debug('Storage', 'Saved user settings to localStorage');
        } catch (e) {
            Logger.warn('Storage', 'Could not save user settings to localStorage:', e);
        }
    }

    // Export sessions for backup
    exportSessions() {
        const sessions = this.loadSessions();
        const defaultSessionIds = this.getDefaultSessionIds();
        
        // Filter out default sessions
        const userSessions = {};
        Object.entries(sessions).forEach(([sessionId, sessionData]) => {
            if (!defaultSessionIds.includes(sessionId)) {
                userSessions[sessionId] = sessionData;
            }
        });
        
        const exportData = {
            exportDate: new Date().toISOString(),
            sessions: userSessions
        };
        
        const sessionCount = Object.keys(userSessions).length;
        const filename = sessionCount > 0 ? 
            `pips_sessions_${new Date().toISOString().split('T')[0]}.json` :
            `pips_sessions_empty_${new Date().toISOString().split('T')[0]}.json`;
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        Logger.debug('Storage', `Exported ${sessionCount} user sessions (excluding ${defaultSessionIds.length} default sessions)`);
        return true;
    }

    // Export single session
    exportSingleSession(sessionId) {
        try {
            const sessions = this.loadSessions();
            const session = sessions[sessionId];
            
            if (!session) {
                Logger.error('Storage', `Session ${sessionId} not found for export`);
                return false;
            }

            const exportData = {
                exportDate: new Date().toISOString(),
                sessions: {
                    [sessionId]: session
                }
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pips_session_${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            Logger.debug('Storage', `Single session ${sessionId} exported successfully`);
            return true;
        } catch (e) {
            Logger.error('Storage', 'Error exporting single session:', e);
            return false;
        }
    }

    // Import sessions from JSON data
    importSessions(rawJson, options = {}) {
        const { merge = true, overwriteDuplicates = false } = options;
        
        try {
            Logger.debug('Storage', 'Starting session import...');
            
            // Parse and validate JSON
            const importData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            
            if (!importData || typeof importData !== 'object') {
                throw new Error('Invalid import data: not an object');
            }
            
            if (!importData.sessions || typeof importData.sessions !== 'object') {
                throw new Error('Invalid import data: missing or invalid sessions object');
            }
            
            const incomingSessions = importData.sessions;
            const incomingIds = Object.keys(incomingSessions);
            
            Logger.debug('Storage', `Found ${incomingIds.length} sessions to import`);
            
            // Load existing sessions if merging
            let existingSessions = merge ? this.loadSessions() : {};
            let importedCount = 0;
            let skippedCount = 0;
            let duplicatesFound = [];
            
            // Process each incoming session
            for (const sessionId of incomingIds) {
                const session = incomingSessions[sessionId];
                
                // Validate session structure
                if (!session || !session.id || !session.title) {
                    Logger.warn('Storage', `Skipping invalid session: ${sessionId}`);
                    skippedCount++;
                    continue;
                }
                
                // Handle duplicates
                if (existingSessions[sessionId]) {
                    duplicatesFound.push(sessionId);
                    
                    if (!overwriteDuplicates) {
                        Logger.debug('Storage', `Skipping duplicate session: ${sessionId}`);
                        skippedCount++;
                        continue;
                    } else {
                        Logger.debug('Storage', `Overwriting duplicate session: ${sessionId}`);
                    }
                }
                
                // Check for content-based duplicates (same title and problem text)
                const contentDuplicate = Object.values(existingSessions).find(existing => 
                    existing.title === session.title && 
                    existing.problemText === session.problemText &&
                    existing.id !== sessionId
                );
                
                if (contentDuplicate && !overwriteDuplicates) {
                    Logger.debug('Storage', `Skipping content duplicate: ${sessionId} (matches ${contentDuplicate.id})`);
                    skippedCount++;
                    continue;
                }
                
                // Import the session
                existingSessions[sessionId] = session;
                importedCount++;
                Logger.debug('Storage', `Imported session: ${sessionId} - "${session.title}"`);
            }
            
            // Save the updated sessions
            this.saveSessions(existingSessions);
            
            const summary = {
                total: incomingIds.length,
                imported: importedCount,
                skipped: skippedCount,
                duplicates: duplicatesFound.length,
                duplicateIds: duplicatesFound
            };
            
            Logger.debug('Storage', 'Import completed:', summary);
            return summary;
            
        } catch (e) {
            Logger.error('Storage', 'Error importing sessions:', e);
            throw e;
        }
    }

    // Import sessions from URL
    async importSessionsFromUrl(url, options = {}) {
        try {
            Logger.debug('Storage', `Fetching sessions from URL: ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const rawJson = await response.text();
            const result = this.importSessions(rawJson, options);
            
            Logger.debug('Storage', `Successfully imported sessions from URL: ${url}`);
            return result;
            
        } catch (e) {
            Logger.error('Storage', 'Error importing sessions from URL:', e);
            throw e;
        }
    }

    // Helper for programmatic exports
    saveSessionBundle(sessionsObj) {
        try {
            const exportData = {
                exportDate: new Date().toISOString(),
                sessions: sessionsObj
            };
            
            Logger.debug('Storage', `Created session bundle with ${Object.keys(sessionsObj).length} sessions`);
            return exportData;
        } catch (e) {
            Logger.error('Storage', 'Error creating session bundle:', e);
            throw e;
        }
    }

    // Utility methods
    isStorageAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            Logger.warn('Storage', 'localStorage is not available');
            return false;
        }
    }

    getStorageUsage() {
        if (!this.isStorageAvailable()) return null;
        
        try {
            const sessions = localStorage.getItem(this.SESSION_STORAGE_KEY);
            const apiKeys = localStorage.getItem(this.API_KEYS_STORAGE_KEY);
            
            return {
                sessions: sessions ? sessions.length : 0,
                apiKeys: apiKeys ? apiKeys.length : 0,
                total: (sessions?.length || 0) + (apiKeys?.length || 0)
            };
        } catch (e) {
            Logger.warn('Storage', 'Could not calculate storage usage:', e);
            return null;
        }
    }

    // Default session tracking
    getDefaultSessionIds() {
        try {
            const saved = localStorage.getItem(this.DEFAULT_SESSIONS_KEY);
            if (saved) {
                const ids = JSON.parse(saved);
                Logger.debug('Storage', 'Loaded default session IDs from localStorage');
                return ids;
            }
            return [];
        } catch (e) {
            Logger.warn('Storage', 'Could not load default session IDs from localStorage:', e);
            return [];
        }
    }

    saveDefaultSessionIds(ids) {
        try {
            localStorage.setItem(this.DEFAULT_SESSIONS_KEY, JSON.stringify(ids));
            Logger.debug('Storage', 'Saved default session IDs to localStorage');
        } catch (e) {
            Logger.warn('Storage', 'Could not save default session IDs to localStorage:', e);
        }
    }
}

// Create singleton instance
export const storageManager = new StorageManager(); 