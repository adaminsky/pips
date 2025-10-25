/**
 * Application State Management
 */
import { Logger } from './logger.js';

export class AppState {
    constructor() {
        // Core session state
        this.currentSessionId = null;
        this.isSolving = false;
        this.currentIteration = 0;
        this.maxIterationsCount = 8;
        this.isAwaitingUserFeedback = false;
        
        // Session management state
        this.currentSessionData = null;
        this.selectedSessionId = null; // Currently loaded session (null means current/new session)
        this.sessionsExpanded = false;
        
        // Streaming and execution tracking
        this.streamingMessages = new Map(); // Track streaming messages by iteration
        this.executionSpinners = new Map(); // Track execution spinners by iteration
        
        // Timeout and connection monitoring
        this.solvingTimeoutId = null;
        this.connectionTimeoutId = null;
        this.lastHeartbeat = Date.now();
        this.connectionRetries = 0;
        
        // Constants
        this.SOLVING_TIMEOUT_MS = 300000; // 5 minutes timeout for solving
        this.CONNECTION_TIMEOUT_MS = 30000; // 30 seconds timeout for connection issues
        this.HEARTBEAT_INTERVAL_MS = 15000; // Send heartbeat every 15 seconds
        this.MAX_CONNECTION_RETRIES = 3;
        
        // Session storage
        this.SESSION_STORAGE_KEY = 'pips_sessions';

        
        // Event listeners for state changes
        this.listeners = {};
    }

    // Event system for state changes
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    // Session management
    setCurrentSession(sessionData) {
        this.currentSessionData = sessionData;
        this.emit('sessionChanged', sessionData?.id);
        Logger.debug('State', 'Current session updated', sessionData?.id);
    }

    setSelectedSession(sessionId) {
        this.selectedSessionId = sessionId;
        this.emit('selectedSessionChanged', sessionId);
        Logger.debug('State', 'Selected session changed', sessionId);
    }

    // Solving state
    setSolving(solving) {
        this.isSolving = solving;
        this.emit('solvingStateChanged', solving);
        Logger.debug('State', `Solving state: ${solving}`);
    }

    setIteration(iteration) {
        this.currentIteration = iteration;
        this.emit('iterationChanged', iteration);
    }

    // User feedback state (for interactive mode)
    setUserFeedback(awaiting) {
        this.isAwaitingUserFeedback = awaiting;
        this.emit('userFeedbackStateChanged', awaiting);
        Logger.debug('State', `User feedback state: ${awaiting}`);
    }

    // Connection state
    setConnectionRetries(retries) {
        this.connectionRetries = retries;
        this.emit('connectionRetriesChanged', retries);
    }

    updateLastHeartbeat() {
        this.lastHeartbeat = Date.now();
    }

    // Timeout management
    setSolvingTimeout(timeoutId) {
        this.clearSolvingTimeout();
        this.solvingTimeoutId = timeoutId;
    }

    clearSolvingTimeout() {
        if (this.solvingTimeoutId) {
            clearTimeout(this.solvingTimeoutId);
            this.solvingTimeoutId = null;
        }
    }

    setConnectionTimeout(timeoutId) {
        this.clearConnectionTimeout();
        this.connectionTimeoutId = timeoutId;
    }

    clearConnectionTimeout() {
        if (this.connectionTimeoutId) {
            clearTimeout(this.connectionTimeoutId);
            this.connectionTimeoutId = null;
        }
    }

    // Streaming management
    addStreamingMessage(id, element) {
        this.streamingMessages.set(id, element);
    }

    removeStreamingMessage(id) {
        this.streamingMessages.delete(id);
    }

    addExecutionSpinner(id, element) {
        this.executionSpinners.set(id, element);
    }

    removeExecutionSpinner(id) {
        this.executionSpinners.delete(id);
    }

    // Get current state snapshot
    getSnapshot() {
        return {
            currentSessionId: this.currentSessionId,
            isSolving: this.isSolving,
            currentIteration: this.currentIteration,
            selectedSessionId: this.selectedSessionId,
            connectionRetries: this.connectionRetries,
            lastHeartbeat: this.lastHeartbeat,
            streamingMessagesCount: this.streamingMessages.size,
            executionSpinnersCount: this.executionSpinners.size
        };
    }

    // Reset state (for new session)
    reset() {
        this.currentSessionId = null;
        this.isSolving = false;
        this.currentIteration = 0;
        this.isAwaitingUserFeedback = false;
        this.currentSessionData = null;
        this.selectedSessionId = null;
        this.clearSolvingTimeout();
        this.clearConnectionTimeout();
        this.streamingMessages.clear();
        this.executionSpinners.clear();
        this.emit('stateReset');
        Logger.debug('State', 'Application state reset');
    }
}

// Create singleton instance
export const appState = new AppState(); 