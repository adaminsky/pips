/**
 * PIPS - Main Application Bootstrap
 * Initializes the modular PIPS application
 */

// Import core modules
import { Logger } from './core/logger.js';
import { appState } from './core/state.js';
import { socketManager } from './network/socket.js';
import { storageManager } from './core/storage.js';

// Import UI modules
import { domManager } from './ui/dom-manager.js';
import { messageManager } from './ui/message-manager.js';
import { settingsManager } from './ui/settings-manager.js';
import { sessionManager } from './ui/session-manager.js';
import { imageHandler } from './ui/image-handler.js';

// Import handlers
import { socketEventHandlers } from './handlers/socket-handlers.js';

// Global error handlers
window.addEventListener('error', (event) => {
    Logger.error('Global JavaScript error:', event.error);
    Logger.error('Error message:', event.message);
    Logger.error('Error filename:', event.filename);
    Logger.error('Error line:', event.lineno);
    Logger.error('Error column:', event.colno);
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('Unhandled promise rejection:', event.reason);
});

/**
 * Main Application class - Coordinates all modules
 */
class PIPSApplication {
    constructor() {
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) {
            Logger.warn('App', 'Application already initialized');
            return;
        }

        try {
            Logger.log('App', 'Initializing PIPS application...');
            
            // Initialize managers
            domManager.setupDOMReferences();
            await domManager.initializeIcons();
            
            // Set up event handlers
            socketManager.initialize();
            sessionManager.initialize();
            settingsManager.initialize();
            imageHandler.initialize();
            
            // Load user settings from storage
            settingsManager.loadUserSettingsFromStorage();
            
            // Perform first-run seeding of default sessions
            await this.performFirstRunSeeding();
            
            // Set up additional image features
            imageHandler.setupPasteHandler();
            
            // Set up core functionality event listeners
            this.setupCoreEventListeners();
            
            // Register *all* socket & connection handlers BEFORE connecting
            this.setupSocketHandlers();
            
            // Connect socket *after* handlers are registered
            await socketManager.initialize();
            
            // Set initial status
            domManager.updateStatus('Connecting to PIPS server...', 'info');
            
            this.isInitialized = true;
            Logger.log('App', 'PIPS application initialized successfully');
            
        } catch (error) {
            Logger.error('App', 'Error during initialization:', error);
            domManager.updateStatus('Failed to initialize application', 'error');
        }
    }

    async performFirstRunSeeding() {
        try {
            // Check if this is the first run
            if (!localStorage.getItem('pips_first_run_completed')) {
                Logger.debug('App', 'First run detected, seeding default sessions...');
                
                try {
                    const result = await storageManager.importSessionsFromUrl('/static/default_sessions/builtin_sessions.json');
                    Logger.log('App', `Seeded ${result.imported} default sessions successfully`);
                    
                    // Track which sessions are defaults by storing their IDs
                    if (result.imported > 0) {
                        const sessions = storageManager.loadSessions();
                        const defaultSessionIds = Object.keys(sessions);
                        storageManager.saveDefaultSessionIds(defaultSessionIds);
                        Logger.debug('App', `Tracked ${defaultSessionIds.length} default session IDs`);
                    }
                    
                    // Mark first run as completed
                    localStorage.setItem('pips_first_run_completed', 'yes');
                    localStorage.setItem('pips_default_sessions_loaded', new Date().toISOString());
                    
                } catch (error) {
                    Logger.warn('App', 'Could not load default sessions (this is normal in development):', error.message);
                    // Still mark as completed to avoid repeated attempts
                    localStorage.setItem('pips_first_run_completed', 'yes');
                }
            } else {
                Logger.debug('App', 'Not first run, skipping default session seeding');
            }
        } catch (error) {
            Logger.error('App', 'Error during first-run seeding:', error);
        }
    }

    setupCoreEventListeners() {
        // Core problem solving functionality
        domManager.getElement('solveBtn')?.addEventListener('click', () => this.solveProblem());
        domManager.getElement('interruptBtn')?.addEventListener('click', () => this.interruptSolving());
        domManager.getElement('downloadBtn')?.addEventListener('click', () => messageManager.downloadChat());

        Logger.debug('App', 'Core event listeners set up');
        
        // Set up emergency cleanup handler for page unload
        window.addEventListener('beforeunload', () => {
            Logger.debug('App', 'Page unloading - performing emergency cleanup');
            sessionManager.emergencyCleanupAndSave();
        });
        

    }

    setupSocketHandlers() {
        console.log('[DEBUG] Setting up socket handlers...');
        
        // Register all socket event handlers (these are real Socket.IO events)
        const eventHandlers = socketEventHandlers.getEventHandlers();
        console.log('[DEBUG] Event handlers to register:', Object.keys(eventHandlers));
        socketManager.registerEventHandlers(eventHandlers);
        
        // Register connection handlers (these are internal socketManager events)
        const connectionHandlers = socketEventHandlers.getConnectionHandlers();
        console.log('[DEBUG] Connection handlers to register:', Object.keys(connectionHandlers));
        Object.entries(connectionHandlers).forEach(([event, handler]) => {
            socketManager.on(event, handler);
        });

        Logger.debug('App', 'Socket event handlers set up successfully');
    }

    // Core functionality methods
    solveProblem() {
        const questionInput = domManager.getElement('questionInput');
        const text = questionInput?.value.trim();
        
        if (!text) {
            domManager.updateStatus('Please enter a problem description', 'warning');
            return;
        }

        // Check if the current session is used and should be read-only
        if (appState.currentSessionData && sessionManager.isSessionUsed(appState.currentSessionData)) {
            domManager.updateStatus('This session has been used. Please start a new session to solve another problem.', 'warning');
            // Automatically start a new session
            sessionManager.startNewSession();
            return;
        }

        // Get image data if available
        const imageData = imageHandler.getImageForSubmission();

        // Handle session creation/management through session manager
        const sessionId = sessionManager.handleSolveProblem(text, imageData);

        // Send current settings to server first to ensure PIPS mode is included
        settingsManager.sendCurrentSettingsToServer();

        // Send problem to server
        socketManager.send('solve_problem', {
            text: text,
            image: imageData,
            session_id: sessionId
        });

        Logger.debug('App', 'Problem submitted for solving');
    }

    interruptSolving() {
        Logger.debug('App', 'Interrupt button clicked');
        socketManager.send('interrupt_solving');
        domManager.updateStatus('Interrupting current task...', 'warning');
    }

    // Global method for message expansion (called from HTML)
    toggleExpandMessage(button) {
        messageManager.toggleExpandMessage(button);
    }

    // Global methods for session management (called from HTML)
    get sessionManager() {
        return sessionManager;
    }

    // Expose modules for debugging and external access
    getModules() {
        return {
            domManager,
            messageManager,
            settingsManager,
            sessionManager,
            imageHandler,
            socketEventHandlers,
            appState,
            socketManager,
            storageManager
        };
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    Logger.log('DOM content loaded');
    
    try {
        const app = new PIPSApplication();
        await app.initialize();
        
        // Store app instance globally for debugging and HTML callbacks
        window.pipsApp = app;
        
        // Also expose key functions globally for HTML access
        window.toggleExpandMessage = (button) => app.toggleExpandMessage(button);
        

        
    } catch (error) {
        Logger.error('Failed to initialize PIPS application:', error);
    }
}); 
