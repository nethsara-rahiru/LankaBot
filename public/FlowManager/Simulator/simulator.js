/**
 * FlowSimulator
 *
 * Manages the Simulator overlay UI. Connects the FlowCompiler and FlowRuntime
 * to the chat interface and flow-box view.
 *
 * This module is purely UI — it does not execute flow logic itself.
 * It delegates all execution to FlowRuntime.
 */
class FlowSimulator {
    constructor() {
        this.runtime = new FlowRuntime();
        this.compiled = null;
        this.isOpen = false;
        this.autoPlay = false;
        this.autoPlayDelay = 800; // ms between auto-steps

        // DOM references (set after overlay is injected)
        this.overlay = null;
        this.messagesEl = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.stepIndicator = null;
        this.varsPanel = null;
        this.flowboxCanvas = null;

        // Buttons
        this.runBtn = null;
        this.stopBtn = null;
        this.stepBtn = null;
        this.resetBtn = null;
        this.closeBtn = null;
        this.autoToggle = null;

        this._autoTimer = null;
        this._bindRuntimeCallbacks();
    }

    // ──────────────────────────────
    //  Initialization
    // ──────────────────────────────

    /**
     * Create and inject the simulator overlay HTML into the page
     */
    init() {
        if (document.getElementById('simulator-overlay')) return;

        const html = `
        <div class="simulator-overlay" id="simulator-overlay">
            <!-- Toolbar -->
            <div class="sim-toolbar">
                <div class="sim-toolbar-left">
                    <button class="sim-btn run" id="sim-run-btn" title="Run Flow">
                        <i class="ph-bold ph-play"></i> Run
                    </button>
                    <button class="sim-btn stop" id="sim-stop-btn" title="Stop" disabled>
                        <i class="ph-bold ph-stop"></i> Stop
                    </button>
                    <button class="sim-btn reset" id="sim-reset-btn" title="Reset" disabled>
                        <i class="ph-bold ph-arrow-counter-clockwise"></i> Reset
                    </button>
                    <button class="sim-btn" id="sim-step-btn" title="Step" disabled>
                        <i class="ph-bold ph-skip-forward"></i> Step
                    </button>
                </div>
                <div class="sim-toolbar-center">
                    <div class="sim-step-indicator" id="sim-step-indicator">
                        Step 0 / 0
                    </div>
                    <div class="sim-toggle-wrap">
                        <span>Auto</span>
                        <input type="checkbox" class="sim-toggle" id="sim-auto-toggle">
                    </div>
                </div>
                <div class="sim-toolbar-right">
                    <button class="sim-btn close" id="sim-close-btn" title="Close Simulator">
                        <i class="ph-bold ph-x"></i> Close
                    </button>
                </div>
            </div>

            <!-- Body: Chat + Flow Box -->
            <div class="sim-body">
                <!-- Chat Box -->
                <div class="sim-chatbox">
                    <div class="sim-chat-header">
                        <div class="sim-chat-avatar">
                            <i class="ph-bold ph-robot"></i>
                        </div>
                        <div class="sim-chat-info">
                            <h4>FrontDesk</h4>
                            <p id="sim-bot-status">Ready to simulate</p>
                        </div>
                    </div>
                    <div class="sim-messages" id="sim-messages"></div>
                    <div class="sim-chat-input">
                        <input type="text" id="sim-input" placeholder="Type a message..." disabled>
                        <button class="sim-send-btn" id="sim-send-btn" disabled>
                            <i class="ph-bold ph-paper-plane-tilt"></i>
                        </button>
                    </div>
                </div>

                <!-- Flow Box -->
                <div class="sim-flowbox">
                    <div class="sim-flowbox-header">
                        <i class="ph-bold ph-git-branch"></i>
                        Flow Tree
                    </div>
                    <div class="sim-flowbox-canvas" id="sim-flowbox-canvas">
                        <!-- Cloned canvas nodes go here -->
                    </div>
                    <div class="sim-vars-panel" id="sim-vars-panel">
                        <h4><i class="ph-bold ph-brackets-curly"></i> Live Variables</h4>
                        <div id="sim-vars-list"></div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
        this._cacheDOM();
        this._attachListeners();
    }

    _cacheDOM() {
        this.overlay = document.getElementById('simulator-overlay');
        this.messagesEl = document.getElementById('sim-messages');
        this.inputEl = document.getElementById('sim-input');
        this.sendBtn = document.getElementById('sim-send-btn');
        this.stepIndicator = document.getElementById('sim-step-indicator');
        this.varsPanel = document.getElementById('sim-vars-list');
        this.flowboxCanvas = document.getElementById('sim-flowbox-canvas');

        this.runBtn = document.getElementById('sim-run-btn');
        this.stopBtn = document.getElementById('sim-stop-btn');
        this.stepBtn = document.getElementById('sim-step-btn');
        this.resetBtn = document.getElementById('sim-reset-btn');
        this.closeBtn = document.getElementById('sim-close-btn');
        this.autoToggle = document.getElementById('sim-auto-toggle');
    }

    _attachListeners() {
        this.runBtn.addEventListener('click', () => this.run());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.stepBtn.addEventListener('click', () => this.stepOnce());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.closeBtn.addEventListener('click', () => this.close());

        this.autoToggle.addEventListener('change', (e) => {
            this.autoPlay = e.target.checked;
            if (this.autoPlay && this.runtime.status === 'running') {
                this._startAutoPlay();
            } else {
                this._stopAutoPlay();
            }
        });

        this.sendBtn.addEventListener('click', () => this._sendUserMessage());
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._sendUserMessage();
        });
    }

    // ──────────────────────────────
    //  Open / Close
    // ──────────────────────────────

    /**
     * Open the simulator overlay, hide sidebars
     */
    open(compiledFlow) {
        this.compiled = compiledFlow;
        this.isOpen = true;

        // Hide editor sidebars
        document.querySelectorAll('.sidebar').forEach(el => el.classList.add('sim-hidden'));

        // Clone canvas into flowbox
        this._cloneCanvas();

        // Show overlay
        this.overlay.classList.add('active');
        this._updateButtonStates('ready');

        this._addSystemMessage('Simulator ready. Press Run to begin.');
        document.getElementById('sim-bot-status').textContent = 'Ready to simulate';
    }

    /**
     * Close the simulator overlay, restore sidebars
     */
    close() {
        this.stop();
        this.isOpen = false;

        this.overlay.classList.remove('active');

        // Restore editor sidebars
        document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('sim-hidden'));

        // Clear highlights from real canvas
        document.querySelectorAll('.flow-node').forEach(n => {
            n.classList.remove('sim-active', 'sim-visited');
        });

        // Clear chat
        this.messagesEl.innerHTML = '';
        this.flowboxCanvas.innerHTML = '';
    }

    // ──────────────────────────────
    //  Runtime Controls
    // ──────────────────────────────

    run() {
        this.runtime.start(this.compiled);
        this._updateButtonStates('running');
        this._addSystemMessage('Flow started!');
        document.getElementById('sim-bot-status').textContent = 'Running...';
        this._renderVariables(this.runtime.variables);

        // Clear previous highlights
        document.querySelectorAll('.flow-node').forEach(n => {
            n.classList.remove('sim-active', 'sim-visited');
        });

        // Auto-advance through start node
        this.runtime.step();

        if (this.autoPlay) {
            this._startAutoPlay();
        }
    }

    stop() {
        this._stopAutoPlay();
        this.runtime.stop();
        this._updateButtonStates('stopped');
        this._addSystemMessage('Flow stopped.');
        document.getElementById('sim-bot-status').textContent = 'Stopped';
        this.inputEl.disabled = true;
        this.sendBtn.disabled = true;
    }

    reset() {
        this._stopAutoPlay();
        this.runtime.reset();
        this.messagesEl.innerHTML = '';
        this._updateButtonStates('ready');
        this._addSystemMessage('Simulator reset. Press Run to begin.');
        document.getElementById('sim-bot-status').textContent = 'Ready to simulate';
        this._renderVariables(this.runtime.variables);
        this.inputEl.disabled = true;
        this.sendBtn.disabled = true;
        this.inputEl.value = '';

        // Clear highlights
        document.querySelectorAll('.flow-node').forEach(n => {
            n.classList.remove('sim-active', 'sim-visited');
        });
    }

    stepOnce() {
        if (this.runtime.status === 'running') {
            this.runtime.step();
        }
    }

    // ──────────────────────────────
    //  Auto-play
    // ──────────────────────────────

    _startAutoPlay() {
        this._stopAutoPlay();
        this._autoTimer = setInterval(() => {
            if (this.runtime.status === 'running') {
                this.runtime.step();
            } else {
                this._stopAutoPlay();
            }
        }, this.autoPlayDelay);
    }

    _stopAutoPlay() {
        if (this._autoTimer) {
            clearInterval(this._autoTimer);
            this._autoTimer = null;
        }
    }

    // ──────────────────────────────
    //  Runtime Callbacks
    // ──────────────────────────────

    _bindRuntimeCallbacks() {
        this.runtime.onBotMessage = (text) => {
            this._addBotMessage(text);
            // Continue auto-stepping if autoPlay is on
        };

        this.runtime.onWaitingForInput = (prompt) => {
            this._addBotMessage(prompt);
            this._enableInput();
            this._updateButtonStates('waiting');
            document.getElementById('sim-bot-status').textContent = 'Waiting for input...';
        };

        this.runtime.onWaitingForOption = (prompt, options) => {
            this._addBotMessage(prompt);
            this._enableInput();
            this._updateButtonStates('waiting');
            document.getElementById('sim-bot-status').textContent = 'Waiting for input...';
        };

        this.runtime.onAIExtract = async (data) => {
            this._addSystemMessage('🧠 AI is thinking...');
            this._updateButtonStates('waiting');
            document.getElementById('sim-bot-status').textContent = 'AI Processing...';
            
            try {
                const response = await fetch('/api/simulator/ai-extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                
                if (result.result) {
                    this._addSystemMessage(`✨ AI extracted: "${result.result}"`);
                    this.runtime.step(result.result);
                } else {
                    throw new Error('No result from AI');
                }
            } catch (err) {
                console.error(err);
                this._addSystemMessage('❌ AI extraction failed, falling back to raw input.');
                this.runtime.step(data.userInput);
            }
            
            if (this.runtime.status === 'running' && this.autoPlay) {
                this._startAutoPlay();
            }
        };

        this.runtime.onWait = (seconds) => {
            this._addSystemMessage(`Waiting ${seconds}s...`);
            this._updateButtonStates('waiting');
            document.getElementById('sim-bot-status').textContent = `Waiting ${seconds}s...`;
        };

        this.runtime.onStepChange = (nodeId, stepIndex, totalSteps) => {
            this.stepIndicator.textContent = `Step ${stepIndex} / ${totalSteps}`;
            this._highlightNode(nodeId);
        };

        this.runtime.onVariableUpdate = (vars) => {
            this._renderVariables(vars);
        };

        this.runtime.onFlowEnd = () => {
            this._addSystemMessage('✅ Flow completed!');
            this._updateButtonStates('finished');
            document.getElementById('sim-bot-status').textContent = 'Flow completed';
            this.inputEl.disabled = true;
            this.sendBtn.disabled = true;
            this._stopAutoPlay();
        };
    }

    // ──────────────────────────────
    //  Chat UI Helpers
    // ──────────────────────────────

    _addBotMessage(text) {
        // Show typing indicator briefly
        const typing = document.createElement('div');
        typing.className = 'sim-typing';
        typing.innerHTML = '<div class="sim-typing-dot"></div><div class="sim-typing-dot"></div><div class="sim-typing-dot"></div>';
        this.messagesEl.appendChild(typing);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

        setTimeout(() => {
            typing.remove();
            const msg = document.createElement('div');
            msg.className = 'sim-msg bot';
            msg.innerHTML = `${this._escapeHtml(text)}<span class="msg-time">${this._getTime()}</span>`;
            this.messagesEl.appendChild(msg);
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }, 400);
    }

    _addUserMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'sim-msg user';
        msg.innerHTML = `${this._escapeHtml(text)}<span class="msg-time">${this._getTime()}</span>`;
        this.messagesEl.appendChild(msg);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _addSystemMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'sim-msg system';
        msg.textContent = text;
        this.messagesEl.appendChild(msg);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _addOptionButtons(options) {
        const row = document.createElement('div');
        row.className = 'sim-options-row';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'sim-option-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                this._submitInput(opt);
                // Remove option buttons after selection
                row.remove();
            });
            row.appendChild(btn);
        });
        this.messagesEl.appendChild(row);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _enableInput() {
        this.inputEl.disabled = false;
        this.sendBtn.disabled = false;
        this.inputEl.focus();
    }

    _sendUserMessage() {
        const text = this.inputEl.value.trim();
        if (!text) return;
        this._submitInput(text);
    }

    _submitInput(text) {
        this._addUserMessage(text);
        this.inputEl.value = '';
        this.inputEl.disabled = true;
        this.sendBtn.disabled = true;

        document.getElementById('sim-bot-status').textContent = 'Running...';
        this._updateButtonStates('running');

        // Give the runtime the user input and auto-step
        setTimeout(() => {
            this.runtime.step(text);
            // Continue auto-stepping if still running
            if (this.runtime.status === 'running' && this.autoPlay) {
                this._startAutoPlay();
            }
        }, 300);
    }

    // ──────────────────────────────
    //  Flow Box (node highlighting)
    // ──────────────────────────────

    _cloneCanvas() {
        // Clone the existing canvas nodes into the flowbox for read-only viewing
        const origWrapper = document.getElementById('canvas-wrapper');
        const clone = origWrapper.cloneNode(true);
        clone.id = 'sim-canvas-clone';

        // Remove interactivity from cloned elements
        clone.querySelectorAll('.port').forEach(p => p.style.display = 'none');
        clone.querySelectorAll('.node-delete').forEach(d => d.style.display = 'none');
        clone.querySelectorAll('input, textarea, select, button').forEach(el => {
            el.disabled = true;
            el.style.pointerEvents = 'none';
        });

        this.flowboxCanvas.innerHTML = '';
        this.flowboxCanvas.appendChild(clone);
    }

    _highlightNode(nodeId) {
        // Highlight on the REAL canvas (so it persists)
        document.querySelectorAll('.flow-node.sim-active').forEach(n => {
            n.classList.remove('sim-active');
            n.classList.add('sim-visited');
        });

        const realNode = document.getElementById(nodeId);
        if (realNode) {
            realNode.classList.add('sim-active');
        }

        // Also highlight on the cloned flowbox canvas
        if (this.flowboxCanvas) {
            this.flowboxCanvas.querySelectorAll('.flow-node.sim-active').forEach(n => {
                n.classList.remove('sim-active');
                n.classList.add('sim-visited');
            });
            const clonedNode = this.flowboxCanvas.querySelector(`#${nodeId}`);
            if (clonedNode) {
                clonedNode.classList.add('sim-active');
                // Scroll to keep node visible
                clonedNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }
    }

    // ──────────────────────────────
    //  Variables Panel
    // ──────────────────────────────

    _renderVariables(vars) {
        if (!this.varsPanel) return;
        this.varsPanel.innerHTML = '';
        Object.entries(vars).forEach(([name, value]) => {
            const row = document.createElement('div');
            row.className = 'sim-var-row';
            row.innerHTML = `
                <span class="sim-var-name">${name}</span>
                <span class="sim-var-value ${value === null ? 'null' : ''}">${value !== null ? value : 'null'}</span>
            `;
            this.varsPanel.appendChild(row);
        });
    }

    // ──────────────────────────────
    //  Button States
    // ──────────────────────────────

    _updateButtonStates(state) {
        switch (state) {
            case 'ready':
                this.runBtn.disabled = false;
                this.stopBtn.disabled = true;
                this.stepBtn.disabled = true;
                this.resetBtn.disabled = true;
                break;
            case 'running':
                this.runBtn.disabled = true;
                this.stopBtn.disabled = false;
                this.stepBtn.disabled = false;
                this.resetBtn.disabled = false;
                break;
            case 'waiting':
                this.runBtn.disabled = true;
                this.stopBtn.disabled = false;
                this.stepBtn.disabled = true;
                this.resetBtn.disabled = false;
                break;
            case 'stopped':
            case 'finished':
                this.runBtn.disabled = true;
                this.stopBtn.disabled = true;
                this.stepBtn.disabled = true;
                this.resetBtn.disabled = false;
                break;
        }
    }

    // ──────────────────────────────
    //  Utilities
    // ──────────────────────────────

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _getTime() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

// Export for browser
window.FlowSimulator = FlowSimulator;
