/**
 * Settings Manager - Handles settings modal, API key management, and form handling
 */
import { Logger } from '../core/logger.js';
import { storageManager } from '../core/storage.js';
import { socketManager } from '../network/socket.js';
import { domManager } from './dom-manager.js';

export class SettingsManager {
    constructor() {
        this.isInitialized = false;
    }

    initialize() {
        if (this.isInitialized) return;
        
        this.setupEventListeners();
        this.loadApiKeysFromStorage();
        
        // Initialize PIPS mode to default first
        this.initializePIPSMode();
        
        // Then load user settings (which may override the default)
        this.loadUserSettingsFromStorage();
        
        this.isInitialized = true;
        
        Logger.debug('Settings', 'Settings manager initialized');
    }

    setupEventListeners() {
        // Settings modal listeners
        domManager.getElement('settingsBtn')?.addEventListener('click', () => this.openSettings());
        domManager.getElement('closeBtn')?.addEventListener('click', () => this.closeSettings());
        domManager.getElement('settingsForm')?.addEventListener('submit', (e) => this.saveSettings(e));
        
        // PIPS Mode iOS switch listener
        domManager.getElement('pipsModeSwitch')?.addEventListener('change', () => {
            this.updateModeIndicator();
            this.autoSaveSettings();
        });
        
        // Auto-save on model selection changes
        domManager.getElement('generatorModelSelect')?.addEventListener('change', () => this.autoSaveSettings());
        domManager.getElement('criticModelSelect')?.addEventListener('change', () => this.autoSaveSettings());
        
        // Auto-save on other setting changes
        domManager.getElement('maxIterations')?.addEventListener('change', () => this.autoSaveSettings());
        domManager.getElement('temperature')?.addEventListener('change', () => this.autoSaveSettings());
        domManager.getElement('maxTokens')?.addEventListener('change', () => this.autoSaveSettings());
        domManager.getElement('maxExecutionTime')?.addEventListener('change', () => this.autoSaveSettings());
        // Custom rules handling - different behavior for global vs per-session
        // Per-session rules (navbar) - don't auto-save to localStorage
        domManager.getElement('customRules')?.addEventListener('input', () => {
            // Per-session rules are not saved to localStorage
            Logger.debug('Settings', 'Per-session custom rules updated');
        });
        
        // Global rules (settings modal) - auto-save to localStorage
        domManager.getElement('customRulesSettings')?.addEventListener('input', () => {
            this.autoSaveSettings();
        });
        
        // Settings tabs listeners
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => this.switchTab(button.dataset.tab));
        });
        
        // Modal click-outside-to-close
        window.addEventListener('click', (event) => {
            if (event.target === domManager.getElement('settingsModal')) {
                this.closeSettings();
            }
        });

        // Clear all sessions button with retry mechanism
        const setupClearAllButton = () => {
            const clearAllBtn = document.getElementById('clearAllSessionsBtn');
            console.log('[DEBUG] Clear all sessions button:', clearAllBtn);
            if (clearAllBtn) {
                clearAllBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('[DEBUG] Clear all sessions button clicked');
                    this.clearAllSessions();
                });
                console.log('[DEBUG] Clear all sessions button listener added');
                return true;
            } else {
                console.error('[DEBUG] Clear all sessions button not found');
                return false;
            }
        };
        
        // Try immediately
        if (!setupClearAllButton()) {
            // If not found, try again after a delay
            setTimeout(() => {
                setupClearAllButton();
            }, 100);
        }
        
        // Also add a global click handler as backup
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'clearAllSessionsBtn') {
                e.preventDefault();
                console.log('[DEBUG] Clear all sessions button clicked via global handler');
                this.clearAllSessions();
            }
        });

        Logger.debug('Settings', 'Event listeners set up');
    }

    initializePIPSMode() {
        const pipsModeSwitch = domManager.getElement('pipsModeSwitch');
        const agentRadio = domManager.getElement('pipsModeAgent');
        const interactiveRadio = domManager.getElement('pipsModeInteractive');
        
        // Set Agent mode as default (will be overridden by loadUserSettingsFromStorage if user has saved settings)
        if (pipsModeSwitch) {
            pipsModeSwitch.checked = false; // Agent mode (unchecked state)
        }
        
        // Ensure radio buttons are in sync with switch
        if (agentRadio && interactiveRadio && pipsModeSwitch) {
            const isInteractive = pipsModeSwitch.checked;
            agentRadio.checked = !isInteractive;
            interactiveRadio.checked = isInteractive;
        }
        
        // Update the mode indicator
        this.updateModeIndicator();
        
        Logger.debug('Settings', 'PIPS mode initialized to default (Agent)');
    }

    openSettings() {
        domManager.getElement('settingsModal').style.display = 'block';
        Logger.debug('Settings', 'Settings modal opened');
    }

    closeSettings() {
        domManager.getElement('settingsModal').style.display = 'none';
        Logger.debug('Settings', 'Settings modal closed');
    }

    saveSettings(e) {
        e.preventDefault();
        
        try {
            this.saveApiKeysToStorage();
            // Persist non-sensitive user settings (exclude API keys and session rules) to localStorage
            const { openai_api_key, google_api_key, anthropic_api_key, session_rules, ...nonSensitive } = this.getCurrentSettings();
            storageManager.saveUserSettings(nonSensitive);
            this.sendCurrentSettingsToServer();
            Logger.debug('Settings', 'Settings saved successfully');
        } catch (error) {
            Logger.error('Settings', 'Error saving settings:', error);
            domManager.updateStatus('Error saving settings', 'error');
        }
    }

    // Auto-save settings to localStorage (without sending to server or showing status)
    autoSaveSettings() {
        try {
            // Only save non-sensitive settings to localStorage
            const { openai_api_key, google_api_key, anthropic_api_key, session_rules, ...nonSensitive } = this.getCurrentSettings();
            // Remove session_rules from saved settings - they should not persist
            storageManager.saveUserSettings(nonSensitive);
            Logger.debug('Settings', 'Settings auto-saved to localStorage (excluding per-session rules)');
        } catch (error) {
            Logger.error('Settings', 'Error auto-saving settings:', error);
        }
    }

    loadApiKeysFromStorage() {
        try {
            const apiKeys = storageManager.loadApiKeys();
            
            if (apiKeys.openai_api_key) {
                domManager.getElement('openaiApiKeyInput').value = apiKeys.openai_api_key;
            }
            if (apiKeys.google_api_key) {
                domManager.getElement('googleApiKeyInput').value = apiKeys.google_api_key;
            }
            if (apiKeys.anthropic_api_key) {
                domManager.getElement('anthropicApiKeyInput').value = apiKeys.anthropic_api_key;
            }
            
            Logger.debug('Settings', 'API keys loaded from storage');
        } catch (error) {
            Logger.error('Settings', 'Error loading API keys from storage:', error);
        }
    }

    saveApiKeysToStorage() {
        try {
            const apiKeys = {
                openai_api_key: domManager.getElement('openaiApiKeyInput').value.trim(),
                google_api_key: domManager.getElement('googleApiKeyInput').value.trim(),
                anthropic_api_key: domManager.getElement('anthropicApiKeyInput').value.trim()
            };
            
            storageManager.saveApiKeys(apiKeys);
            Logger.debug('Settings', 'API keys saved to storage');
        } catch (error) {
            Logger.error('Settings', 'Error saving API keys to storage:', error);
        }
    }

    sendCurrentSettingsToServer() {
        try {
            const pipsModeSwitch = domManager.getElement('pipsModeSwitch');
            const pipsMode = pipsModeSwitch?.checked ? 'INTERACTIVE' : 'AGENT';
            
            const settings = {
                model: domManager.getElement('generatorModelSelect')?.value || 'gpt-4o-mini',
                openai_api_key: domManager.getElement('openaiApiKeyInput').value.trim(),
                google_api_key: domManager.getElement('googleApiKeyInput').value.trim(),
                anthropic_api_key: domManager.getElement('anthropicApiKeyInput').value.trim(),
                max_iterations: parseInt(domManager.getElement('maxIterations').value),
                temperature: parseFloat(domManager.getElement('temperature').value),
                max_tokens: parseInt(domManager.getElement('maxTokens').value),
                max_execution_time: parseInt(domManager.getElement('maxExecutionTime').value),
                // New PIPS interactive mode settings
                pips_mode: pipsMode,
                generator_model: domManager.getElement('generatorModelSelect')?.value || 'gpt-4o-mini',
                critic_model: domManager.getElement('criticModelSelect')?.value || 'gpt-4o-mini',
                // Send combined rules to backend and separate fields for internal tracking
                custom_rules: this.getCombinedRulesForBackend(),
                global_rules: domManager.getElement('customRulesSettings')?.value?.trim() || '',
                session_rules: domManager.getElement('customRules')?.value?.trim() || ''
            };
            
            socketManager.send('update_settings', settings);
            Logger.debug('Settings', 'Settings sent to server:', settings);
        } catch (error) {
            Logger.error('Settings', 'Error sending settings to server:', error);
        }
    }

    updateModeIndicator() {
        const pipsModeSwitch = domManager.getElement('pipsModeSwitch');
        const modeDescription = domManager.getElement('modeDescription');
        const agentRadio = domManager.getElement('pipsModeAgent');
        const interactiveRadio = domManager.getElement('pipsModeInteractive');
        
        if (pipsModeSwitch && modeDescription) {
            const isInteractive = pipsModeSwitch.checked;
            const selectedMode = isInteractive ? 'INTERACTIVE' : 'AGENT';
            
            // Update description text
            modeDescription.textContent = isInteractive 
                ? 'Collaborate with AI at each step'
                : 'Automatic solving without user intervention';
            
            // Sync with hidden radio buttons for backend compatibility
            if (agentRadio && interactiveRadio) {
                agentRadio.checked = !isInteractive;
                interactiveRadio.checked = isInteractive;
            }
            
            Logger.debug('Settings', 'PIPS mode updated to:', selectedMode);
        }
    }

    switchTab(tabName) {
        // Remove active class from all tab buttons and content
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked tab button and corresponding content
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        document.querySelector(`#${tabName}-tab`)?.classList.add('active');
        
        Logger.debug('Settings', 'Switched to tab:', tabName);
    }

    // Handle settings update response from server
    handleSettingsUpdated(data) {
        Logger.debug('Settings', 'Settings update response:', data);
        
        if (data.status === 'success') {
            domManager.updateStatus('Settings saved successfully!', 'success');
            this.closeSettings();
        } else {
            domManager.updateStatus(`Settings error: ${data.message}`, 'error');
        }
    }

    // Load saved API keys and send to server (called on app initialization)
    initializeServerSettings() {
        const apiKeys = storageManager.loadApiKeys();
        
        if (apiKeys.openai_api_key || apiKeys.google_api_key) {
            Logger.debug('Settings', 'Loading saved API keys and sending to server');
            this.sendCurrentSettingsToServer();
            domManager.updateStatus('API keys loaded from browser storage', 'success');
        }
    }

    // Get current settings snapshot
    getCurrentSettings() {
        const pipsModeSwitch = domManager.getElement('pipsModeSwitch');
        const pipsMode = pipsModeSwitch?.checked ? 'INTERACTIVE' : 'AGENT';
        
        return {
            model: domManager.getElement('generatorModelSelect')?.value || 'gpt-4o-mini',
            openai_api_key: domManager.getElement('openaiApiKeyInput')?.value?.trim(),
            google_api_key: domManager.getElement('googleApiKeyInput')?.value?.trim(),
            anthropic_api_key: domManager.getElement('anthropicApiKeyInput')?.value?.trim(),
            max_iterations: parseInt(domManager.getElement('maxIterations')?.value),
            temperature: parseFloat(domManager.getElement('temperature')?.value),
            max_tokens: parseInt(domManager.getElement('maxTokens')?.value),
            max_execution_time: parseInt(domManager.getElement('maxExecutionTime')?.value),
            // PIPS interactive mode settings
            pips_mode: pipsMode,
            generator_model: domManager.getElement('generatorModelSelect')?.value || 'gpt-4o-mini',
            critic_model: domManager.getElement('criticModelSelect')?.value || 'gpt-4o-mini',
            // Send combined rules to backend and separate fields for internal tracking
            custom_rules: this.getCombinedRulesForBackend(),
            global_rules: domManager.getElement('customRulesSettings')?.value?.trim() || '',
            session_rules: domManager.getElement('customRules')?.value?.trim() || ''
        };
    }

    // Update settings programmatically
    updateSettings(settings) {
        if (settings.openai_api_key && domManager.getElement('openaiApiKeyInput')) {
            domManager.getElement('openaiApiKeyInput').value = settings.openai_api_key;
        }
        if (settings.google_api_key && domManager.getElement('googleApiKeyInput')) {
            domManager.getElement('googleApiKeyInput').value = settings.google_api_key;
        }
        if (settings.anthropic_api_key && domManager.getElement('anthropicApiKeyInput')) {
            domManager.getElement('anthropicApiKeyInput').value = settings.anthropic_api_key;
        }
        if (settings.max_iterations && domManager.getElement('maxIterations')) {
            domManager.getElement('maxIterations').value = settings.max_iterations;
        }
        if (settings.temperature !== undefined && domManager.getElement('temperature')) {
            domManager.getElement('temperature').value = settings.temperature;
        }
        if (settings.max_tokens && domManager.getElement('maxTokens')) {
            domManager.getElement('maxTokens').value = settings.max_tokens;
        }
        if (settings.max_execution_time && domManager.getElement('maxExecutionTime')) {
            domManager.getElement('maxExecutionTime').value = settings.max_execution_time;
        }
        
        // PIPS interactive mode settings
        if (settings.pips_mode !== undefined) {
            const pipsModeSwitch = domManager.getElement('pipsModeSwitch');
            if (pipsModeSwitch) {
                pipsModeSwitch.checked = settings.pips_mode === 'INTERACTIVE';
                this.updateModeIndicator();
            }
        }
        
        // Model settings - handle both old 'model' field and new separate fields
        if (settings.model && domManager.getElement('generatorModelSelect')) {
            domManager.getElement('generatorModelSelect').value = settings.model;
        }
        if (settings.generator_model && domManager.getElement('generatorModelSelect')) {
            domManager.getElement('generatorModelSelect').value = settings.generator_model;
        }
        if (settings.critic_model && domManager.getElement('criticModelSelect')) {
            domManager.getElement('criticModelSelect').value = settings.critic_model;
        }
        // Handle global rules (persistent across sessions)
        if (settings.global_rules !== undefined && domManager.getElement('customRulesSettings')) {
            domManager.getElement('customRulesSettings').value = settings.global_rules;
        }
        
        // Handle legacy custom_rules field for backward compatibility
        if (settings.custom_rules !== undefined && settings.global_rules === undefined) {
            if (domManager.getElement('customRulesSettings')) {
                domManager.getElement('customRulesSettings').value = settings.custom_rules;
            }
        }
        
        // Per-session rules (navbar) are NOT loaded from storage - they reset with each session
        
        Logger.debug('Settings', 'Settings updated programmatically');
    }

    // Load user-selected settings (e.g., preferred model) from storage and apply them
    loadUserSettingsFromStorage() {
        try {
            const settings = storageManager.loadUserSettings();
            if (settings && Object.keys(settings).length > 0) {
                // Load all settings including PIPS mode
                this.updateSettings(settings);
                Logger.debug('Settings', 'User settings loaded from storage');
            }
        } catch (error) {
            Logger.error('Settings', 'Error loading user settings from storage:', error);
        }
    }

    // Clear per-session rules (called when starting a new session)
    clearPerSessionRules() {
        const navbarElement = domManager.getElement('customRules');
        if (navbarElement) {
            navbarElement.value = '';
            Logger.debug('Settings', 'Per-session custom rules cleared for new session');
        }
    }

    // Get combined rules for sending to backend
    getCombinedRulesForBackend() {
        const globalRules = domManager.getElement('customRulesSettings')?.value?.trim() || '';
        const sessionRules = domManager.getElement('customRules')?.value?.trim() || '';
        
        // Combine global and session rules
        const rules = [];
        if (globalRules) {
            rules.push(`Global Rules:\n${globalRules}`);
        }
        if (sessionRules) {
            rules.push(`Session Rules:\n${sessionRules}`);
        }
        
        const combined = rules.join('\n\n');
        
        Logger.debug('Settings', 'Combined rules for backend:', {
            global: globalRules,
            session: sessionRules,
            combined: combined
        });
        
        return combined;
    }

    // Clear all sessions from the settings panel
    clearAllSessions() {
        console.log('[DEBUG] clearAllSessions method called');
        if (confirm('Are you sure you want to permanently delete ALL session history? This action cannot be undone.')) {
            try {
                console.log('[DEBUG] User confirmed, clearing sessions');
                
                // Clear storage directly
                storageManager.clearAllSessions();
                
                // Clear any current session state if accessible
                if (window.appState) {
                    window.appState.selectedSessionId = null;
                    window.appState.currentSessionData = null;
                }
                
                // Clear UI elements
                const sessionsList = document.getElementById('sessionsList');
                if (sessionsList) {
                    sessionsList.innerHTML = '';
                }
                
                // Clear inputs
                const questionInput = document.getElementById('questionInput');
                if (questionInput) {
                    questionInput.value = '';
                }
                
                // Clear image
                const imagePreview = document.getElementById('imagePreview');
                if (imagePreview) {
                    imagePreview.style.display = 'none';
                    imagePreview.src = '';
                }
                
                // Clear chat area
                const chatArea = document.getElementById('chatArea');
                if (chatArea) {
                    chatArea.innerHTML = `
                        <div class="chat-message">
                            <div class="message-header">
                                <div class="message-avatar avatar-pips">P</div>
                                <span class="message-sender">PIPS System</span>
                            </div>
                            <div class="message-content">
                                Welcome to PIPS! Enter a problem in the left panel and click "Solve Problem" to get started. 
                                Don't forget to configure your model settings first.
                            </div>
                        </div>
                    `;
                }
                
                domManager.updateStatus('All sessions cleared successfully', 'success');
                Logger.debug('Settings', 'All sessions cleared from settings panel');
                console.log('[DEBUG] All sessions cleared successfully');
                
            } catch (error) {
                console.error('[DEBUG] Error clearing sessions:', error);
                Logger.error('Settings', 'Error clearing sessions from settings:', error);
                domManager.updateStatus('Error clearing sessions', 'error');
            }
        } else {
            console.log('[DEBUG] User cancelled session clearing');
        }
    }
}

// Create singleton instance
export const settingsManager = new SettingsManager(); 
