/**
 * Interactive Feedback UI for PIPS Interactive Mode
 * 
 * This module handles the user interface for providing feedback on
 * AI-generated code and critic suggestions during interactive solving.
 */

class InteractiveFeedback {
    constructor() {
        this.feedbackPanel = null;
        this.currentIteration = null;
        this.currentCode = '';
        this.currentSymbols = {};
        this.criticText = '';
        this.selectedRanges = [];
        this.isVisible = false;
        this.isResizing = false;
        this.sidebarWidth = 380; // Default width
        this.minWidth = 300;
        this.maxWidth = 800;
        this.feedbackCounter = 0;
        this.isMinimized = false;
        this.restoreButton = null;
        
        // Store panel state for restoration
        this.panelState = null;
        
        this.initializeEventHandlers();
    }

    initializeEventHandlers() {
        // Socket event handlers - Note: We don't handle these here anymore
        // They are handled by the main socket event handlers in socket-handlers.js
        // This class is called by those handlers when needed
        
        // Add global mouse events for resizing
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', () => this.handleMouseUp());
    }

    showFeedbackPanel(data) {
        const { iteration, critic_text, code, symbols } = data;
        
        this.currentIteration = iteration;
        this.currentCode = code;
        this.currentSymbols = symbols;
        this.criticText = critic_text;
        this.selectedRanges = [];
        this.feedbackCounter = 0;
        this.isMinimized = false;
        
        // Store panel state for potential restoration
        this.panelState = {
            iteration,
            critic_text,
            code,
            symbols
        };
        
        // Remove any existing restore button
        this.removeRestoreButton();
        
        this.renderFeedbackPanel();
    }

    renderFeedbackPanel() {
        // Remove existing panel if any
        this.removeFeedbackPanel();
        
        // Create compact sidebar panel
        this.feedbackPanel = document.createElement('div');
        this.feedbackPanel.className = 'feedback-sidebar';
        this.feedbackPanel.style.width = `${this.sidebarWidth}px`;
        this.feedbackPanel.innerHTML = `
            <div class="feedback-resize-handle" id="resize-handle"></div>
            
            <div class="feedback-sidebar-header">
                <div class="feedback-title">
                    <h4>Interactive Review</h4>
                    <span class="iteration-badge">Iteration ${this.currentIteration}</span>
                </div>
                <div class="feedback-controls">
                    <button class="feedback-close" id="feedback-close" title="Close panel">
                        <i data-feather="x"></i>
                    </button>
                </div>
            </div>
            
            <div class="feedback-sidebar-content">
                <!-- Symbols Section -->
                <div class="symbols-section">
                    <div class="section-header">
                        <h5>Extracted Symbols</h5>
                        <button class="expand-symbols-btn" id="expand-symbols">
                            <i data-feather="eye"></i>
                        </button>
                    </div>
                    <div class="symbols-preview" id="symbols-preview">
                        ${this.renderSymbolsJSON()}
                    </div>
                </div>
                
                <!-- Code Preview Section -->
                <div class="code-preview-section">
                    <div class="section-header">
                        <h5>Generated Code</h5>
                        <button class="expand-code-btn" id="expand-code">
                            <i data-feather="maximize-2"></i>
                        </button>
                    </div>
                    <div class="code-preview" id="code-preview">
                        <pre class="code-snippet hoverable-code" title="Click to expand and highlight code">${this.escapeHtml(this.truncateCode(this.currentCode))}</pre>
                    </div>
                </div>
                
                <!-- AI Critic Section -->
                <div class="critic-section">
                    <div class="section-header">
                        <h5>AI Analysis</h5>
                        <label class="critic-toggle">
                            <input type="checkbox" id="accept-critic" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="critic-summary">
                        ${this.formatCriticSummary(this.criticText)}
                    </div>
                </div>
                
                <!-- Feedback Cart -->
                <div class="feedback-cart" id="feedback-cart">
                    <div class="section-header">
                        <h5>Your Feedback</h5>
                        <span class="cart-count" id="cart-count">0 items</span>
                    </div>
                    <div class="cart-items" id="cart-items">
                        <div class="empty-cart">
                            <i data-feather="message-circle"></i>
                            <p>No feedback added yet</p>
                            <small>Highlight code or symbols to add feedback</small>
                        </div>
                    </div>
                </div>
                
                <!-- Quick Actions -->
                <div class="quick-actions">
                    <button class="action-btn secondary" id="add-comment">
                        <i data-feather="plus"></i>
                        Add General Comment
                    </button>
                    <button class="action-btn success" id="finish-here">
                        <i data-feather="check"></i>
                        Submit Feedback
                    </button>
                </div>
                
                <!-- Comments Section (Initially Hidden) -->
                <div class="comments-section" id="comments-section" style="display: none;">
                    <h5>Add General Comment</h5>
                    <textarea id="user-comments" 
                              placeholder="Add your general feedback here..."
                              rows="3"></textarea>
                    <div class="comment-actions">
                        <button class="action-btn small primary" id="save-comment">Add</button>
                        <button class="action-btn small secondary" id="cancel-comment">Cancel</button>
                    </div>
                </div>
            </div>
            
            <!-- Symbols Modal (Hidden by default) -->
            <div class="symbols-modal" id="symbols-modal" style="display: none;">
                <div class="symbols-modal-content">
                    <div class="symbols-modal-header">
                        <h4>Extracted Symbols - Iteration ${this.currentIteration}</h4>
                        <button class="modal-close" id="close-symbols-modal">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="symbols-modal-body">
                        <div class="symbols-container">
                            <pre class="symbols-json selectable-json" id="symbols-json">${this.escapeHtml(JSON.stringify(this.currentSymbols, null, 2))}</pre>
                        </div>
                        <div class="selection-info">
                            <p>Select any part of the JSON to add specific feedback</p>
                        </div>
                        
                        <!-- Dialogue Box for Symbol Feedback -->
                        <div class="dialogue-box" id="symbol-dialogue" style="display: none;">
                            <div class="dialogue-header">
                                <h6>Add Feedback</h6>
                                <button class="dialogue-close" id="close-symbol-dialogue">×</button>
                            </div>
                            <div class="dialogue-content">
                                <div class="highlighted-content">
                                    <label>Selected:</label>
                                    <div class="highlight-preview" id="symbol-highlight-preview"></div>
                                </div>
                                <div class="feedback-input">
                                    <label>Your feedback:</label>
                                    <textarea id="symbol-feedback-text" placeholder="Enter your feedback about this selection..." rows="3"></textarea>
                                </div>
                                <div class="dialogue-actions">
                                    <button class="dialogue-btn primary" id="save-symbol-feedback">Add Feedback</button>
                                    <button class="dialogue-btn secondary" id="cancel-symbol-feedback">Cancel</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Code Modal (Hidden by default) -->
            <div class="code-modal" id="code-modal" style="display: none;">
                <div class="code-modal-content">
                    <div class="code-modal-header">
                        <h4>Generated Code - Iteration ${this.currentIteration}</h4>
                        <button class="modal-close" id="close-code-modal">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="code-modal-body">
                        <div class="code-container">
                            <div class="code-gutter" id="code-gutter"></div>
                            <pre class="code-display selectable-code" id="code-display">${this.escapeHtml(this.currentCode)}</pre>
                        </div>
                        <div class="selection-info" id="selection-info">
                            <p>Select code to add specific feedback</p>
                        </div>
                        
                        <!-- Dialogue Box for Code Feedback -->
                        <div class="dialogue-box" id="code-dialogue" style="display: none;">
                            <div class="dialogue-header">
                                <h6>Add Code Feedback</h6>
                                <button class="dialogue-close" id="close-code-dialogue">×</button>
                            </div>
                            <div class="dialogue-content">
                                <div class="highlighted-content">
                                    <label>Selected Code:</label>
                                    <div class="highlight-preview" id="code-highlight-preview"></div>
                                </div>
                                <div class="feedback-input">
                                    <label>Your feedback:</label>
                                    <textarea id="code-feedback-text" placeholder="Enter your feedback about this code..." rows="3"></textarea>
                                </div>
                                <div class="dialogue-actions">
                                    <button class="dialogue-btn primary" id="save-code-feedback">Add Feedback</button>
                                    <button class="dialogue-btn secondary" id="cancel-code-feedback">Cancel</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Insert panel into the body (overlay)
        document.body.appendChild(this.feedbackPanel);
        
        // Add event listeners
        this.attachPanelEventListeners();
        
        // Initialize feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        // Show panel with animation
        setTimeout(() => {
            this.feedbackPanel.classList.add('visible');
            this.isVisible = true;
        }, 10);
    }

    renderSymbolsJSON() {
        if (!this.currentSymbols || Object.keys(this.currentSymbols).length === 0) {
            return '<p class="no-symbols">No symbols extracted</p>';
        }
        
        const jsonString = JSON.stringify(this.currentSymbols, null, 2);
        const truncatedJson = jsonString.length > 200 ? jsonString.substring(0, 200) + '\n  ...\n}' : jsonString;
        
        return `<pre class="symbols-json-preview selectable-json" title="Click to expand and highlight symbols">${this.escapeHtml(truncatedJson)}</pre>`;
    }

    attachPanelEventListeners() {
        // Resize handle
        document.getElementById('resize-handle').addEventListener('mousedown', (e) => {
            this.startResize(e);
        });
        
        // Close button with confirmation
        document.getElementById('feedback-close').addEventListener('click', () => {
            this.confirmCloseFeedbackPanel();
        });
        
        // Expand symbols button
        document.getElementById('expand-symbols').addEventListener('click', () => {
            this.showSymbolsModal();
        });
        
        // Expand code button
        document.getElementById('expand-code').addEventListener('click', () => {
            this.showCodeModal();
        });
        
        // Add comment button
        document.getElementById('add-comment').addEventListener('click', () => {
            this.showCommentsSection();
        });
        
        // Finish button
        document.getElementById('finish-here').addEventListener('click', () => {
            this.submitFeedback();
        });
        
        // Comment actions
        document.getElementById('save-comment').addEventListener('click', () => {
            this.addGeneralComment();
        });
        
        document.getElementById('cancel-comment').addEventListener('click', () => {
            this.hideCommentsSection();
            document.getElementById('user-comments').value = '';
        });
        
        // Modal close buttons
        document.getElementById('close-symbols-modal').addEventListener('click', () => {
            this.hideSymbolsModal();
        });
        
        document.getElementById('close-code-modal').addEventListener('click', () => {
            this.hideCodeModal();
        });
        
        // Click outside to close modals
        document.getElementById('symbols-modal').addEventListener('click', (e) => {
            if (e.target.id === 'symbols-modal') {
                this.hideSymbolsModal();
            }
        });
        
        document.getElementById('code-modal').addEventListener('click', (e) => {
            if (e.target.id === 'code-modal') {
                this.hideCodeModal();
            }
        });
        
        // Dialogue close buttons
        document.getElementById('close-symbol-dialogue')?.addEventListener('click', () => {
            this.hideSymbolDialogue();
        });
        
        document.getElementById('close-code-dialogue')?.addEventListener('click', () => {
            this.hideCodeDialogue();
        });
        
        // Dialogue action buttons
        document.getElementById('save-symbol-feedback')?.addEventListener('click', () => {
            this.saveSymbolFeedback();
        });
        
        document.getElementById('cancel-symbol-feedback')?.addEventListener('click', () => {
            this.hideSymbolDialogue();
        });
        
        document.getElementById('save-code-feedback')?.addEventListener('click', () => {
            this.saveCodeFeedback();
        });
        
        document.getElementById('cancel-code-feedback')?.addEventListener('click', () => {
            this.hideCodeDialogue();
        });
        
        // Preview click handlers
        document.querySelector('.hoverable-code').addEventListener('click', () => {
            this.showCodeModal();
        });
        
        document.querySelector('.selectable-json')?.addEventListener('click', () => {
            this.showSymbolsModal();
        });
    }

    startResize(e) {
        this.isResizing = true;
        this.startX = e.clientX;
        this.startWidth = this.sidebarWidth;
        
        // Add visual feedback
        document.body.style.cursor = 'ew-resize';
        this.feedbackPanel.classList.add('resizing');
        
        e.preventDefault();
    }

    handleMouseMove(e) {
        if (!this.isResizing) return;
        
        const deltaX = this.startX - e.clientX;
        const newWidth = Math.max(this.minWidth, Math.min(this.maxWidth, this.startWidth + deltaX));
        
        this.sidebarWidth = newWidth;
        this.feedbackPanel.style.width = `${newWidth}px`;
    }

    handleMouseUp() {
        if (!this.isResizing) return;
        
        this.isResizing = false;
        document.body.style.cursor = '';
        this.feedbackPanel.classList.remove('resizing');
    }

    showSymbolsModal() {
        const modal = document.getElementById('symbols-modal');
        modal.style.display = 'flex';
        
        // Initialize JSON selection
        setTimeout(() => {
            this.initializeJSONSelection();
        }, 10);
    }

    hideSymbolsModal() {
        const modal = document.getElementById('symbols-modal');
        modal.style.display = 'none';
        this.hideSymbolDialogue();
    }

    showCodeModal() {
        const modal = document.getElementById('code-modal');
        modal.style.display = 'flex';
        
        // Add line numbers and initialize code selection
        setTimeout(() => {
            this.addLineNumbers();
            this.initializeCodeSelection();
        }, 10);
    }

    hideCodeModal() {
        const modal = document.getElementById('code-modal');
        modal.style.display = 'none';
        this.hideCodeDialogue();
    }

    initializeJSONSelection() {
        const jsonElement = document.getElementById('symbols-json');
        if (jsonElement) {
            jsonElement.addEventListener('mouseup', () => {
                this.handleJSONSelection();
            });
        }
    }

    initializeCodeSelection() {
        const codeDisplay = document.getElementById('code-display');
        if (codeDisplay) {
            codeDisplay.addEventListener('mouseup', () => {
                this.handleCodeSelection();
            });
        }
    }

    handleJSONSelection() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            const selectedText = selection.toString().trim();
            if (selectedText) {
                this.showSymbolDialogue(selectedText);
            }
        }
    }

    handleCodeSelection() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            const selectedText = selection.toString().trim();
            if (selectedText) {
                this.showCodeDialogue(selectedText);
            }
        }
    }

    showSymbolDialogue(selectedText) {
        const dialogue = document.getElementById('symbol-dialogue');
        const preview = document.getElementById('symbol-highlight-preview');
        
        preview.innerHTML = `<pre>${this.escapeHtml(selectedText)}</pre>`;
        dialogue.style.display = 'block';
        
        // Focus on textarea
        document.getElementById('symbol-feedback-text').focus();
        
        // Store selected text
        this.currentSelection = {
            type: 'symbol',
            text: selectedText
        };
    }

    showCodeDialogue(selectedText) {
        const dialogue = document.getElementById('code-dialogue');
        const preview = document.getElementById('code-highlight-preview');
        
        preview.innerHTML = `<pre>${this.escapeHtml(selectedText)}</pre>`;
        dialogue.style.display = 'block';
        
        // Focus on textarea
        document.getElementById('code-feedback-text').focus();
        
        // Store selected text
        this.currentSelection = {
            type: 'code',
            text: selectedText
        };
    }

    hideSymbolDialogue() {
        const dialogue = document.getElementById('symbol-dialogue');
        dialogue.style.display = 'none';
        document.getElementById('symbol-feedback-text').value = '';
        window.getSelection().removeAllRanges();
    }

    hideCodeDialogue() {
        const dialogue = document.getElementById('code-dialogue');
        dialogue.style.display = 'none';
        document.getElementById('code-feedback-text').value = '';
        window.getSelection().removeAllRanges();
    }

    saveSymbolFeedback() {
        const feedbackText = document.getElementById('symbol-feedback-text').value.trim();
        if (feedbackText && this.currentSelection) {
            this.addFeedbackItem('symbol', this.currentSelection.text, feedbackText);
            this.hideSymbolDialogue();
            this.showNotification('Symbol feedback added');
        }
    }

    saveCodeFeedback() {
        const feedbackText = document.getElementById('code-feedback-text').value.trim();
        if (feedbackText && this.currentSelection) {
            this.addFeedbackItem('code', this.currentSelection.text, feedbackText);
            this.hideCodeDialogue();
            this.showNotification('Code feedback added');
        }
    }

    addGeneralComment() {
        const comment = document.getElementById('user-comments').value.trim();
        if (comment) {
            this.addFeedbackItem('general', '', comment);
            this.hideCommentsSection();
            document.getElementById('user-comments').value = '';
            this.showNotification('General comment added');
        }
    }

    addFeedbackItem(type, selectedText, comment) {
        const feedback = {
            id: ++this.feedbackCounter,
            type: type,
            text: selectedText,
            comment: comment,
            timestamp: new Date().toLocaleTimeString()
        };
        
        this.selectedRanges.push(feedback);
        this.updateFeedbackCart();
    }

    updateFeedbackCart() {
        const cartItems = document.getElementById('cart-items');
        const cartCount = document.getElementById('cart-count');
        
        cartCount.textContent = `${this.selectedRanges.length} item${this.selectedRanges.length !== 1 ? 's' : ''}`;
        
        if (this.selectedRanges.length === 0) {
            cartItems.innerHTML = `
                <div class="empty-cart">
                    <i data-feather="message-circle"></i>
                    <p>No feedback added yet</p>
                    <small>Highlight code or symbols to add feedback</small>
                </div>
            `;
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
            return;
        }
        
        const items = this.selectedRanges.map(item => {
            const typeIcon = item.type === 'code' ? 'code' : item.type === 'symbol' ? 'hash' : 'message-circle';
            const typeLabel = item.type === 'code' ? 'Code' : item.type === 'symbol' ? 'Symbol' : 'General';
            const preview = item.text ? (item.text.length > 50 ? item.text.substring(0, 50) + '...' : item.text) : '';
            
            return `
                <div class="cart-item" data-id="${item.id}">
                    <div class="cart-item-header">
                        <div class="cart-item-type">
                            <i data-feather="${typeIcon}"></i>
                            <span>${typeLabel}</span>
                            <small>${item.timestamp}</small>
                        </div>
                        <div class="cart-item-actions">
                            <button class="cart-action edit" onclick="window.interactiveFeedback.editFeedback(${item.id})" title="Edit">
                                <i data-feather="edit-2"></i>
                            </button>
                            <button class="cart-action remove" onclick="window.interactiveFeedback.removeFeedback(${item.id})" title="Remove">
                                <i data-feather="trash-2"></i>
                            </button>
                        </div>
                    </div>
                    ${preview ? `<div class="cart-item-preview">${this.escapeHtml(preview)}</div>` : ''}
                    <div class="cart-item-comment">${this.escapeHtml(item.comment)}</div>
                </div>
            `;
        }).join('');
        
        cartItems.innerHTML = items;
        
        // Re-initialize feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    editFeedback(id) {
        const feedback = this.selectedRanges.find(item => item.id === id);
        if (!feedback) return;
        
        const newComment = prompt(`Edit your feedback:\n\n${feedback.text ? 'Selected: ' + feedback.text + '\n\n' : ''}Current feedback:`, feedback.comment);
        if (newComment !== null && newComment.trim() !== '') {
            feedback.comment = newComment.trim();
            this.updateFeedbackCart();
            this.showNotification('Feedback updated');
        }
    }

    removeFeedback(id) {
        this.selectedRanges = this.selectedRanges.filter(item => item.id !== id);
        this.updateFeedbackCart();
        this.showNotification('Feedback removed');
    }

    showCommentsSection() {
        const section = document.getElementById('comments-section');
        section.style.display = 'block';
        document.getElementById('user-comments').focus();
    }

    hideCommentsSection() {
        const section = document.getElementById('comments-section');
        section.style.display = 'none';
    }



    confirmCloseFeedbackPanel() {
        const hasUnsavedFeedback = this.selectedRanges.length > 0;
        
        let message = 'Are you sure you want to close the feedback panel?';
        if (hasUnsavedFeedback) {
            message += '\n\nYou have unsaved feedback that will be lost. The interactive session will not be able to continue without your feedback.';
        } else {
            message += '\n\nWithout providing feedback, the interactive session cannot continue.';
        }
        
        if (confirm(message)) {
            this.hideFeedbackPanel();
        }
    }

    hideFeedbackPanel() {
        if (this.feedbackPanel) {
            this.feedbackPanel.classList.remove('visible');
            setTimeout(() => {
                this.removeFeedbackPanel();
                this.showRestoreButton();
            }, 300);
        }
    }

    showRestoreButton() {
        // Remove existing restore button if any
        this.removeRestoreButton();
        
        // Create restore button in chat area
        this.restoreButton = document.createElement('div');
        this.restoreButton.className = 'feedback-restore-container';
        this.restoreButton.innerHTML = `
            <div class="feedback-restore-banner">
                <div class="restore-actions">
                    <button class="btn-restore-feedback" id="restore-feedback-btn">
                        <i data-feather="edit-3"></i>
                        Continue Reviewing
                    </button>
                    <button class="btn-terminate-session" id="terminate-session-btn">
                        <i data-feather="check-circle"></i>
                        Finish Here
                    </button>
                </div>
            </div>
        `;
        
        // Add to chat container
        const chatContainer = document.getElementById('chat-container') || document.getElementById('chatArea');
        if (chatContainer) {
            chatContainer.appendChild(this.restoreButton);
        }
        
        // Add event listeners
        document.getElementById('restore-feedback-btn').addEventListener('click', () => {
            this.restoreFeedbackPanel();
        });
        
        document.getElementById('terminate-session-btn').addEventListener('click', () => {
            this.terminateInteractiveSession();
        });
        
        // Initialize feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    removeRestoreButton() {
        if (this.restoreButton && document.body.contains(this.restoreButton)) {
            this.restoreButton.remove();
        }
        this.restoreButton = null;
    }

    restoreFeedbackPanel() {
        if (this.panelState) {
            // Remove restore button
            this.removeRestoreButton();
            
            // Restore the panel with saved state
            if (this.isMinimized && this.feedbackPanel) {
                // Panel exists but is hidden, just show it
                this.feedbackPanel.style.display = 'block';
                this.isMinimized = false;
                this.isVisible = true;
            } else {
                // Panel was completely removed, recreate it
                this.showFeedbackPanel(this.panelState);
            }
            
            this.showNotification('Welcome back! Ready to continue reviewing the AI\'s work.');
        }
    }

    terminateInteractiveSession() {
        if (confirm('Are you sure you want to end the interactive session?\n\nThis will stop the AI from waiting for feedback and provide the current solution as final.')) {
            // Remove restore button
            this.removeRestoreButton();
            
            // Send termination signal
            import('../network/socket.js').then(({ socketManager }) => {
                socketManager.send('terminate_session');
            });
            
            this.showNotification('Session ended. The AI will finalize the current solution.');
        }
    }

    truncateCode(code) {
        const lines = code.split('\n');
        if (lines.length <= 8) {
            return code;
        }
        return lines.slice(0, 8).join('\n') + '\n... (click to expand)';
    }

    formatCriticSummary(text) {
        if (!text || text.trim() === '') {
            return '<p class="no-issues">No issues found by AI critic.</p>';
        }
        
        // Extract first sentence or first 100 characters
        const summary = text.length > 100 ? text.substring(0, 100) + '...' : text;
        return `<p class="critic-summary-text">${this.escapeHtml(summary)}</p>`;
    }

    addLineNumbers() {
        const codeDisplay = document.getElementById('code-display');
        const codeGutter = document.getElementById('code-gutter');
        
        if (codeDisplay && codeGutter) {
            const lines = this.currentCode.split('\n');
            const gutterHTML = lines.map((_, index) => 
                `<div class="line-number" data-line="${index + 1}">${index + 1}</div>`
            ).join('');
            
            codeGutter.innerHTML = gutterHTML;
        }
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'feedback-notification';
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('visible');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 2000);
    }

    submitFeedback() {
        const acceptCritic = document.getElementById('accept-critic').checked;
        
        this.disableButtons();
        this.showLoadingState('Submitting feedback...');
        
        // Convert feedback to the expected format
        const quotedRanges = this.selectedRanges.map(item => {
            if (item.type === 'symbol') {
                return {
                    text: `Symbol JSON: ${item.text}`,
                    comment: item.comment
                };
            } else if (item.type === 'code') {
                return {
                    text: item.text,
                    comment: item.comment
                };
            } else {
                return {
                    text: 'General Comment',
                    comment: item.comment
                };
            }
        });
        
        // Import socket manager and send feedback
        import('../network/socket.js').then(({ socketManager }) => {
            socketManager.send('provide_feedback', {
                accept_critic: acceptCritic,
                extra_comments: '',
                quoted_ranges: quotedRanges,
                terminate: false  // Continue the process, don't terminate
            });
        });
        
        // Clean up the panel completely after submitting feedback
        this.removeFeedbackPanel();
        this.removeRestoreButton();
    }

    disableButtons() {
        const buttons = this.feedbackPanel.querySelectorAll('button');
        buttons.forEach(btn => btn.disabled = true);
    }

    showLoadingState(message) {
        // Show loading indicator in the sidebar
        const content = this.feedbackPanel.querySelector('.feedback-sidebar-content');
        if (content) {
            content.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    removeFeedbackPanel() {
        if (this.feedbackPanel && document.body.contains(this.feedbackPanel)) {
            document.body.removeChild(this.feedbackPanel);
        }
        this.feedbackPanel = null;
        this.isVisible = false;
    }

    showFinalArtifacts(data) {
        // Show final artifacts in a compact way
        const artifactsPanel = document.createElement('div');
        artifactsPanel.className = 'final-artifacts-compact';
        artifactsPanel.innerHTML = `
            <div class="artifacts-header">
                <h4>Final Solution</h4>
                <button class="artifacts-close" onclick="this.parentElement.parentElement.remove()">
                    <i data-feather="x"></i>
                </button>
            </div>
            <div class="artifacts-content">
                <div class="artifacts-summary">
                    <p>Solution completed successfully!</p>
                    <button class="view-details-btn" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
                        View Details
                    </button>
                    <div class="artifacts-details" style="display: none;">
                        <div class="artifact-section">
                            <h5>Final Code</h5>
                            <pre class="artifact-code">${this.escapeHtml(data.code || 'No code available')}</pre>
                        </div>
                        <div class="artifact-section">
                            <h5>Extracted Symbols</h5>
                            <pre class="artifact-json">${JSON.stringify(data.symbols || {}, null, 2)}</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add to chat area
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.appendChild(artifactsPanel);
        }
        
        // Initialize feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }

    handleModeSwitched(data) {
        // Handle mode switching if needed
        this.updateModeIndicator(data.mode);
    }

    updateModeIndicator(mode) {
        // Update any mode indicators in the UI
        const indicators = document.querySelectorAll('.mode-badge');
        indicators.forEach(indicator => {
            indicator.textContent = mode;
            indicator.className = `mode-badge mode-${mode.toLowerCase()}`;
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
window.interactiveFeedback = new InteractiveFeedback(); 