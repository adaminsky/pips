/**
 * Socket.IO connection and event management
 */
import { Logger } from '../core/logger.js';
import { appState } from '../core/state.js';

export class SocketManager {
    constructor() {
        this.socket = null;
        this.eventHandlers = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) {
            Logger.warn('Socket', 'Already initialized');
            return this.socket;
        }

        try {
            Logger.debug('Socket', 'Initializing Socket.IO connection...');
            
            this.socket = io({
                transports: ['websocket', 'polling'],
                timeout: 20000,
                forceNew: true,
                upgrade: true,
                rememberUpgrade: true,
                autoConnect: true,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 5,
                maxHttpBufferSize: 1e6,
                pingTimeout: 60000,
                pingInterval: 25000
            });

            this.setupConnectionHandlers();
            
            // Register any cached handlers after socket creation
            this.registerCachedEventHandlers();
            
            this.isInitialized = true;
            
            Logger.debug('Socket', 'Socket.IO initialized successfully');
            return this.socket;
        } catch (e) {
            Logger.error('Socket', 'Error initializing Socket.IO:', e);
            throw e;
        }
    }

    setupConnectionHandlers() {
        this.socket.on('connect', () => {
            Logger.debug('Socket', 'Socket connected successfully');
            Logger.debug('Socket', 'Socket ID:', this.socket.id);
            Logger.debug('Socket', 'Socket connected:', this.socket.connected);
            Logger.debug('Socket', 'Socket transport:', this.socket.io.engine.transport.name);
            
            // Clear timeouts and reset connection state on successful connect
            appState.clearConnectionTimeout();
            appState.setConnectionRetries(0);
            appState.updateLastHeartbeat();
            
            this.emit('connected', { 
                socketId: this.socket.id,
                transport: this.socket.io.engine.transport.name 
            });
        });

        this.socket.on('disconnect', (reason) => {
            Logger.debug('Socket', 'Socket disconnected');
            Logger.debug('Socket', 'Disconnect reason:', reason);
            Logger.debug('Socket', 'Socket connected:', this.socket.connected);
            
            // Clear all timeouts and reset state on disconnect
            appState.clearSolvingTimeout();
            appState.clearConnectionTimeout();
            appState.currentSessionId = null;
            
            this.emit('disconnected', { reason });
        });

        this.socket.on('connect_error', (error) => {
            Logger.error('Socket', 'Socket connection error:', error);
            Logger.error('Socket', 'Error details:', error.message);
            
            this.emit('connectionError', { error });
        });

        this.socket.io.on('error', (error) => {
            Logger.error('Socket', 'Socket.IO error:', error);
            this.emit('ioError', { error });
        });
    }

    // Event subscription system
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
        
        Logger.debug('Socket', `Handler stored for event: ${event}`);
    }

    // Emit custom events (not socket events)
    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (e) {
                    Logger.error('Socket', `Error in event handler for ${event}:`, e);
                }
            });
        }
    }

    // Send data to server
    send(event, data) {
        if (!this.socket || !this.socket.connected) {
            Logger.error('Socket', 'Cannot send - socket not connected');
            return false;
        }

        try {
            this.socket.emit(event, data);
            Logger.debug('Socket', `Sent event: ${event}`, data);
            return true;
        } catch (e) {
            Logger.error('Socket', `Error sending event ${event}:`, e);
            return false;
        }
    }

    // Connection utilities
    isConnected() {
        return this.socket && this.socket.connected;
    }

    getSocketId() {
        return this.socket?.id || null;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            Logger.debug('Socket', 'Socket disconnected manually');
        }
    }

    reconnect() {
        if (this.socket) {
            this.socket.disconnect();
            setTimeout(() => {
                this.socket.connect();
                Logger.debug('Socket', 'Attempting manual reconnection');
            }, 1000);
        }
    }

    // Register all event handlers from the original monolithic code
    registerEventHandlers(handlers) {
        Object.entries(handlers).forEach(([event, handler]) => {
            // Store in internal system for tracking
            if (!this.eventHandlers.has(event)) {
                this.eventHandlers.set(event, []);
            }
            this.eventHandlers.get(event).push(handler);
            
            // Register directly with socket if it exists
            if (this.socket) {
                this.socket.on(event, handler);
                Logger.debug('Socket', `Registered handler for event: ${event}`);
            } else {
                Logger.debug('Socket', `Cached handler for event: ${event} (socket not ready)`);
            }
        });
    }

    // Helper method to register all cached handlers after socket creation
    registerCachedEventHandlers() {
        console.log('[DEBUG] registerCachedEventHandlers called, handlers map:', this.eventHandlers);
        this.eventHandlers.forEach((handlers, event) => {
            handlers.forEach(handler => {
                if (this.socket) {
                    this.socket.on(event, handler);
                    console.log(`[DEBUG] Registered cached handler for event: ${event}`);
                    Logger.debug('Socket', `Registered cached handler for event: ${event}`);
                }
            });
        });
    }
}

// Create singleton instance
export const socketManager = new SocketManager(); 