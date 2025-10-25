/**
 * Message Manager - Handles chat messages, streaming, and code execution display
 */
import { Logger } from '../core/logger.js';
import { domManager } from './dom-manager.js';

export class MessageManager {
    constructor() {
        this.streamingMessages = new Map();
        this.executionSpinners = new Map();
    }

    addMessage(sender, content, iteration = null, promptDetails = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        if (promptDetails) {
            messageDiv.classList.add('expandable-message');
        }
        
        const avatarClass = sender === 'PIPS' || sender === 'PIPS System' ? 'avatar-pips' : 
                          sender === 'AI Code Reviewer' ? 'avatar-reviewer' :
                          sender.includes('AI') ? 'avatar-llm' : 'avatar-system';
        const avatarLetter = sender === 'PIPS' || sender === 'PIPS System' ? 'P' : 
                           sender === 'AI Code Reviewer' ? 'QA' :
                           sender.includes('AI') ? 'AI' : 'S';
        
        const iterationBadge = iteration ? 
            `<span class="iteration-badge">Iteration ${iteration}</span>` : '';
        
        // Create expand toggle if prompt details are available
        const expandToggle = promptDetails ? `
            <button class="expand-toggle" onclick="window.pipsApp.toggleExpandMessage(this)">
                <i data-feather="chevron-down" style="width: 12px; height: 12px;"></i>
                Show Prompt
            </button>
        ` : '';
        
        // Create expandable content if prompt details are available
        const expandableContent = promptDetails ? `
            <div class="expandable-content">
                <div class="expandable-content-inner">
                    ${promptDetails.description ? `<div class="prompt-description">${this.escapeHtml(promptDetails.description)}</div>` : ''}
                    <div class="prompt-conversation">
                        ${promptDetails.conversation.map(msg => {
                            // Format content based on its structure
                            let formattedContent = '';
                            if (typeof msg.content === 'string') {
                                // Check if content looks like structured data or contains code blocks
                                if (msg.content.includes('```') || msg.content.includes('{') || msg.content.includes('[')) {
                                    // Use markdown parsing for structured content
                                    formattedContent = marked ? marked.parse(msg.content) : msg.content.replace(/\n/g, '<br>');
                                } else {
                                    // Escape HTML but preserve line breaks for simple text
                                    formattedContent = this.escapeHtml(msg.content).replace(/\n/g, '<br>');
                                }
                            } else if (Array.isArray(msg.content)) {
                                // Handle multimodal content (like image + text)
                                formattedContent = msg.content.map(item => {
                                    if (item.type === 'text') {
                                        return this.escapeHtml(item.text).replace(/\n/g, '<br>');
                                    } else if (item.type === 'image_url') {
                                        return '<div class="prompt-image">[Image content]</div>';
                                    }
                                    return this.escapeHtml(JSON.stringify(item));
                                }).join('');
                            } else {
                                // Fallback for other content types
                                formattedContent = this.escapeHtml(JSON.stringify(msg.content, null, 2)).replace(/\n/g, '<br>');
                            }
                            
                            return `
                                <div class="prompt-message ${msg.role}">
                                    <div class="prompt-role">${msg.role}</div>
                                    <div class="prompt-content">${formattedContent}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        ` : '';
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar ${avatarClass}">${avatarLetter}</div>
                <span class="message-sender">${this.escapeHtml(sender)}</span>
                ${iterationBadge}
            </div>
            <div class="message-content">
                ${marked ? marked.parse(content) : content}
                ${expandToggle}
                ${expandableContent}
            </div>
        `;
        
        domManager.getElement('chatArea').appendChild(messageDiv);
        
        // Re-highlight code blocks
        if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
        }
        
        // Replace feather icons for the new expand toggle
        if (promptDetails) {
            feather.replace(messageDiv);
        }
        
        this.smartScrollToBottom();
        
        // Save message incrementally during solving
        this.saveMessageIncremental(sender, content, iteration, promptDetails);
    }

    displayFinalAnswer(answer) {
        Logger.debug('MessageManager', 'displayFinalAnswer called with:', answer);
        
        if (!answer || answer.trim() === '') {
            Logger.warn('MessageManager', 'Empty or null final answer provided');
            return;
        }
        
        // Remove any existing final answer elements to avoid duplicates
        const existingAnswers = domManager.getElement('chatArea').querySelectorAll('.final-answer');
        existingAnswers.forEach(el => el.remove());
        
        const answerDiv = document.createElement('div');
        answerDiv.className = 'final-answer';
        
        if (typeof answer === 'string') {
            if (answer.includes('<') && answer.includes('>')) {
                answerDiv.innerHTML = answer;
            } else {
                answerDiv.textContent = answer;
            }
        } else {
            answerDiv.textContent = String(answer);
        }
        
        domManager.getElement('chatArea').appendChild(answerDiv);
        
        setTimeout(() => {
            this.smartScrollToBottom();
        }, 100);
    }

    smartScrollToBottom() {
        const chatArea = domManager.getElement('chatArea');
        const threshold = 100;
        const shouldAutoScroll = (chatArea.scrollTop + chatArea.clientHeight >= 
                                chatArea.scrollHeight - threshold);
        
        if (shouldAutoScroll) {
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // STREAMING MESSAGE METHODS
    showAIThinkingIndicator(iteration, senderName = 'AI Assistant') {
        // Remove any existing thinking indicator for this iteration and sender
        this.removeAIThinkingIndicator(iteration, senderName);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message ai-thinking';
        messageDiv.setAttribute('data-iteration', iteration);
        messageDiv.setAttribute('data-sender', senderName);
        
        // Determine avatar based on sender
        let avatarClass, avatarLetter, thinkingText;
        if (senderName === 'AI Code Reviewer') {
            avatarClass = 'avatar-reviewer';
            avatarLetter = 'QA';
            thinkingText = 'Code reviewer is analyzing...';
        } else {
            avatarClass = 'avatar-llm';
            avatarLetter = 'AI';
            thinkingText = 'AI is thinking...';
        }
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar ${avatarClass}">${avatarLetter}</div>
                <span class="message-sender">${senderName}</span>
                ${iteration ? `<span class="iteration-badge">Iteration ${iteration}</span>` : ''}
            </div>
            <div class="message-content">
                <div class="streaming-indicator">
                    <div class="spinner"></div>
                    <span>${thinkingText}</span>
                </div>
            </div>
        `;
        
        domManager.getElement('chatArea').appendChild(messageDiv);
        this.smartScrollToBottom();
    }

    removeAIThinkingIndicator(iteration, senderName = null) {
        const thinkingElements = domManager.getElement('chatArea').querySelectorAll('.ai-thinking');
        thinkingElements.forEach(el => {
            const matchesIteration = !iteration || el.getAttribute('data-iteration') == iteration;
            const matchesSender = !senderName || el.getAttribute('data-sender') === senderName;
            
            if (matchesIteration && matchesSender) {
                el.remove();
            }
        });
    }

    updateStreamingMessage(token, iteration, sender) {
        // Create a unique identifier for this streaming message based on iteration and sender
        const streamingId = `${iteration}-${sender}`;
        
        // Find or create streaming message
        let streamingMessage = domManager.getElement('chatArea').querySelector(`[data-streaming-id="${streamingId}"]`);
        
        if (!streamingMessage) {
            // Remove thinking indicator if present for this specific sender
            this.removeAIThinkingIndicator(iteration, sender);
            
            // Create new streaming message
            streamingMessage = document.createElement('div');
            streamingMessage.className = 'chat-message streaming-message';
            streamingMessage.setAttribute('data-streaming-iteration', iteration);
            streamingMessage.setAttribute('data-streaming-id', streamingId);
            streamingMessage.setAttribute('data-sender', sender);
            
            // Determine avatar based on sender
            let avatarClass, avatarLetter;
            if (sender === 'AI Code Reviewer') {
                avatarClass = 'avatar-reviewer';
                avatarLetter = 'QA';
            } else {
                avatarClass = 'avatar-llm';
                avatarLetter = 'AI';
            }
            
            streamingMessage.innerHTML = `
                <div class="message-header">
                    <div class="message-avatar ${avatarClass}">${avatarLetter}</div>
                    <span class="message-sender">${sender}</span>
                    ${iteration ? `<span class="iteration-badge">Iteration ${iteration}</span>` : ''}
                </div>
                <div class="message-content">
                    <div class="streaming-text" data-content=""></div>
                </div>
            `;
            
            domManager.getElement('chatArea').appendChild(streamingMessage);
        }
        
        // Update streaming content
        const streamingText = streamingMessage.querySelector('.streaming-text');
        const currentContent = streamingText.getAttribute('data-content') || '';
        const newContent = currentContent + token;
        streamingText.setAttribute('data-content', newContent);
        
        // Remove any existing typing indicators first
        const existingIndicators = streamingText.querySelectorAll('.typing-indicator');
        existingIndicators.forEach(indicator => indicator.remove());
        
        // Parse markdown if available
        if (typeof marked !== 'undefined') {
            streamingText.innerHTML = marked.parse(newContent);
        } else {
            streamingText.textContent = newContent;
        }
        
        // Add typing indicator at the very end of the content
        const typingIndicator = document.createElement('span');
        typingIndicator.className = 'typing-indicator';
        
        // Find the last element in the streaming text and append the cursor inline
        const lastElement = streamingText.lastElementChild;
        if (lastElement && (lastElement.tagName === 'P' || lastElement.tagName === 'DIV' || lastElement.tagName === 'SPAN')) {
            // Append to the last paragraph/div/span element to keep it inline
            lastElement.appendChild(typingIndicator);
        } else {
            // If no suitable element found, append directly to streaming text
            streamingText.appendChild(typingIndicator);
        }
        
        this.smartScrollToBottom();
    }

    finalizeStreamingMessage(iteration, sender = null) {
        // If sender is specified, find the specific streaming message for that sender
        // Otherwise, finalize all streaming messages for the iteration (backward compatibility)
        let query;
        if (sender) {
            const streamingId = `${iteration}-${sender}`;
            query = `[data-streaming-id="${streamingId}"]`;
        } else {
            query = `[data-streaming-iteration="${iteration}"]`;
        }
        
        const streamingMessages = domManager.getElement('chatArea').querySelectorAll(query);
        streamingMessages.forEach(streamingMessage => {
            // Remove typing indicator
            const typingIndicator = streamingMessage.querySelector('.typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
            
            // Remove streaming attributes
            streamingMessage.classList.remove('streaming-message');
            streamingMessage.removeAttribute('data-streaming-iteration');
            streamingMessage.removeAttribute('data-streaming-id');
            
            // Re-highlight code blocks
            if (typeof Prism !== 'undefined') {
                Prism.highlightAll();
            }
        });
    }

    // CODE EXECUTION METHODS
    showExecutionSpinner(iteration) {
        // Remove any existing execution spinner for this iteration
        this.removeExecutionSpinner(iteration);
        
        const spinnerDiv = document.createElement('div');
        spinnerDiv.className = 'execution-spinner';
        spinnerDiv.setAttribute('data-execution-iteration', iteration);
        spinnerDiv.innerHTML = `
            <div class="spinner"></div>
            <span>Executing code...</span>
        `;
        
        domManager.getElement('chatArea').appendChild(spinnerDiv);
        this.smartScrollToBottom();
    }

    removeExecutionSpinner(iteration) {
        const spinners = domManager.getElement('chatArea').querySelectorAll('.execution-spinner');
        spinners.forEach(spinner => {
            if (!iteration || spinner.getAttribute('data-execution-iteration') == iteration) {
                spinner.remove();
            }
        });
    }

    displayExecutionResult(result, iteration, isError = false) {
        const resultDiv = document.createElement('div');
        resultDiv.className = `execution-result ${isError ? 'error' : ''}`;
        resultDiv.textContent = result;
        
        domManager.getElement('chatArea').appendChild(resultDiv);
        this.smartScrollToBottom();
    }

    displayCode(code, iteration) {
        const codeDiv = document.createElement('div');
        codeDiv.className = 'code-block';
        codeDiv.innerHTML = `<pre><code class="language-python">${this.escapeHtml(code)}</code></pre>`;
        
        domManager.getElement('chatArea').appendChild(codeDiv);
        
        if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
        }
        
        this.smartScrollToBottom();
    }

    toggleExpandMessage(button) {
        const expandToggle = button;
        const messageContent = button.closest('.message-content');
        const expandableContent = messageContent.querySelector('.expandable-content');
        
        if (!expandableContent) return;
        
        const isExpanded = expandableContent.classList.contains('expanded');
        
        if (isExpanded) {
            expandableContent.classList.remove('expanded');
            expandToggle.classList.remove('expanded');
            expandToggle.innerHTML = `
                <i data-feather="chevron-down" style="width: 12px; height: 12px;"></i>
                Show Prompt
            `;
        } else {
            expandableContent.classList.add('expanded');
            expandToggle.classList.add('expanded');
            expandToggle.innerHTML = `
                <i data-feather="chevron-up" style="width: 12px; height: 12px;"></i>
                Hide Prompt
            `;
        }
        
        // Replace feather icons
        feather.replace(expandToggle);
        
        // Scroll to keep the message in view if needed
        setTimeout(() => {
            if (!isExpanded) {
                this.smartScrollToBottom();
            }
        }, 300);
    }

    downloadChat() {
        const chatContent = domManager.getElement('chatArea').innerHTML;
        const blob = new Blob([`
            <!DOCTYPE html>
            <html>
            <head>
                <title>PIPS Chat Export</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .chat-message { margin-bottom: 20px; }
                    .message-header { font-weight: bold; margin-bottom: 5px; }
                    .message-content { margin-left: 20px; }
                </style>
            </head>
            <body>
                <h1>PIPS Chat Export</h1>
                <div class="chat-area">${chatContent}</div>
            </body>
            </html>
        `], { type: 'text/html' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pips_chat_${new Date().toISOString().split('T')[0]}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // SESSION MANAGEMENT METHODS
    getCurrentChatHistory() {
        const chatArea = domManager.getElement('chatArea');
        if (!chatArea) {
            Logger.warn('MessageManager', 'Chat area not found');
            return [];
        }
        
        const messages = chatArea.querySelectorAll('.chat-message');
        const history = [];
        
        messages.forEach(message => {
            const senderElement = message.querySelector('.message-sender');
            const contentElement = message.querySelector('.message-content');
            const iterationElement = message.querySelector('.iteration-badge');
            
            if (!senderElement || !contentElement) {
                Logger.debug('MessageManager', 'Skipping malformed message');
                return; // Skip malformed messages
            }
            
            const sender = senderElement.textContent || 'Unknown';
            let content = '';
            
            // Get content - extract only the main content, excluding expandable elements
            let contentToSave = '';
            const contentChildren = Array.from(contentElement.children);
            
            // Look for the main content, excluding expand toggles and expandable content
            contentChildren.forEach(child => {
                if (!child.classList.contains('expand-toggle') && 
                    !child.classList.contains('expandable-content')) {
                    contentToSave += child.outerHTML;
                }
            });
            
            // If no child elements found, get direct text content
            if (!contentToSave) {
                // Get text nodes directly, excluding expand button text
                const clonedContent = contentElement.cloneNode(true);
                const expandToggle = clonedContent.querySelector('.expand-toggle');
                const expandableContent = clonedContent.querySelector('.expandable-content');
                if (expandToggle) expandToggle.remove();
                if (expandableContent) expandableContent.remove();
                contentToSave = clonedContent.innerHTML.trim() || clonedContent.textContent.trim();
            }
            
            content = contentToSave;
            
            const iteration = iterationElement ? iterationElement.textContent : null;
            
            // Skip the welcome message
            if (sender === 'PIPS System' && content.includes('Welcome to PIPS')) {
                return;
            }
            
            // Skip empty messages but be more specific about what to filter
            if (!content || content === '') {
                Logger.debug('MessageManager', 'Skipping empty message');
                return;
            }
            
            // Skip only currently active streaming indicators (not completed messages that might have streaming classes)
            if (message.classList.contains('ai-thinking') || 
                message.classList.contains('streaming-message') ||
                content.includes('AI is thinking...') ||
                content.includes('Executing code...')) {
                Logger.debug('MessageManager', 'Skipping active streaming indicator');
                return;
            }
            
            // Check if this message has prompt details
            const expandableContent = message.querySelector('.expandable-content');
            let promptDetails = null;
            
            if (expandableContent) {
                // Extract prompt details from the DOM
                const promptDescription = expandableContent.querySelector('.prompt-description');
                const promptMessages = expandableContent.querySelectorAll('.prompt-message');
                
                if (promptMessages.length > 0) {
                    promptDetails = {
                        description: promptDescription ? promptDescription.textContent : '',
                        conversation: Array.from(promptMessages).map(promptMsg => ({
                            role: promptMsg.querySelector('.prompt-role').textContent.toLowerCase(),
                            content: promptMsg.querySelector('.prompt-content').textContent
                        }))
                    };
                }
            }
            
            history.push({
                sender,
                content,
                iteration,
                promptDetails,
                timestamp: new Date().toISOString()
            });
        });
        
        Logger.debug('MessageManager', `Extracted ${history.length} messages from chat`);
        return history;
    }

    loadChatHistory(history) {
        const chatArea = domManager.getElement('chatArea');
        
        // Find and preserve the welcome message first
        let welcomeMessage = null;
        const existingMessages = chatArea.querySelectorAll('.chat-message');
        existingMessages.forEach(msg => {
            const sender = msg.querySelector('.message-sender');
            const content = msg.querySelector('.message-content');
            if (sender && content && 
                sender.textContent === 'PIPS System' && 
                content.textContent.includes('Welcome to PIPS')) {
                welcomeMessage = msg.cloneNode(true);
            }
        });
        
        // Clear existing messages
        chatArea.innerHTML = '';
        
        // Restore welcome message if it existed
        if (welcomeMessage) {
            chatArea.appendChild(welcomeMessage);
        }
        
        // Load messages from history
        if (history && history.length > 0) {
            Logger.debug('MessageManager', `Loading ${history.length} messages from history`);
            
            history.forEach((msg, index) => {
                if (!msg || !msg.sender || !msg.content) {
                    Logger.warn('MessageManager', `Skipping invalid message at index ${index}:`, msg);
                    return;
                }
                
                const messageDiv = document.createElement('div');
                messageDiv.className = 'chat-message';
                
                const avatarClass = msg.sender === 'PIPS' || msg.sender === 'PIPS System' ? 'avatar-pips' : 
                                  msg.sender === 'AI Code Reviewer' ? 'avatar-reviewer' :
                                  msg.sender.includes('AI') ? 'avatar-llm' : 'avatar-system';
                const avatarLetter = msg.sender === 'PIPS' || msg.sender === 'PIPS System' ? 'P' : 
                                   msg.sender === 'AI Code Reviewer' ? 'QA' :
                                   msg.sender.includes('AI') ? 'AI' : 'S';
                
                const iterationBadge = msg.iteration ? 
                    `<span class="iteration-badge">${this.escapeHtml(msg.iteration)}</span>` : '';
                
                // Handle expandable content for loaded messages
                const expandToggle = msg.promptDetails ? `
                    <button class="expand-toggle" onclick="window.pipsApp.toggleExpandMessage(this)">
                        <i data-feather="chevron-down" style="width: 12px; height: 12px;"></i>
                        Show Prompt
                    </button>
                ` : '';
                
                const expandableContent = msg.promptDetails ? `
                    <div class="expandable-content">
                        <div class="expandable-content-inner">
                            ${msg.promptDetails.description ? `<div class="prompt-description">${this.escapeHtml(msg.promptDetails.description)}</div>` : ''}
                            <div class="prompt-conversation">
                                ${msg.promptDetails.conversation.map(promptMsg => `
                                    <div class="prompt-message ${promptMsg.role}">
                                        <div class="prompt-role">${promptMsg.role}</div>
                                        <div class="prompt-content">${this.escapeHtml(promptMsg.content)}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                ` : '';
                
                if (msg.promptDetails) {
                    messageDiv.classList.add('expandable-message');
                }
                
                messageDiv.innerHTML = `
                    <div class="message-header">
                        <div class="message-avatar ${avatarClass}">${avatarLetter}</div>
                        <span class="message-sender">${this.escapeHtml(msg.sender)}</span>
                        ${iterationBadge}
                    </div>
                    <div class="message-content">
                        ${msg.content}
                        ${expandToggle}
                        ${expandableContent}
                    </div>
                `;
                
                chatArea.appendChild(messageDiv);
            });
            
            // Replace feather icons for any expandable messages
            if (typeof feather !== 'undefined') {
                feather.replace(chatArea);
            }
        } else {
            Logger.debug('MessageManager', 'No chat history to load');
        }
        
        // Re-highlight code blocks
        if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
        }
        
        this.smartScrollToBottom();
    }

    clearChatAndRestoreWelcome() {
        const chatArea = domManager.getElement('chatArea');
        chatArea.innerHTML = '';
        
        // Add fresh welcome message
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'chat-message';
        welcomeDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar avatar-pips">P</div>
                <span class="message-sender">PIPS System</span>
            </div>
            <div class="message-content">
                Welcome to PIPS! Enter a problem in the left panel and click "Solve Problem" to get started. 
                Don't forget to configure your model settings first.
            </div>
        `;
        chatArea.appendChild(welcomeDiv);
    }

    // CLEANUP METHODS - for handling session interruptions and failures
    cleanupAllActiveIndicators() {
        Logger.debug('MessageManager', 'Cleaning up all active indicators');
        
        // Remove all AI thinking indicators
        const thinkingElements = domManager.getElement('chatArea').querySelectorAll('.ai-thinking');
        thinkingElements.forEach(el => el.remove());
        
        // Remove all execution spinners
        const executionSpinners = domManager.getElement('chatArea').querySelectorAll('.execution-spinner');
        executionSpinners.forEach(el => el.remove());
        
        // Finalize all streaming messages
        const streamingMessages = domManager.getElement('chatArea').querySelectorAll('.streaming-message');
        streamingMessages.forEach(streamingMessage => {
            // Remove typing indicator
            const typingIndicator = streamingMessage.querySelector('.typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
            
            // Remove streaming attributes
            streamingMessage.classList.remove('streaming-message');
            streamingMessage.removeAttribute('data-streaming-iteration');
            streamingMessage.removeAttribute('data-streaming-id');
        });
        
        // Re-highlight code blocks after cleanup
        if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
        }
        
        Logger.debug('MessageManager', 'All active indicators cleaned up');
    }

    // For incremental saving during solving - save messages as they come in
    saveMessageIncremental(sender, content, iteration = null, promptDetails = null) {
        // This is called after each message is added to save it incrementally
        // Import sessionManager to avoid circular dependency
        import('./session-manager.js').then(({ sessionManager }) => {
            if (window.appState && window.appState.currentSessionData) {
                // Update chat history with current messages
                window.appState.currentSessionData.chatHistory = this.getCurrentChatHistory();
                window.appState.currentSessionData.lastUsed = new Date().toISOString();
                
                // Save to storage incrementally
                sessionManager.saveCurrentSessionToStorage();
                
                Logger.debug('MessageManager', `Incrementally saved message from ${sender} to session`);
            }
        }).catch(err => {
            Logger.warn('MessageManager', 'Could not save message incrementally:', err);
        });
    }
}

// Create singleton instance
export const messageManager = new MessageManager(); 