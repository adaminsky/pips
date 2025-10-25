/**
 * DOM Manager - Handles DOM references, basic UI operations, and status management
 */
import { Logger } from '../core/logger.js';

export class DOMManager {
    constructor() {
        this.elements = {};
    }

    setupDOMReferences() {
        // Cache all DOM elements
        this.elements = {
            // Input elements
            questionInput: document.getElementById('questionInput'),
            imageInput: document.getElementById('imageInput'),
            imagePreview: document.getElementById('imagePreview'),
            
            // Button elements
            solveBtn: document.getElementById('solveBtn'),
            interruptBtn: document.getElementById('interruptBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            downloadBtn: document.getElementById('downloadBtn'),
            newSessionBtn: document.getElementById('newSessionBtn'),
            
            // UI elements
            chatArea: document.getElementById('chatArea'),
            statusIndicator: document.getElementById('statusIndicator'),
            progressContainer: document.getElementById('progressContainer'),
            progressFill: document.getElementById('progressFill'),
            sessionInfo: document.getElementById('sessionInfo'),
            
            // Settings modal elements
            settingsModal: document.getElementById('settingsModal'),
            settingsForm: document.getElementById('settingsForm'),
            closeBtn: document.querySelector('.close'),
            
            // Form elements
            modelSelect: document.getElementById('modelSelect'),
            generatorModelSelect: document.getElementById('generatorModelSelect'),
            criticModelSelect: document.getElementById('criticModelSelect'),
            openaiApiKeyInput: document.getElementById('openaiApiKeyInput'),
            googleApiKeyInput: document.getElementById('googleApiKeyInput'),
            anthropicApiKeyInput: document.getElementById('anthropicApiKeyInput'),
            maxIterations: document.getElementById('maxIterations'),
            temperature: document.getElementById('temperature'),
            maxTokens: document.getElementById('maxTokens'),
            maxExecutionTime: document.getElementById('maxExecutionTime'),
            pipsModeSwitch: document.getElementById('pipsModeSwitch'),
            pipsModeAgent: document.getElementById('pipsModeAgent'),
            pipsModeInteractive: document.getElementById('pipsModeInteractive'),
            modeDescription: document.getElementById('modeDescription'),
            customRules: document.getElementById('customRules'),
            customRulesSettings: document.getElementById('customRulesSettings'),
            
            // Session elements
            sessionsToggle: document.getElementById('sessionsToggle'),
            sessionsContainer: document.getElementById('sessionsContainer'),
            sessionsList: document.getElementById('sessionsList'),
            clearSessionsBtn: document.getElementById('clearSessionsBtn'),
            exportSessionsBtn: document.getElementById('exportSessionsBtn'),
            importSessionsBtn: document.getElementById('importSessionsBtn'),
            importSessionsInput: document.getElementById('importSessionsInput'),
            
            // Upload elements
            imageUpload: document.querySelector('.image-upload'),
            imageUploadBtn: document.querySelector('.image-upload-btn')
        };

        // Verify critical elements exist
        const criticalElements = [
            'questionInput', 'solveBtn', 'chatArea', 'statusIndicator'
        ];

        for (const elementName of criticalElements) {
            if (!this.elements[elementName]) {
                Logger.error(`Critical element missing: ${elementName}`);
            }
        }

        Logger.debug('DOM', 'DOM references set up successfully');
    }

    async initializeIcons() {
        try {
            if (typeof feather !== 'undefined') {
                feather.replace();
                Logger.log('Feather icons initialized successfully');
            } else {
                Logger.warn('Feather icons library not found');
            }
        } catch (e) {
            Logger.error('Error initializing Feather icons:', e);
        }
    }

    updateStatus(message, type = 'info') {
        this.elements.statusIndicator.textContent = message;
        this.elements.statusIndicator.className = `status-bar show ${type}`;
        
        // Auto-hide status after 5 seconds unless it's an error
        if (type !== 'error') {
            setTimeout(() => {
                this.elements.statusIndicator.classList.remove('show');
            }, 5000);
        }
    }

    updateSessionInfo(text) {
        this.elements.sessionInfo.textContent = text;
    }

    resetSolvingState() {
        this.elements.solveBtn.style.display = 'inline-flex';
        this.elements.interruptBtn.style.display = 'none';
        this.elements.questionInput.disabled = false;
        this.elements.progressContainer.classList.remove('show');
        this.elements.progressFill.style.width = '0%';
    }

    setSolvingState() {
        this.elements.solveBtn.style.display = 'none';
        this.elements.interruptBtn.style.display = 'inline-flex';
        this.elements.questionInput.disabled = true;
        this.elements.progressContainer.classList.add('show');
    }

    updateProgress(progress) {
        if (progress !== undefined) {
            this.elements.progressFill.style.width = `${progress}%`;
        }
    }

    clearInputs() {
        this.elements.questionInput.value = '';
        this.elements.imagePreview.style.display = 'none';
    }

    getElement(name) {
        return this.elements[name];
    }

    getAllElements() {
        return this.elements;
    }
}

// Create singleton instance
export const domManager = new DOMManager(); 
