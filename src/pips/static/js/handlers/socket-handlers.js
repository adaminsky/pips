/**
 * Socket Event Handlers - Handles all socket event handling logic
 */
import { Logger } from '../core/logger.js';
import { appState } from '../core/state.js';
import { domManager } from '../ui/dom-manager.js';
import { messageManager } from '../ui/message-manager.js';
import { settingsManager } from '../ui/settings-manager.js';
import { sessionManager } from '../ui/session-manager.js';

export class SocketEventHandlers {
    constructor() {
        this.timeoutHandlers = {
            solvingTimeoutId: null,
            connectionTimeoutId: null
        };
    }

    // Get all event handlers for registration with socket manager
    getEventHandlers() {
        return {
            'session_connected': (data) => this.handleSessionConnected(data),
            'settings_updated': (data) => this.handleSettingsUpdated(data),
            'solving_started': (data) => this.handleSolvingStarted(data),
            'step_update': (data) => this.handleStepUpdate(data),
            'solving_complete': (data) => this.handleSolvingComplete(data),
            'solving_interrupted': (data) => this.handleSolvingInterrupted(data),
            'solving_error': (data) => this.handleSolvingError(data),
            'ai_response': (data) => this.handleAIResponse(data),
            'error': (data) => this.handleError(data),
            
            // Streaming event handlers - CRITICAL FOR CHAT FUNCTIONALITY
            'llm_streaming_start': (data) => this.handleLLMStreamingStart(data),
            'llm_streaming_token': (data) => this.handleLLMStreamingToken(data),
            'llm_streaming_end': (data) => this.handleLLMStreamingEnd(data),
            'llm_response': (data) => this.handleLLMResponse(data),
            
            // Code execution handlers
            'code_execution_start': (data) => this.handleCodeExecutionStart(data),
            'code_execution_end': (data) => this.handleCodeExecutionEnd(data),
            'code_execution': (data) => this.handleCodeExecution(data),
            
            // Code review streaming handlers
            'code_check_streaming_start': (data) => this.handleCodeCheckStreamingStart(data),
            'code_check_streaming_token': (data) => this.handleCodeCheckStreamingToken(data),
            'code_check_streaming_end': (data) => this.handleCodeCheckStreamingEnd(data),
            
            // Interactive mode handlers
            'awaiting_user_feedback': (data) => this.handleAwaitingUserFeedback(data),
            'final_artifacts': (data) => this.handleFinalArtifacts(data),
            
            // Heartbeat handler
            'heartbeat_response': (data) => this.handleHeartbeatResponse(data)
        };
    }

    // Custom socket connection handlers
    getConnectionHandlers() {
        return {
            'connected': () => this.handleSocketConnected(),
            'disconnected': ({ reason }) => this.handleSocketDisconnected(reason),
            'connectionError': ({ error }) => this.handleConnectionError(error),
            'ioError': ({ error }) => this.handleIOError(error)
        };
    }

    // Socket connection event handlers
    handleSocketConnected() {
        console.log('[DEBUG] handleSocketConnected called');
        
        // Only show "Connecting..." if we don't already have a session ID
        if (!appState.currentSessionId) {
            console.log('[DEBUG] No session ID yet, showing Connecting...');
            domManager.updateSessionInfo('Connecting...');
        } else {
            console.log('[DEBUG] Already have session ID:', appState.currentSessionId);
        }
        
        // Fallback safety-net: re-request session info if still unknown after 1s
        setTimeout(() => {
            if (!appState.currentSessionId) {
                console.log('[DEBUG] Session ID still unknown after 1s, requesting session info');
                Logger.debug('Socket Event', 'Session ID still unknown after 1s, requesting session info');
                // Import socketManager here to avoid circular dependency
                import('../network/socket.js').then(({ socketManager }) => {
                    socketManager.send('request_session_info');
                });
            }
        }, 1000);
    }

    handleSocketDisconnected(reason) {
        domManager.updateSessionInfo('Session: Not connected');
        domManager.updateStatus('Disconnected from server', 'error');
        
        // Reset solving state if we were solving
        if (appState.isSolving) {
            this.resetSolvingState();
            messageManager.addMessage('PIPS System', 'Connection lost during solving. Please try again.', null);
        }
    }

    handleConnectionError(error) {
        domManager.updateStatus('Connection error. Retrying...', 'error');
    }

    handleIOError(error) {
        domManager.updateStatus('Socket.IO error occurred', 'error');
    }

    // Main socket event handlers
    handleSessionConnected(data) {
        console.log('[DEBUG] handleSessionConnected called with data:', data);
        Logger.debug('Socket Event', 'Session connected:', data);
        sessionManager.handleSessionConnected(data);
        
        // Load saved API keys and send to server
        settingsManager.initializeServerSettings();
    }

    handleSettingsUpdated(data) {
        Logger.debug('Socket Event', 'Settings updated:', data);
        settingsManager.handleSettingsUpdated(data);
    }

    handleSolvingStarted(data) {
        Logger.debug('Socket Event', 'Solving started:', data);
        appState.setSolving(true);
        appState.setIteration(0);
        
        domManager.setSolvingState();
        domManager.updateStatus(data.message, 'info');
        this.setSolvingTimeout();

        // Clear any existing feedback panels from previous sessions
        if (window.interactiveFeedback) {
            window.interactiveFeedback.removeFeedbackPanel();
            window.interactiveFeedback.removeRestoreButton();
        }

        // Update session management
        sessionManager.handleSolvingStarted();
    }

    handleStepUpdate(data) {
        Logger.debug('Socket Event', 'Step update:', data);
        
        appState.setIteration(data.iteration || 0);
        domManager.updateStatus(data.message, 'info');
        domManager.updateProgress(data.progress);
        
        // Show step message with improved messaging
        let displayMessage = data.message;
        
        // Improve messaging for specific steps
        if (data.step === 'code_checking') {
            displayMessage = `Analyzing code quality (iteration ${data.iteration})...`;
        } else if (data.step === 'code_refinement') {
            displayMessage = `Refining solution (iteration ${data.iteration})...`;
        } else if (data.step === 'interrupted') {
            displayMessage = '⏹️ PIPS was interrupted by the user.';
        } else if (data.step === 'finished') {
            displayMessage = '🎉 Solution completed successfully!';
        }
        
        messageManager.addMessage('PIPS', displayMessage, data.iteration, data.prompt_details);
        this.resetSolvingTimeout();
    }

    handleSolvingComplete(data) {
        Logger.debug('Socket Event', 'Solving complete:', data);
        
        this.clearSolvingTimeout();
        this.resetSolvingState();
        
        // Clean up any interactive feedback UI
        if (window.interactiveFeedback) {
            window.interactiveFeedback.removeFeedbackPanel();
            window.interactiveFeedback.removeRestoreButton();
        }
        
        // Display final answer
        if (data.final_answer) {
            messageManager.displayFinalAnswer(data.final_answer);
        }
        
        domManager.updateStatus('Problem solving completed successfully!', 'success');

        // Update session management
        sessionManager.handleSolvingComplete();
    }

    handleSolvingInterrupted(data) {
        Logger.debug('Socket Event', 'Solving interrupted:', data);
        
        this.clearSolvingTimeout();
        this.resetSolvingState();
        
        // Clean up any interactive feedback UI
        if (window.interactiveFeedback) {
            window.interactiveFeedback.removeFeedbackPanel();
            window.interactiveFeedback.removeRestoreButton();
        }
        
        domManager.updateStatus(data.message || 'Problem solving interrupted', 'warning');

        // Update session management
        sessionManager.handleSolvingInterrupted();
    }

    handleSolvingError(data) {
        Logger.error('Socket Event', 'Solving error:', data);
        domManager.updateStatus(`Error: ${data.error}`, 'error');
        
        this.clearSolvingTimeout();
        this.resetSolvingState();
        
        // Clean up any interactive feedback UI
        if (window.interactiveFeedback) {
            window.interactiveFeedback.removeFeedbackPanel();
            window.interactiveFeedback.removeRestoreButton();
        }
        
        messageManager.addMessage('PIPS System', `Error: ${data.error}`, null);
        
        // Update session management - clean up and save session
        sessionManager.handleSolvingError();
    }

    handleAIResponse(data) {
        Logger.debug('Socket Event', 'AI response:', data);
        messageManager.addMessage(data.sender || 'AI Assistant', data.content, data.iteration);
        domManager.updateProgress(data.progress);
    }

    handleError(data) {
        Logger.error('Socket Event', 'Socket error:', data);
        domManager.updateStatus(`Error: ${data.message}`, 'error');
        
        if (appState.isSolving) {
            this.clearSolvingTimeout();
            this.resetSolvingState();
            
            // Clean up any interactive feedback UI
            if (window.interactiveFeedback) {
                window.interactiveFeedback.removeFeedbackPanel();
                window.interactiveFeedback.removeRestoreButton();
            }
            
            // Clean up session state and save messages when socket errors occur
            sessionManager.handleSolvingError();
        }
    }

    // STREAMING EVENT HANDLERS - CRITICAL FOR CHAT FUNCTIONALITY
    handleLLMStreamingStart(data) {
        Logger.debug('Socket Event', 'LLM streaming started:', data);
        messageManager.showAIThinkingIndicator(data.iteration, 'AI Assistant', data.model_name);
    }

    handleLLMStreamingToken(data) {
        Logger.debug('Socket Event', 'LLM streaming token received:', data.token);
        messageManager.updateStreamingMessage(data.token, data.iteration, 'AI Assistant', data.model_name);
    }

    handleLLMStreamingEnd(data) {
        Logger.debug('Socket Event', 'LLM streaming ended:', data);
        messageManager.removeAIThinkingIndicator(data.iteration, 'AI Assistant');
        messageManager.finalizeStreamingMessage(data.iteration, 'AI Assistant');
    }

    handleLLMResponse(data) {
        Logger.debug('Socket Event', 'LLM response (fallback):', data);
        // Fallback for non-streaming responses
        messageManager.removeAIThinkingIndicator(data.iteration);
        messageManager.addMessage('AI Assistant', data.response, data.iteration);
    }

    // CODE EXECUTION HANDLERS
    handleCodeExecutionStart(data) {
        Logger.debug('Socket Event', 'Code execution started:', data);
        messageManager.showExecutionSpinner(data.iteration);
    }

    handleCodeExecutionEnd(data) {
        Logger.debug('Socket Event', 'Code execution ended:', data);
        messageManager.removeExecutionSpinner(data.iteration);
    }

    handleCodeExecution(data) {
        Logger.debug('Socket Event', 'Code execution result:', data);
        messageManager.removeExecutionSpinner(data.iteration);
        
        let resultText = '';
        if (data.error && data.error.trim() !== '') {
            resultText = `Error: ${data.error}`;
            messageManager.displayExecutionResult(resultText, data.iteration, true);
        } else {
            if (data.stdout && data.stdout.trim() !== '') {
                resultText += `Output: ${data.stdout}\n`;
            }
            if (data.output && data.output.trim() !== '' && data.output !== 'None') {
                resultText += `Result: ${data.output}`;
            }
            if (resultText.trim() === '') {
                resultText = 'Code executed successfully (no output)';
            }
            messageManager.displayExecutionResult(resultText, data.iteration, false);
        }
    }

    // CODE REVIEW STREAMING HANDLERS
    handleCodeCheckStreamingStart(data) {
        Logger.debug('Socket Event', 'Code reviewer streaming started:', data);
        messageManager.showAIThinkingIndicator(data.iteration, 'AI Code Reviewer', data.model_name);
    }

    handleCodeCheckStreamingToken(data) {
        Logger.debug('Socket Event', 'Code reviewer streaming token received:', data.token);
        messageManager.updateStreamingMessage(data.token, data.iteration, 'AI Code Reviewer', data.model_name);
    }

    handleCodeCheckStreamingEnd(data) {
        Logger.debug('Socket Event', 'Code reviewer streaming ended:', data);
        messageManager.removeAIThinkingIndicator(data.iteration, 'AI Code Reviewer');
        messageManager.finalizeStreamingMessage(data.iteration, 'AI Code Reviewer');
    }

    // Interactive mode handlers
    handleAwaitingUserFeedback(data) {
        Logger.debug('Socket Event', 'Awaiting user feedback:', data);
        
        // Pause solving state to allow user interaction
        appState.setUserFeedback(true);
        domManager.updateStatus('Waiting for your feedback...', 'info');
        
        // Show the interactive feedback panel
        if (window.interactiveFeedback) {
            window.interactiveFeedback.showFeedbackPanel(data);
        } else {
            // Fallback: show basic feedback interface
            this.showBasicFeedbackInterface(data);
        }
    }

    handleFinalArtifacts(data) {
        Logger.debug('Socket Event', 'Final artifacts:', data);
        
        // Show final artifacts in the UI
        if (window.interactiveFeedback) {
            window.interactiveFeedback.showFinalArtifacts(data);
        } else {
            // Fallback: show in message
            messageManager.addMessage('PIPS System', 'Final solution artifacts are ready.', null);
        }
    }
    
    showBasicFeedbackInterface(data) {
        // Basic feedback interface if the interactive-feedback module isn't available
        const feedbackHtml = `
            <div class="basic-feedback-panel">
                <h4>Interactive Feedback Required</h4>
                <p>AI Critic: ${data.critic_text || 'No critic feedback available'}</p>
                <div class="feedback-buttons">
                    <button onclick="window.provideFeedback(true, '')">Accept & Continue</button>
                    <button onclick="window.provideFeedback(false, '')">Reject & Continue</button>
                    <button onclick="window.terminateSession()">Finish Here</button>
                </div>
            </div>
        `;
        
        // Add to chat
        messageManager.addMessage('PIPS Interactive', feedbackHtml, data.iteration || null);
        
        // Set up global feedback functions
        window.provideFeedback = (acceptCritic, comments) => {
            import('../network/socket.js').then(({ socketManager }) => {
                socketManager.send('provide_feedback', {
                    accept_critic: acceptCritic,
                    extra_comments: comments,
                    quoted_ranges: [],
                    terminate: false
                });
            });
        };
        
        window.terminateSession = () => {
            import('../network/socket.js').then(({ socketManager }) => {
                socketManager.send('provide_feedback', {
                    accept_critic: true,
                    extra_comments: '',
                    quoted_ranges: [],
                    terminate: true
                });
            });
        };
    }

    // HEARTBEAT HANDLER
    handleHeartbeatResponse(data) {
        Logger.debug('Socket Event', 'Heartbeat response received');
        appState.updateLastHeartbeat();
    }

    // Timeout management methods
    setSolvingTimeout() {
        appState.setSolvingTimeout(setTimeout(() => {
            Logger.error('SocketHandlers', 'Solving timeout detected - server may be unresponsive');
            domManager.updateStatus('Server timeout detected. The server may be unresponsive. Try refreshing the page.', 'error');
            this.resetSolvingState();
            
            // Clean up any interactive feedback UI
            if (window.interactiveFeedback) {
                window.interactiveFeedback.removeFeedbackPanel();
                window.interactiveFeedback.removeRestoreButton();
            }
            
            messageManager.addMessage('PIPS System', 'Operation timed out. The server may be experiencing issues. Please try again or contact support if the problem persists.', null);
            
            // Clean up session state and save messages when timeout occurs
            sessionManager.handleSolvingError();
        }, appState.SOLVING_TIMEOUT_MS));
    }

    clearSolvingTimeout() {
        appState.clearSolvingTimeout();
    }

    resetSolvingTimeout() {
        this.clearSolvingTimeout();
        this.setSolvingTimeout();
    }

    resetSolvingState() {
        appState.setSolving(false);
        appState.setIteration(0);
        domManager.resetSolvingState();
    }
}

// Create singleton instance
export const socketEventHandlers = new SocketEventHandlers(); 