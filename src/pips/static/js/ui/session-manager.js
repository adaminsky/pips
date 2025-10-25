/**
 * Session Manager - Handles session UI and management functionality
 */
import { Logger } from '../core/logger.js';
import { appState } from '../core/state.js';
import { storageManager } from '../core/storage.js';
import { domManager } from './dom-manager.js';
import { messageManager } from './message-manager.js';
import { imageHandler } from './image-handler.js';

export class SessionManager {
    constructor() {
        this.isInitialized = false;
        this.periodicSaveInterval = null;
    }

    initialize() {
        if (this.isInitialized) return;
        
        // Clean up ghost sessions on startup
        this.cleanupGhostSessions();
        
        this.setupEventListeners();
        this.refreshSessionsList();
        this.isInitialized = true;
        
        Logger.debug('Session', 'Session manager initialized');
    }

    setupEventListeners() {
        // Session management listeners
        domManager.getElement('newSessionBtn')?.addEventListener('click', () => this.startNewSession());
        domManager.getElement('sessionsToggle')?.addEventListener('click', () => this.toggleSessions());
        domManager.getElement('clearSessionsBtn')?.addEventListener('click', () => this.clearAllSessionsEnhanced());
        domManager.getElement('exportSessionsBtn')?.addEventListener('click', () => this.exportSessions());
        domManager.getElement('importSessionsBtn')?.addEventListener('click', () => this.triggerImportSessions());
        
        // Import file input handler
        domManager.getElement('importSessionsInput')?.addEventListener('change', (e) => this.handleImportFile(e));

        // Session header click
        document.querySelector('.sessions-header')?.addEventListener('click', () => {
            document.getElementById('sessionsToggle')?.click();
        });

        Logger.debug('Session', 'Event listeners set up');
    }

    startNewSession() {
        Logger.debug('Session', 'Start New Session button clicked');
        this.resetToNewSessionState();
        domManager.updateStatus('Ready to start a new session', 'success');
    }

    resetToNewSessionState() {
        console.log('[DEBUG] Resetting to new session state');
        
        // Save current session before resetting if we have one
        if (appState.currentSessionData) {
            console.log('[DEBUG] Saving current session before reset');
            appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
            // Update the current state
            appState.currentSessionData.problemText = domManager.getElement('questionInput')?.value.trim() || '';
            const imageElement = domManager.getElement('imagePreview');
            appState.currentSessionData.image = imageElement?.style.display !== 'none' ? imageElement.src : null;
            appState.currentSessionData.title = this.generateSessionTitle(appState.currentSessionData.problemText);
            this.saveCurrentSessionToStorage();
        }
        
        // Reset session management state
        appState.selectedSessionId = null;
        appState.currentSessionData = null;
        
        // Clear visual selection
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Clear inputs and make them editable
        this.clearAndEnableInputs();
        
        // Clear chat and restore welcome message properly
        messageManager.clearChatAndRestoreWelcome();
        
        // Clear any existing feedback panels from previous sessions
        if (window.interactiveFeedback) {
            window.interactiveFeedback.removeFeedbackPanel();
            window.interactiveFeedback.removeRestoreButton();
        }
        
        // Clear any final solution artifacts panels
        document.querySelectorAll('.final-artifacts-compact').forEach(panel => {
            panel.remove();
        });
        
        // Clear per-session custom rules
        import('./settings-manager.js').then(({ settingsManager }) => {
            settingsManager.clearPerSessionRules();
        });
        
        this.updateCurrentSessionDisplay();
        console.log('[DEBUG] Reset to new session state completed');
    }

    clearAndEnableInputs() {
        // Clear inputs
        domManager.clearInputs();
        
        // Enable and reset input field to editable state
        const questionInputElement = domManager.getElement('questionInput');
        const solveBtnElement = domManager.getElement('solveBtn');
        
        if (questionInputElement) {
            questionInputElement.disabled = false;
            questionInputElement.style.backgroundColor = '';
            questionInputElement.style.cursor = '';
            questionInputElement.title = '';
            questionInputElement.placeholder = "Enter your problem here... (e.g., 'What is the square root of 144?', 'Solve this math puzzle', etc.)";
        }
        
        if (solveBtnElement && !appState.isSolving) {
            solveBtnElement.style.display = 'inline-flex';
            solveBtnElement.disabled = false;
            solveBtnElement.title = '';
        }
        
        // Remove any read-only messages
        this.removeReadOnlyMessage();
        
        // Replace feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    setInputsReadOnly(reason = 'This session has been used and is now read-only') {
        const questionInputElement = domManager.getElement('questionInput');
        const solveBtnElement = domManager.getElement('solveBtn');
        
        if (questionInputElement) {
            questionInputElement.disabled = true;
            questionInputElement.style.backgroundColor = 'var(--gray-100)';
            questionInputElement.style.cursor = 'not-allowed';
            questionInputElement.title = reason;
            questionInputElement.placeholder = 'This session is read-only. Start a new session to solve another problem.';
        }
        
        if (solveBtnElement) {
            solveBtnElement.style.display = 'none';
            solveBtnElement.disabled = true;
        }
        
        // Add read-only message
        this.showReadOnlyMessage();
    }

    showReadOnlyMessage() {
        // Remove any existing message first
        this.removeReadOnlyMessage();
        
        const messageEl = document.createElement('div');
        messageEl.className = 'session-readonly-message';
        messageEl.style.cssText = `
            background: var(--warning-50);
            border: 1px solid var(--warning-200);
            border-radius: 8px;
            padding: 12px;
            margin-top: 8px;
            font-size: 13px;
            color: var(--warning-700);
            text-align: center;
        `;
        messageEl.innerHTML = `
            <i data-feather="info" style="width: 14px; height: 14px; margin-right: 6px;"></i>
            This session is read-only. Click "Start New Session" to solve a new problem.
        `;
        
        // Add message after button group
        const buttonGroup = document.querySelector('.button-group');
        if (buttonGroup) {
            buttonGroup.insertAdjacentElement('afterend', messageEl);
            
            if (typeof feather !== 'undefined') {
                feather.replace(messageEl);
            }
        }
    }

    removeReadOnlyMessage() {
        const message = document.querySelector('.session-readonly-message');
        if (message) {
            message.remove();
        }
    }

    isSessionUsed(session) {
        // A session is considered "used" (read-only) only if it has been
        // finished or explicitly interrupted.  This mirrors the logic that
        // lives in the inline implementation inside index.html.  Active or
        // in-progress ("solving") sessions remain editable even if they have
        // chat history.
        const readOnlyStatuses = ['completed', 'interrupted'];
        return readOnlyStatuses.includes(session?.status);
    }

    toggleSessions() {
        appState.sessionsExpanded = !appState.sessionsExpanded;
        
        const sessionsContainer = domManager.getElement('sessionsContainer');
        const sessionsToggle = domManager.getElement('sessionsToggle');
        
        if (appState.sessionsExpanded) {
            sessionsContainer?.classList.add('expanded');
            sessionsToggle?.classList.add('expanded');
        } else {
            sessionsContainer?.classList.remove('expanded');
            sessionsToggle?.classList.remove('expanded');
        }
        
        Logger.debug('Session', `Sessions panel ${appState.sessionsExpanded ? 'expanded' : 'collapsed'}`);
    }

    clearAllSessions() {
        if (confirm('Are you sure you want to clear all session history? This cannot be undone.')) {
            try {
                storageManager.clearAllSessions();
                this.refreshSessionsList();
                domManager.updateStatus('All sessions cleared', 'success');
                Logger.debug('Session', 'All sessions cleared by user');
            } catch (error) {
                Logger.error('Session', 'Error clearing sessions:', error);
                domManager.updateStatus('Error clearing sessions', 'error');
            }
        }
    }

    exportSessions() {
        try {
            const result = storageManager.exportSessions();
            if (result) {
                const sessions = storageManager.loadSessions();
                const defaultSessionIds = storageManager.getDefaultSessionIds();
                const userSessionCount = Object.keys(sessions).length - defaultSessionIds.length;
                
                if (userSessionCount > 0) {
                    domManager.updateStatus(`Exported ${userSessionCount} user session(s) successfully`, 'success');
                } else {
                    domManager.updateStatus('No user sessions to export (default sessions are excluded)', 'info');
                }
                Logger.debug('Session', `Sessions exported by user: ${userSessionCount} user sessions`);
            } else {
                domManager.updateStatus('Error exporting sessions', 'error');
            }
        } catch (error) {
            Logger.error('Session', 'Error exporting sessions:', error);
            domManager.updateStatus('Error exporting sessions', 'error');
        }
    }

    triggerImportSessions() {
        const fileInput = domManager.getElement('importSessionsInput');
        if (fileInput) {
            fileInput.click();
        }
    }

    async handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        // Validate file type
        if (!file.name.endsWith('.json')) {
            domManager.updateStatus('Please select a JSON file', 'warning');
            return;
        }

        try {
            domManager.updateStatus('Importing sessions...', 'info');
            
            // Read file content
            const fileContent = await this.readFileAsText(file);
            
            // Import sessions with merge enabled, no duplicates overwrite by default
            const result = await storageManager.importSessions(fileContent, {
                merge: true,
                overwriteDuplicates: false
            });

            // Handle results
            if (result.imported > 0) {
                this.refreshSessionsList();
                
                let message = `Successfully imported ${result.imported} session(s)`;
                if (result.skipped > 0) {
                    message += ` (${result.skipped} skipped due to duplicates)`;
                }
                
                domManager.updateStatus(message, 'success');
                Logger.debug('Session', `Import completed: ${result.imported} imported, ${result.skipped} skipped`);
                
                // Show detailed summary if there were duplicates
                if (result.duplicates > 0) {
                    const shouldOverwrite = confirm(
                        `Found ${result.duplicates} duplicate session(s). ` +
                        `Would you like to overwrite them with the imported versions?`
                    );
                    
                    if (shouldOverwrite) {
                        const overwriteResult = await storageManager.importSessions(fileContent, {
                            merge: true,
                            overwriteDuplicates: true
                        });
                        
                        this.refreshSessionsList();
                        domManager.updateStatus(
                            `Import completed: ${overwriteResult.imported} sessions imported (including overwrites)`, 
                            'success'
                        );
                    }
                }
            } else if (result.skipped > 0) {
                domManager.updateStatus('No new sessions imported - all sessions already exist', 'warning');
            } else {
                domManager.updateStatus('No valid sessions found in file', 'warning');
            }

        } catch (error) {
            Logger.error('Session', 'Error importing sessions:', error);
            
            let errorMessage = 'Error importing sessions';
            if (error.message.includes('Invalid import data')) {
                errorMessage = 'Invalid file format - please select a valid PIPS session export file';
            } else if (error.message.includes('JSON')) {
                errorMessage = 'Invalid JSON file format';
            }
            
            domManager.updateStatus(errorMessage, 'error');
        } finally {
            // Clear the file input
            event.target.value = '';
        }
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    downloadSingleSession(sessionId) {
        try {
            const success = storageManager.exportSingleSession(sessionId);
            if (success) {
                domManager.updateStatus('Session downloaded successfully', 'success');
                Logger.debug('Session', `Single session ${sessionId} exported by user`);
            } else {
                domManager.updateStatus('Error: Session not found', 'error');
            }
        } catch (error) {
            Logger.error('Session', 'Error downloading session:', error);
            domManager.updateStatus('Error downloading session', 'error');
        }
    }

    // Session data management
    saveCurrentSessionToStorage() {
        if (!appState.currentSessionData) {
            console.log('[DEBUG] No current session data to save');
            return;
        }
        
        // Get current state from UI
        const problemText = domManager.getElement('questionInput')?.value.trim() || '';
        const imageElement = domManager.getElement('imagePreview');
        const image = imageElement?.style.display !== 'none' ? imageElement.src : null;
        
        // Update session data
        appState.currentSessionData.problemText = problemText;
        appState.currentSessionData.image = image;
        appState.currentSessionData.title = this.generateSessionTitle(problemText);
        
        // Always update lastUsed when saving
        appState.currentSessionData.lastUsed = new Date().toISOString();
        
        // Get current chat history (this is critical for persistence)
        const chatHistory = messageManager.getCurrentChatHistory();
        appState.currentSessionData.chatHistory = chatHistory;
        
        console.log(`[DEBUG] Saving session ${appState.currentSessionData.id}:`);
        console.log(`[DEBUG] - Title: ${appState.currentSessionData.title}`);
        console.log(`[DEBUG] - Problem text length: ${problemText.length}`);
        console.log(`[DEBUG] - Chat history messages: ${chatHistory.length}`);
        if (chatHistory.length > 0) {
            console.log(`[DEBUG] - Sample message: ${chatHistory[0].sender} - ${chatHistory[0].content.substring(0, 50)}...`);
        }
        
        // Save to storage
        storageManager.saveSession(appState.currentSessionData.id, appState.currentSessionData);
        
        console.log(`[DEBUG] Successfully saved session: ${appState.currentSessionData.id} with ${appState.currentSessionData.chatHistory.length} messages`);
    }

    generateSessionTitle(problemText) {
        if (!problemText || problemText.trim() === '') {
            return 'Untitled Session';
        }
        
        // Take first meaningful part of the problem text
        const cleaned = problemText.trim().replace(/\s+/g, ' ');
        const maxLength = 50;
        
        if (cleaned.length <= maxLength) {
            return cleaned;
        }
        
        // Try to break at word boundaries
        const truncated = cleaned.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > maxLength * 0.6) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    createNewSession(problemText, image = null) {
        const sessionId = this.generateSessionId();
        const now = new Date().toISOString();
        
        // Validate that we have meaningful content before creating a session
        const hasContent = problemText && problemText.trim().length > 0;
        const title = hasContent ? this.generateSessionTitle(problemText) : 'Untitled Session';
        
        const newSession = {
            id: sessionId,
            title: title,
            problemText: problemText || '',
            image: image,
            createdAt: now,
            lastUsed: now,
            status: 'active',
            chatHistory: []
        };
        
        console.log(`[DEBUG] Created new session: ${sessionId}, title: "${title}", hasContent: ${hasContent}`);
        return newSession;
    }

    generateSessionId() {
        return 'session_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
    }

    switchToSession(sessionId) {
        console.log(`[DEBUG] Switching to session: ${sessionId}`);
        
        // Critical: Handle edge case - prevent switching while solving
        if (appState.isSolving) {
            domManager.updateStatus('Cannot switch sessions while solving. Please stop the current task first.', 'warning');
            return;
        }

        // Prevent multiple simultaneous switches
        if (window.sessionSwitchInProgress) {
            console.log('[DEBUG] Session switch already in progress, ignoring');
            return;
        }
        window.sessionSwitchInProgress = true;
        
        try {
            // Save current session state if we have one
            if (appState.currentSessionData) {
                console.log('[DEBUG] Saving current session state before switching');
                appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
                // Update the current state
                appState.currentSessionData.problemText = domManager.getElement('questionInput')?.value.trim() || '';
                const imageElement = domManager.getElement('imagePreview');
                appState.currentSessionData.image = imageElement?.style.display !== 'none' ? imageElement.src : null;
                appState.currentSessionData.title = this.generateSessionTitle(appState.currentSessionData.problemText);
                this.saveCurrentSessionToStorage();
            }
            
            // Load the selected session - use the same logic as refreshSessionsList for consistency
            let sessions = storageManager.loadSessions();
            console.log(`[DEBUG] Loaded sessions from storage:`, Object.keys(sessions));
            
            // Create the same combined sessions that the UI uses
            const allSessions = { ...sessions };
            if (appState.currentSessionData && appState.currentSessionData.id) {
                allSessions[appState.currentSessionData.id] = appState.currentSessionData;
                console.log(`[DEBUG] Added current session to combined sessions: ${appState.currentSessionData.id}`);
            }
            
            console.log(`[DEBUG] All available sessions:`, Object.keys(allSessions));
            
            // Debug: Show details about each available session
            Object.entries(allSessions).forEach(([id, sess]) => {
                console.log(`[DEBUG] Session ${id}: title="${sess.title}", status="${sess.status}"`);
            });
            
            let session = allSessions[sessionId];
            
            if (!session) {
                console.error(`[DEBUG] Session not found: ${sessionId}`);
                console.error(`[DEBUG] Available sessions:`, Object.keys(allSessions));
                console.error(`[DEBUG] Current session in state:`, appState.currentSessionData?.id);
                domManager.updateStatus('Session not found', 'error');
                return;
            }
            
            console.log(`[DEBUG] Found session: ${sessionId}, status: ${session.status}, title: ${session.title}`);
            
            console.log(`[DEBUG] Loading session: ${sessionId} with ${session.chatHistory ? session.chatHistory.length : 0} messages`);
            
            // Update state WITHOUT updating lastUsed to prevent reorganization on view
            appState.selectedSessionId = sessionId;
            appState.currentSessionData = { ...session };
            
            // Clear ALL selections first, then set the correct one
            document.querySelectorAll('.session-item').forEach(item => {
                item.classList.remove('selected');
            });
            
            // Set selection on the clicked session
            const targetElement = document.querySelector(`[data-session-id="${sessionId}"]`);
            if (targetElement) {
                console.log(`[DEBUG] Setting selected class on session: ${sessionId}`);
                targetElement.classList.add('selected');
            } else {
                console.error(`[DEBUG] Target element not found for session: ${sessionId}`);
                // Try again after a brief delay in case DOM is updating
                setTimeout(() => {
                    const retryElement = document.querySelector(`[data-session-id="${sessionId}"]`);
                    if (retryElement) {
                        retryElement.classList.add('selected');
                        console.log(`[DEBUG] Successfully set selected class on retry`);
                    }
                }, 50);
            }
            
            // Load session data into UI
            const questionInput = domManager.getElement('questionInput');
            if (questionInput) {
                questionInput.value = session.problemText || '';
            }
            
            // Check if session is used/read-only
            const isUsedSession = this.isSessionUsed(session);
            
            if (isUsedSession) {
                // Make session read-only
                this.setInputsReadOnly(`This session is ${session.status || 'used'}. Start a new session to solve another problem.`);
                domManager.updateStatus(`Viewing ${session.status || 'used'} session (read-only)`, 'info');
                console.log(`[DEBUG] Session ${sessionId} is read-only (status: ${session.status})`);
            } else {
                // Enable editing for fresh sessions
                this.clearAndEnableInputs();
                console.log(`[DEBUG] Session ${sessionId} is editable (status: ${session.status})`);
            }
            
            // Load image if present
            imageHandler.loadSessionImage(session.image);
            
            // Load chat history
            messageManager.loadChatHistory(session.chatHistory || []);
            
            domManager.updateStatus(`Switched to session: ${session.title}`, 'success');
            
        } catch (error) {
            console.error('[DEBUG] Error in switchToSession:', error);
            domManager.updateStatus('Error switching to session', 'error');
        } finally {
            // Always clear the switch lock
            setTimeout(() => {
                window.sessionSwitchInProgress = false;
            }, 100);
        }
    }

    deleteSession(sessionId, event) {
        if (event) {
            event.stopPropagation();
        }
        
        console.log(`[DEBUG] Attempting to delete session: ${sessionId}`);
        
        if (confirm('Are you sure you want to delete this session?')) {
            try {
                // Load sessions from storage
                const sessions = storageManager.loadSessions();
                console.log(`[DEBUG] Loaded ${Object.keys(sessions).length} sessions from storage`);
                
                // Delete from storage
                const sessionExistsInStorage = sessions.hasOwnProperty(sessionId);
                if (sessionExistsInStorage) {
                    delete sessions[sessionId];
                    storageManager.saveSessions(sessions);
                    console.log(`[DEBUG] Deleted session ${sessionId} from storage`);
                } else {
                    console.log(`[DEBUG] Session ${sessionId} not found in storage`);
                }
                
                // If this is the current session in memory, clear it
                if (appState.currentSessionData && appState.currentSessionData.id === sessionId) {
                    console.log(`[DEBUG] Deleting current session from memory: ${sessionId}`);
                    appState.currentSessionData = null;
                    appState.selectedSessionId = null;
                    
                    // Clear inputs and UI
                    domManager.clearInputs();
                    imageHandler.clearImage();
                    messageManager.clearChatAndRestoreWelcome();
                    this.clearAndEnableInputs();
                    
                    // Clear any final solution artifacts panels
                    document.querySelectorAll('.final-artifacts-compact').forEach(panel => {
                        panel.remove();
                    });
                }
                
                // If this was the selected session, clear selection
                if (appState.selectedSessionId === sessionId) {
                    console.log(`[DEBUG] Clearing selected session: ${sessionId}`);
                    appState.selectedSessionId = null;
                }
                
                // Force remove the DOM element immediately to provide instant feedback
                const sessionElement = document.querySelector(`[data-session-id="${sessionId}"]`);
                if (sessionElement) {
                    sessionElement.remove();
                    console.log(`[DEBUG] Removed DOM element for session: ${sessionId}`);
                }
                
                // Refresh the sessions list
                this.refreshSessionsList();
                
                domManager.updateStatus('Session deleted successfully', 'success');
                console.log(`[DEBUG] Session deletion completed: ${sessionId}`);
                
            } catch (error) {
                console.error(`[DEBUG] Error deleting session ${sessionId}:`, error);
                domManager.updateStatus('Error deleting session', 'error');
            }
        }
    }

    refreshSessionsList() {
        console.log('[DEBUG] Updating sessions list');
        
        const sessionsList = domManager.getElement('sessionsList');
        
        if (!sessionsList) {
            console.error('[DEBUG] Sessions list element not found');
            return;
        }
        
        try {
            // Ensure current session is saved to storage before refreshing list
            if (appState.currentSessionData && appState.currentSessionData.id) {
                console.log('[DEBUG] Ensuring current session is saved before refresh');
                this.saveCurrentSessionToStorage();
            }
            
            const storedSessions = storageManager.loadSessions();
            console.log(`[DEBUG] Loaded ${Object.keys(storedSessions).length} sessions from storage`);
            
            // Automatically clean up ghost sessions from storage
            this.cleanupGhostSessionsFromStorage(storedSessions);
            
            // Combine stored sessions with current session if it exists
            const allSessions = { ...storedSessions };
            if (appState.currentSessionData && appState.currentSessionData.id) {
                // Always include current session in the list, overriding stored version
                allSessions[appState.currentSessionData.id] = appState.currentSessionData;
                console.log(`[DEBUG] Including current session in list: ${appState.currentSessionData.id}`);
            }
            
            // Convert sessions object to array and sort by creation time (newest first)
            const sessionsArray = Object.values(allSessions).filter(session => {
                // Filter out invalid sessions and ghost sessions
                if (!session || !session.id) {
                    console.log('[DEBUG] Filtering out session without ID:', session);
                    return false;
                }
                
                // Filter out ghost sessions (much more aggressive filtering)
                const isGhostSession = (
                    (!session.title || session.title === 'Untitled Session' || session.title.trim() === '') &&
                    (!session.chatHistory || session.chatHistory.length === 0) &&
                    (!session.problemText || session.problemText.trim() === '') &&
                    (!session.image || session.image === null)
                );
                
                // Also filter out sessions with "solving" status but no actual content and are old
                const isStuckSolvingSession = (
                    session.status === 'solving' &&
                    (!session.chatHistory || session.chatHistory.length === 0) &&
                    (!session.problemText || session.problemText.trim() === '') &&
                    Date.now() - new Date(session.createdAt || 0).getTime() > 60000 // 1 minute old
                );
                
                if (isGhostSession) {
                    console.log('[DEBUG] Filtering out ghost session:', session.id, session.title);
                    return false;
                }
                
                if (isStuckSolvingSession) {
                    console.log('[DEBUG] Filtering out stuck solving session:', session.id, session.title);
                    return false;
                }
                
                return true;
            }).sort((a, b) => {
                // Primary sort: creation time (newest first)
                const createdA = new Date(a.createdAt || 0);
                const createdB = new Date(b.createdAt || 0);

                if (createdB - createdA !== 0) {
                    return createdB - createdA;
                }

                // Secondary sort (tie-breaker): lastUsed (newest first)
                const usedA = new Date(a.lastUsed || 0);
                const usedB = new Date(b.lastUsed || 0);
                return usedB - usedA;
            });
            
            console.log(`[DEBUG] Filtered and sorted ${sessionsArray.length} sessions`);
            
            // Track which session elements need to be created
            const sessionElementsToAdd = [];
            
            // Update existing elements and identify new ones
            sessionsArray.forEach(session => {
                const existingElement = sessionsList.querySelector(`[data-session-id="${session.id}"]`);
                
                if (existingElement) {
                    // Update existing element in place
                    this.updateSessionElement(existingElement, session);
                } else {
                    // Create new element
                    const sessionElement = this.createSessionElement(session);
                    if (sessionElement) {
                        sessionElementsToAdd.push(sessionElement);
                    }
                }
            });

            // Add new elements in sorted order
            sessionElementsToAdd.forEach(element => {
                sessionsList.appendChild(element);
            });

            // Reorder elements according to sort order
            const orderedElements = [];
            sessionsArray.forEach(session => {
                const element = sessionsList.querySelector(`[data-session-id="${session.id}"]`);
                if (element) {
                    orderedElements.push(element);
                }
            });
            
            // Remove orphaned DOM elements (sessions that no longer exist in data)
            const existingElements = sessionsList.querySelectorAll('.session-item');
            const validSessionIds = new Set(sessionsArray.map(s => s.id));
            
            existingElements.forEach(element => {
                const elementSessionId = element.getAttribute('data-session-id');
                if (!validSessionIds.has(elementSessionId)) {
                    console.log(`[DEBUG] Removing orphaned session element: ${elementSessionId}`);
                    element.remove();
                }
            });
            
            // Reorder DOM elements
            orderedElements.forEach(element => {
                sessionsList.appendChild(element);
            });
            
            // Update selection after reordering
            if (appState.selectedSessionId && appState.currentSessionData) {
                // Clear all selections first
                document.querySelectorAll('.session-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Set selection on the currently selected session
                const selectedElement = sessionsList.querySelector(`[data-session-id="${appState.selectedSessionId}"]`);
                if (selectedElement) {
                    selectedElement.classList.add('selected');
                    console.log(`[DEBUG] Set selection on session: ${appState.selectedSessionId}`);
                }
            }
            
            // Update session count in header
            const totalSessions = sessionsArray.length;
            console.log(`[DEBUG] Total sessions for header: ${totalSessions}`);
            this.updateSessionsHeader(totalSessions);
            
            // Replace feather icons for newly added session elements only
            try {
                sessionElementsToAdd.forEach(element => {
                    if (typeof feather !== 'undefined') {
                        feather.replace(element);
                    }
                });
            } catch (e) {
                console.warn('[DEBUG] Could not replace feather icons in new session elements:', e);
            }
            
            // Final cleanup: ensure no stuck spinner sessions remain in the UI
            this.removeStuckSpinnerElements();
            
        } catch (error) {
            console.error('[DEBUG] Error in refreshSessionsList:', error);
        }
    }

    // Remove any UI elements that still have spinners but shouldn't
    removeStuckSpinnerElements() {
        const sessionsList = domManager.getElement('sessionsList');
        if (!sessionsList) return;
        
        const sessionElements = sessionsList.querySelectorAll('.session-item');
        sessionElements.forEach(element => {
            const sessionId = element.getAttribute('data-session-id');
            const icon = element.querySelector('[data-feather="loader"]');
            
            // If element has a spinner icon but no corresponding valid session data, remove it
            if (icon && sessionId) {
                const sessions = storageManager.loadSessions();
                const allSessions = { ...sessions };
                if (appState.currentSessionData && appState.currentSessionData.id) {
                    allSessions[appState.currentSessionData.id] = appState.currentSessionData;
                }
                
                const session = allSessions[sessionId];
                if (!session || 
                    (!session.problemText && !session.chatHistory?.length && session.status !== 'solving')) {
                    console.log('[DEBUG] Removing stuck spinner element:', sessionId);
                    element.remove();
                }
            }
        });
    }

    updateSessionElement(element, session) {
        if (!element || !session) return;

        // Update status-based styling
        element.className = 'session-item'; // Reset classes
        if (session.status === 'completed') {
            element.classList.add('completed-session');
        } else if (session.status === 'interrupted') {
            element.classList.add('interrupted-session');
        } else if (session.status === 'solving') {
            element.classList.add('solving-session');
        }

        // Determine icon based on status
        let iconName = 'file-text';
        if (session.status === 'completed') iconName = 'check-circle';
        else if (session.status === 'interrupted') iconName = 'x-circle';
        else if (session.status === 'solving') iconName = 'loader';

        // Handle date safely
        let timeAgo = 'Unknown time';
        try {
            const displayDate = new Date(session.lastUsed || session.createdAt);
            timeAgo = this.getTimeAgo(displayDate);
        } catch (e) {
            console.warn('[DEBUG] Invalid date for session:', session.id, session.lastUsed, session.createdAt);
        }

        // Handle message count safely
        const messageCount = session.chatHistory ? session.chatHistory.length : 0;
        const messageText = messageCount === 1 ? 'message' : 'messages';

        // Handle title safely
        const title = session.title || 'Untitled Session';
        const safeTitle = this.escapeHtml(title);

        // Update icon - force complete refresh for reliability
        const iconContainer = element.querySelector('.session-icon');
        if (iconContainer) {
            const currentIcon = iconContainer.querySelector('i, svg');
            const currentIconName = currentIcon ? currentIcon.getAttribute('data-feather') : 'unknown';
            console.log(`[DEBUG] Updating session ${session.id} icon from ${currentIconName} to ${iconName} (status: ${session.status})`);
            
            // Always force refresh the icon to ensure proper updating
            iconContainer.innerHTML = `<i data-feather="${iconName}" style="width: 16px; height: 16px;"></i>`;
            console.log(`[DEBUG] Force replaced icon container for session ${session.id}`);
        }

        // Update title and meta
        const titleElement = element.querySelector('.session-title');
        const metaElement = element.querySelector('.session-meta');
        if (titleElement) titleElement.textContent = title;
        if (metaElement) metaElement.textContent = `${timeAgo} • ${messageCount} ${messageText}`;

        // Update status class
        const statusElement = element.querySelector('.session-status');
        if (statusElement) {
            statusElement.className = `session-status ${session.status || 'active'}`;
        }

        // Replace feather icons for this element only with a small delay to ensure DOM update
        setTimeout(() => {
            try {
                if (typeof feather !== 'undefined') {
                    feather.replace(element);
                }
                console.log(`[DEBUG] Feather icons replaced for session ${session.id} with status ${session.status} -> ${iconName}`);
            } catch (e) {
                console.warn('[DEBUG] Could not replace feather icons in updated element:', e);
            }
        }, 10);
    }

    createSessionElement(session) {
        if (!session || !session.id) {
            console.error('[DEBUG] Invalid session data:', session);
            return null;
        }
        
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item';
        sessionItem.setAttribute('data-session-id', session.id);
        
        // Add status-based styling
        if (session.status === 'completed') {
            sessionItem.classList.add('completed-session');
        } else if (session.status === 'interrupted') {
            sessionItem.classList.add('interrupted-session');
        } else if (session.status === 'solving') {
            sessionItem.classList.add('solving-session');
        }
        
        // Determine icon based on status
        let iconName = 'file-text';
        if (session.status === 'completed') iconName = 'check-circle';
        else if (session.status === 'interrupted') iconName = 'x-circle';
        else if (session.status === 'solving') iconName = 'loader';
        
        // Handle date safely
        let timeAgo = 'Unknown time';
        try {
            const displayDate = new Date(session.lastUsed || session.createdAt);
            timeAgo = this.getTimeAgo(displayDate);
        } catch (e) {
            console.warn('[DEBUG] Invalid date for session:', session.id, session.lastUsed, session.createdAt);
        }
        
        // Handle message count safely
        const messageCount = session.chatHistory ? session.chatHistory.length : 0;
        const messageText = messageCount === 1 ? 'message' : 'messages';
        
        // Handle title safely
        const title = session.title || 'Untitled Session';
        const safeTitle = this.escapeHtml(title);
        
        sessionItem.innerHTML = `
            <div class="session-icon">
                <i data-feather="${iconName}" style="width: 16px; height: 16px;"></i>
            </div>
            <div class="session-info">
                <div class="session-title">${safeTitle}</div>
                <div class="session-meta">${timeAgo} • ${messageCount} ${messageText}</div>
            </div>
            <div class="session-status ${session.status || 'active'}">
                <span class="status-dot"></span>
            </div>
            <div class="session-actions">
                <button class="session-download" title="Download this session">
                    <i data-feather="download" style="width: 12px; height: 12px;"></i>
                </button>
                <button class="session-delete" title="Delete session">
                    <i data-feather="x" style="width: 12px; height: 12px;"></i>
                </button>
            </div>
        `;
        
        // Add click handler for session switching
        sessionItem.addEventListener('click', (e) => {
            try {
                console.log(`[DEBUG] Session item clicked: ${session.id}`, session.title);
                
                if (!e.target.closest('.session-delete') && !e.target.closest('.session-download')) {
                    // Prevent multiple rapid clicks
                    if (sessionItem.dataset.switching === 'true') {
                        console.log('[DEBUG] Session switch already in progress, ignoring click');
                        return;
                    }
                    
                    sessionItem.dataset.switching = 'true';
                    
                    setTimeout(() => {
                        this.switchToSession(session.id);
                        sessionItem.dataset.switching = 'false';
                    }, 10);
                } else {
                    console.log(`[DEBUG] Action button clicked, not switching session`);
                }
            } catch (error) {
                console.error('[DEBUG] Error in session click handler:', error);
                sessionItem.dataset.switching = 'false';
            }
        });

        // Add click handler for download button
        const downloadButton = sessionItem.querySelector('.session-download');
        downloadButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadSingleSession(session.id);
        });

        // Add click handler for delete button
        const deleteButton = sessionItem.querySelector('.session-delete');
        deleteButton?.addEventListener('click', (e) => {
            this.deleteSession(session.id, e);
        });
        
        return sessionItem;
    }

    getTimeAgo(date) {
        if (!date) return 'Unknown time';
        
        let dateObj;
        try {
            dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) {
                return 'Invalid date';
            }
        } catch (e) {
            return 'Invalid date';
        }
        
        const now = new Date();
        const diffMs = now - dateObj;
        
        // Handle future dates
        if (diffMs < 0) {
            return 'Just now';
        }
        
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        const diffWeeks = Math.floor(diffMs / (86400000 * 7));
        const diffMonths = Math.floor(diffMs / (86400000 * 30));
        
        if (diffSecs < 30) return 'Just now';
        if (diffSecs < 60) return `${diffSecs}s ago`;
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffWeeks < 4) return `${diffWeeks}w ago`;
        if (diffMonths < 12) return `${diffMonths}mo ago`;
        
        // For very old dates, show the actual date
        return dateObj.toLocaleDateString();
    }

    updateSessionsHeader(totalSessions) {
        const header = document.querySelector('.sessions-header .form-label');
        if (!header) return;
        
        const baseText = 'Session History';
        const sessionCount = Math.max(0, totalSessions || 0);
        
        if (sessionCount === 0) {
            header.innerHTML = `
                <i data-feather="clock" style="width: 16px; height: 16px; margin-right: 8px;"></i>
                ${baseText}
            `;
        } else if (sessionCount === 1) {
            header.innerHTML = `
                <i data-feather="clock" style="width: 16px; height: 16px; margin-right: 8px;"></i>
                ${baseText} (1 session)
            `;
        } else {
            header.innerHTML = `
                <i data-feather="clock" style="width: 16px; height: 16px; margin-right: 8px;"></i>
                ${baseText} (${sessionCount} sessions)
            `;
        }
        
        // Ensure feather icons are replaced
        try {
            // Only replace icons in the header area
            const headerElement = document.querySelector('.sessions-header');
            if (headerElement && typeof feather !== 'undefined') {
                feather.replace(headerElement);
            }
        } catch (e) {
            console.warn('[DEBUG] Could not replace feather icons:', e);
        }
    }

    updateCurrentSessionDisplay() {
        // Since we've removed the separate currentSession element,
        // the session display is now handled by refreshSessionsList()
        // We can trigger a refresh of the sessions list to ensure the current session appears correctly
        this.refreshSessionsList();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Handle session-related socket events
    handleSessionConnected(data) {
        console.log('[DEBUG] SessionManager.handleSessionConnected called with data:', JSON.stringify(data));
        Logger.debug('Session', 'Session connected:', data);
        appState.currentSessionId = data.session_id;
        console.log('[DEBUG] Set appState.currentSessionId to:', data.session_id);
        
        const sessionInfoText = `Session: ${data.session_id.substring(0, 8)}`;
        console.log('[DEBUG] About to update session info to:', sessionInfoText);
        domManager.updateSessionInfo(sessionInfoText);
        
        console.log('[DEBUG] About to update status to: Connected - Ready to solve problems');
        domManager.updateStatus('Connected - Ready to solve problems', 'success');
    }

    // Session creation for solving
    handleSolveProblem(problemText, imageData) {
        // Auto-create session if none exists or we're viewing a stored session
        if (!appState.currentSessionData || appState.selectedSessionId !== null) {
            // Create new session
            console.log(`[DEBUG] Creating new session (previous status: ${appState.currentSessionData?.status || 'none'})`);
            appState.currentSessionData = this.createNewSession(problemText, imageData);
            appState.selectedSessionId = null; // Set to null for current/new session
            
            // Clear visual selection from stored sessions and update display
            document.querySelectorAll('.session-item').forEach(item => {
                item.classList.remove('selected');
            });
            
            // Immediately save new session to storage
            this.saveCurrentSessionToStorage();
            console.log(`[DEBUG] New session created and saved with ID: ${appState.currentSessionData.id}`);
            // Ensure UI immediately reflects the newly-created session
            this.refreshSessionsList();
        } else {
            // Update existing session
            appState.currentSessionData.problemText = problemText;
            appState.currentSessionData.image = imageData;
            appState.currentSessionData.title = this.generateSessionTitle(problemText);
            // Save updated session
            this.saveCurrentSessionToStorage();
            console.log(`[DEBUG] Updated and saved existing session: ${appState.currentSessionData.id}`);
            // Update sessions list to reflect any changes to the current session
            this.refreshSessionsList();
        }

        return appState.currentSessionData.id;
    }

    // Handle solving state changes
    handleSolvingStarted() {
        // Save current session data including chat history BEFORE starting to solve
        if (appState.currentSessionData) {
            appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
            appState.currentSessionData.status = 'solving';
            // Update lastUsed when solving starts
            appState.currentSessionData.lastUsed = new Date().toISOString();
            this.saveCurrentSessionToStorage();
            this.updateCurrentSessionDisplay();
            this.refreshSessionsList();
            
            // Make inputs read-only once solving starts
            this.setInputsReadOnly('Cannot modify problem while solving is in progress');
            
            // Add visual indicator to the current session in the unified list
            if (appState.selectedSessionId && appState.currentSessionData.id === appState.selectedSessionId) {
                const sessionElement = document.querySelector(`[data-session-id="${appState.selectedSessionId}"]`);
                if (sessionElement) {
                    sessionElement.classList.add('active-solving');
                }
            }
            
            // Start periodic saving during solving
            this.startPeriodicSaving();
        }
    }

    handleSolvingComplete() {
        console.log('[DEBUG] Handling solving completed - cleaning up UI and saving session');
        
        // Stop periodic saving
        this.stopPeriodicSaving();
        
        // Clean up any remaining UI indicators
        messageManager.cleanupAllActiveIndicators();
        
        // Update session status
        if (appState.currentSessionData) {
            appState.currentSessionData.status = 'completed';
            appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
            appState.currentSessionData.lastUsed = new Date().toISOString();
            this.saveCurrentSessionToStorage();
            this.refreshSessionsList();
            
            // Keep inputs read-only for completed sessions
            this.setInputsReadOnly('This session is completed. Start a new session to solve another problem.');
            
            console.log(`[DEBUG] Session ${appState.currentSessionData.id} marked as completed and saved with ${appState.currentSessionData.chatHistory.length} messages`);
        }
    }

    handleSolvingInterrupted() {
        console.log('[DEBUG] Handling solving interrupted - cleaning up UI and saving session');
        
        // Stop periodic saving
        this.stopPeriodicSaving();
        
        // CRITICAL: Clean up all UI indicators first
        messageManager.cleanupAllActiveIndicators();
        
        // Update session status
        if (appState.currentSessionData) {
            appState.currentSessionData.status = 'interrupted';
            appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
            appState.currentSessionData.lastUsed = new Date().toISOString();
            this.saveCurrentSessionToStorage();
            this.refreshSessionsList();
            
            // Keep inputs read-only for interrupted sessions
            this.setInputsReadOnly('This session was interrupted. Start a new session to solve another problem.');
            
            console.log(`[DEBUG] Session ${appState.currentSessionData.id} marked as interrupted and saved with ${appState.currentSessionData.chatHistory.length} messages`);
        }
    }

    // General handler for any session failure or error
    handleSolvingError() {
        console.log('[DEBUG] Handling solving error - cleaning up UI and saving session');
        
        // Stop periodic saving
        this.stopPeriodicSaving();
        
        // Clean up all UI indicators
        messageManager.cleanupAllActiveIndicators();
        
        // Update session status
        if (appState.currentSessionData) {
            appState.currentSessionData.status = 'interrupted';
            appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
            appState.currentSessionData.lastUsed = new Date().toISOString();
            this.saveCurrentSessionToStorage();
            this.refreshSessionsList();
            
            // Keep inputs read-only for error sessions
            this.setInputsReadOnly('This session encountered an error. Start a new session to solve another problem.');
            
            console.log(`[DEBUG] Session ${appState.currentSessionData.id} marked as interrupted due to error and saved with ${appState.currentSessionData.chatHistory.length} messages`);
        }
    }

    // Emergency cleanup method - can be called from anywhere when things go wrong
    emergencyCleanupAndSave() {
        console.log('[DEBUG] Emergency cleanup and save triggered');
        
        try {
            // Clean up all UI indicators
            messageManager.cleanupAllActiveIndicators();
            
            // Save whatever we have in the current session
            if (appState.currentSessionData) {
                appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
                appState.currentSessionData.status = 'interrupted';
                appState.currentSessionData.lastUsed = new Date().toISOString();
                this.saveCurrentSessionToStorage();
                this.refreshSessionsList();
                
                console.log(`[DEBUG] Emergency save completed for session ${appState.currentSessionData.id} with ${appState.currentSessionData.chatHistory.length} messages`);
            }
            
            // Reset solving state
            appState.isSolving = false;
            
            // Re-enable inputs
            this.clearAndEnableInputs();
            
        } catch (error) {
            console.error('[DEBUG] Error during emergency cleanup:', error);
        }
    }

    // Periodic saving mechanism
    startPeriodicSaving() {
        // Clear any existing interval
        this.stopPeriodicSaving();
        
        // Save every 10 seconds during solving to ensure we don't lose messages
        this.periodicSaveInterval = setInterval(() => {
            if (appState.currentSessionData && appState.isSolving) {
                console.log('[DEBUG] Periodic save triggered during solving');
                appState.currentSessionData.chatHistory = messageManager.getCurrentChatHistory();
                appState.currentSessionData.lastUsed = new Date().toISOString();
                this.saveCurrentSessionToStorage();
            } else {
                // Stop saving if we're no longer solving
                this.stopPeriodicSaving();
            }
        }, 10000); // 10 seconds
        
        console.log('[DEBUG] Started periodic saving during solving');
    }

    stopPeriodicSaving() {
        if (this.periodicSaveInterval) {
            clearInterval(this.periodicSaveInterval);
            this.periodicSaveInterval = null;
            console.log('[DEBUG] Stopped periodic saving');
        }
    }

    // Automatically cleanup ghost sessions from storage during refresh
    cleanupGhostSessionsFromStorage(sessions) {
        let deletedCount = 0;
        const sessionIds = Object.keys(sessions);
        
        sessionIds.forEach(sessionId => {
            const session = sessions[sessionId];
            
            // Same aggressive filtering logic
            const isGhostSession = (
                (!session.title || session.title === 'Untitled Session' || session.title.trim() === '') &&
                (!session.chatHistory || session.chatHistory.length === 0) &&
                (!session.problemText || session.problemText.trim() === '') &&
                (!session.image || session.image === null)
            );
            
            const isStuckSolvingSession = (
                session.status === 'solving' &&
                (!session.chatHistory || session.chatHistory.length === 0) &&
                (!session.problemText || session.problemText.trim() === '') &&
                Date.now() - new Date(session.createdAt || 0).getTime() > 60000 // 1 minute old
            );
            
            if (isGhostSession || isStuckSolvingSession) {
                console.log(`[DEBUG] Auto-removing ghost session from storage: ${sessionId}`);
                delete sessions[sessionId];
                deletedCount++;
            }
        });
        
        if (deletedCount > 0) {
            storageManager.saveSessions(sessions);
            console.log(`[DEBUG] Auto-cleaned ${deletedCount} ghost sessions from storage`);
        }
    }

    // Cleanup ghost sessions from storage
    cleanupGhostSessions() {
        console.log('[DEBUG] Starting ghost session cleanup');
        
        try {
            const sessions = storageManager.loadSessions();
            const sessionIds = Object.keys(sessions);
            let deletedCount = 0;
            
            sessionIds.forEach(sessionId => {
                const session = sessions[sessionId];
                
                // Identify ghost sessions
                const isGhostSession = (
                    (!session.title || session.title === 'Untitled Session') &&
                    (!session.chatHistory || session.chatHistory.length === 0) &&
                    (!session.problemText || session.problemText.trim() === '') &&
                    session.status !== 'solving' // Don't delete actual solving sessions
                );
                
                if (isGhostSession) {
                    // Check if it's old (more than 1 hour old)
                    const sessionAge = Date.now() - new Date(session.createdAt || 0).getTime();
                    const oneHour = 60 * 60 * 1000;
                    
                    if (sessionAge > oneHour) {
                        console.log(`[DEBUG] Cleaning up ghost session: ${sessionId}`);
                        delete sessions[sessionId];
                        deletedCount++;
                    }
                }
            });
            
            if (deletedCount > 0) {
                storageManager.saveSessions(sessions);
                console.log(`[DEBUG] Cleaned up ${deletedCount} ghost sessions`);
            } else {
                console.log('[DEBUG] No ghost sessions to clean up');
            }
            
        } catch (error) {
            console.error('[DEBUG] Error during ghost session cleanup:', error);
        }
    }

    // Enhanced clear all sessions with ghost cleanup
    clearAllSessionsEnhanced() {
        if (confirm('Are you sure you want to clear all session history? This cannot be undone.')) {
            try {
                // Also clear current session state
                appState.selectedSessionId = null;
                appState.currentSessionData = null;
                
                // Clear storage
                storageManager.clearAllSessions();
                
                // Clear UI
                domManager.clearInputs();
                imageHandler.clearImage();
                messageManager.clearChatAndRestoreWelcome();
                this.clearAndEnableInputs();
                
                // Clear any final solution artifacts panels
                document.querySelectorAll('.final-artifacts-compact').forEach(panel => {
                    panel.remove();
                });
                
                // Clear DOM elements manually
                const sessionsList = domManager.getElement('sessionsList');
                if (sessionsList) {
                    sessionsList.innerHTML = '';
                }
                
                this.refreshSessionsList();
                domManager.updateStatus('All sessions cleared', 'success');
                Logger.debug('Session', 'All sessions cleared by user');
                
            } catch (error) {
                Logger.error('Session', 'Error clearing sessions:', error);
                domManager.updateStatus('Error clearing sessions', 'error');
            }
        }
    }
}

// Create singleton instance
export const sessionManager = new SessionManager(); 