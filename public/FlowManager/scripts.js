document.addEventListener('DOMContentLoaded', () => {
    const canvasContainer = document.getElementById('canvas-container');
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const nodesLayer = document.getElementById('nodes-layer');
    const connectionsLayer = document.getElementById('connections-layer');
    const paletteItems = document.querySelectorAll('.palette-item');
    
    // State
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;
    
    let nodes = new Map();
    let connections = [];
    let variables = new Set();
    let nextNodeId = 1;

    // Connection drawing state
    let isDrawingConnection = false;
    let activeStartPort = null;
    let tempLine = null;

    // ----- Canvas Zoom & Pan -----
    
    const updateCanvasTransform = () => {
        canvasWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    };

    canvasContainer.addEventListener('mousedown', (e) => {
        // Only pan if clicking directly on container/svg (not on nodes)
        if (e.target === canvasContainer || e.target.tagName === 'svg') {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            canvasContainer.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            updateCanvasTransform();
        }
        
        if (isDrawingConnection && activeStartPort) {
            const rect = canvasWrapper.getBoundingClientRect();
            // Mouse coords relative to canvas wrapper
            const mouseX = (e.clientX - rect.left) / scale;
            const mouseY = (e.clientY - rect.top) / scale;
            
            const startNodeId = activeStartPort.dataset.nodeId;
            const startNode = nodes.get(startNodeId);
            const startRect = activeStartPort.getBoundingClientRect();
            
            // Start port coords relative to canvas wrapper
            const startX = (startRect.left + startRect.width / 2 - rect.left) / scale;
            const startY = (startRect.top + startRect.height / 2 - rect.top) / scale;
            
            drawTempLine(startX, startY, mouseX, mouseY);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            canvasContainer.style.cursor = 'default';
        }
        if (isDrawingConnection) {
            isDrawingConnection = false;
            activeStartPort = null;
            if (tempLine) {
                tempLine.remove();
                tempLine = null;
            }
        }
    });

    canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const wheel = e.deltaY < 0 ? 1 : -1;
        const zoom = Math.exp(wheel * zoomIntensity);
        
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate new pan to zoom towards mouse cursor
        panX = mouseX - (mouseX - panX) * zoom;
        panY = mouseY - (mouseY - panY) * zoom;
        scale *= zoom;
        
        updateCanvasTransform();
    }, { passive: false });

    document.getElementById('zoom-in').addEventListener('click', () => { scale *= 1.2; updateCanvasTransform(); });
    document.getElementById('zoom-out').addEventListener('click', () => { scale /= 1.2; updateCanvasTransform(); });
    document.getElementById('zoom-reset').addEventListener('click', () => { scale = 1; panX = 0; panY = 0; updateCanvasTransform(); });

    // ----- Drag & Drop from Palette -----
    
    paletteItems.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('node-type', item.dataset.type);
        });
    });

    canvasContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    canvasContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('node-type');
        if (type) {
            const rect = canvasWrapper.getBoundingClientRect();
            const x = (e.clientX - rect.left) / scale;
            const y = (e.clientY - rect.top) / scale;
            createNode(type, x, y);
        }
    });

    // ----- Node Creation -----
    
    const getNodeTemplate = (type, id) => {
        let content = '';
        switch(type) {
            case 'start':
                return `
                    <div class="node-header" style="background: rgba(46, 204, 113, 0.1);">
                        <i class="ph-bold ph-play"></i>
                        <span>Start Flow</span>
                    </div>
                    <div class="node-content">
                        <p style="margin:0; font-size: 0.85rem; color: var(--text-dim);">Triggered on new conversation</p>
                    </div>
                    <div class="port port-out" data-node-id="${id}" data-port-id="out"></div>
                `;
            case 'say':
                content = `<textarea placeholder="Message to send..." class="node-data" data-key="message"></textarea>`;
                break;
            case 'get':
                content = `
                    <input type="text" placeholder="Prompt message..." class="node-data" data-key="prompt">
                    <input type="text" placeholder="AI Prompt (e.g. Extract age as number) [Optional]" class="node-data" data-key="aiPrompt" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                    <select class="node-data" data-key="variable" style="margin-top: 0.5rem;">
                        <option value="">Select Variable...</option>
                        ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                break;
            case 'getOption':
                content = `
                    <input type="text" placeholder="Prompt message..." class="node-data" data-key="prompt">
                    <input type="text" placeholder="AI Prompt (e.g. Extract selection) [Optional]" class="node-data" data-key="aiPrompt" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                    <div class="options-container" id="options-${id}" style="margin-top: 0.5rem;">
                        <div class="node-option">
                            <input type="text" placeholder="Option 1" class="node-data option-input" data-option-id="opt1">
                            <div class="port port-out" data-node-id="${id}" data-port-id="opt1"></div>
                        </div>
                    </div>
                    <button class="add-option-btn" onclick="addOption('${id}')"><i class="ph-bold ph-plus"></i> Add Option</button>
                    <select class="node-data" data-key="variable" style="margin-top: 0.5rem;">
                        <option value="">Save to Variable...</option>
                        ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                break;
            case 'wait':
                content = `<input type="number" placeholder="Seconds" class="node-data" data-key="duration">`;
                break;
            case 'triggerIf':
                content = `<input type="text" placeholder="Condition (e.g. var == 'val')" class="node-data" data-key="condition">`;
                break;
        }

        return `
            <div class="port port-in" data-node-id="${id}" data-port-id="in"></div>
            <div class="node-header">
                <i class="ph-bold ph-cube"></i>
                <span>${type}</span>
                <i class="ph-bold ph-trash node-delete" onclick="deleteNode('${id}')"></i>
            </div>
            <div class="node-content">
                ${content}
            </div>
            ${type !== 'getOption' ? `<div class="port port-out" data-node-id="${id}" data-port-id="out"></div>` : ''}
        `;
    };

    window.addOption = (nodeId) => {
        const container = document.getElementById(`options-${nodeId}`);
        const optCount = container.children.length + 1;
        const optId = `opt${optCount}`;
        
        const div = document.createElement('div');
        div.className = 'node-option';
        div.innerHTML = `
            <input type="text" placeholder="Option ${optCount}" class="node-data option-input" data-option-id="${optId}">
            <div class="port port-out" data-node-id="${nodeId}" data-port-id="${optId}"></div>
        `;
        container.appendChild(div);
        setupPorts(div.querySelectorAll('.port'));
    };

    const createNode = (type, x, y) => {
        const id = `node_${nextNodeId++}`;
        const nodeEl = document.createElement('div');
        nodeEl.className = 'flow-node';
        nodeEl.id = id;
        nodeEl.dataset.type = type;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        
        nodeEl.innerHTML = getNodeTemplate(type, id);
        nodesLayer.appendChild(nodeEl);
        
        nodes.set(id, { id, type, x, y, element: nodeEl });

        setupNodeDragging(nodeEl, id);
        setupPorts(nodeEl.querySelectorAll('.port'));

        // Populate variable dropdowns if they exist
        updateVariableDropdownsInNode(nodeEl);
    };

    const setupNodeDragging = (nodeEl, id) => {
        const header = nodeEl.querySelector('.node-header');
        let isDragging = false;
        let startX, startY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('node-delete')) return;
            isDragging = true;
            
            // Bring to front
            nodesLayer.appendChild(nodeEl);
            
            const rect = nodeEl.getBoundingClientRect();
            const wrapperRect = canvasWrapper.getBoundingClientRect();
            
            startX = (e.clientX - rect.left) / scale;
            startY = (e.clientY - rect.top) / scale;
            
            document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('selected'));
            nodeEl.classList.add('selected');
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const wrapperRect = canvasWrapper.getBoundingClientRect();
                const newX = (e.clientX - wrapperRect.left) / scale - startX;
                const newY = (e.clientY - wrapperRect.top) / scale - startY;
                
                nodeEl.style.left = `${newX}px`;
                nodeEl.style.top = `${newY}px`;
                
                const nodeData = nodes.get(id);
                nodeData.x = newX;
                nodeData.y = newY;
                
                updateConnections();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) isDragging = false;
        });
    };

    window.deleteNode = (id) => {
        if (id === 'node_0') return; // Cannot delete start node
        const node = nodes.get(id);
        if (node) {
            node.element.remove();
            nodes.delete(id);
            // Remove connected lines
            connections = connections.filter(conn => conn.source !== id && conn.target !== id);
            updateConnections();
        }
    };

    // ----- Connections -----
    
    const setupPorts = (ports) => {
        ports.forEach(port => {
            port.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if (port.classList.contains('port-out')) {
                    isDrawingConnection = true;
                    activeStartPort = port;
                }
            });

            port.addEventListener('mouseup', (e) => {
                e.stopPropagation();
                if (isDrawingConnection && activeStartPort && port.classList.contains('port-in')) {
                    const sourceNode = activeStartPort.dataset.nodeId;
                    const sourcePort = activeStartPort.dataset.portId;
                    const targetNode = port.dataset.nodeId;
                    
                    if (sourceNode !== targetNode) {
                        // Check if connection already exists
                        const exists = connections.some(c => c.source === sourceNode && c.sourcePort === sourcePort && c.target === targetNode);
                        if (!exists) {
                            // If it's a normal out port (not an option), remove existing out connections from this port
                            if (sourcePort === 'out') {
                                connections = connections.filter(c => !(c.source === sourceNode && c.sourcePort === 'out'));
                            }
                            
                            connections.push({
                                source: sourceNode,
                                sourcePort: sourcePort,
                                target: targetNode
                            });
                            updateConnections();
                        }
                    }
                }
                
                if (isDrawingConnection) {
                    isDrawingConnection = false;
                    activeStartPort = null;
                    if (tempLine) {
                        tempLine.remove();
                        tempLine = null;
                    }
                }
            });
        });
    };

    const drawTempLine = (x1, y1, x2, y2) => {
        if (!tempLine) {
            tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempLine.classList.add('connection-line', 'active');
            connectionsLayer.appendChild(tempLine);
        }
        
        // Bezier curve magic
        const ctrlX = Math.abs(x2 - x1) / 2 + 50;
        const d = `M ${x1} ${y1} C ${x1 + ctrlX} ${y1}, ${x2 - ctrlX} ${y2}, ${x2} ${y2}`;
        tempLine.setAttribute('d', d);
    };

    const updateConnections = () => {
        connectionsLayer.innerHTML = ''; // Clear lines
        const rect = canvasWrapper.getBoundingClientRect();

        connections.forEach((conn, index) => {
            const sourceNode = nodes.get(conn.source);
            const targetNode = nodes.get(conn.target);
            
            if (sourceNode && targetNode) {
                const outPort = sourceNode.element.querySelector(`.port-out[data-port-id="${conn.sourcePort}"]`);
                const inPort = targetNode.element.querySelector('.port-in');
                
                if (outPort && inPort) {
                    const outRect = outPort.getBoundingClientRect();
                    const inRect = inPort.getBoundingClientRect();
                    
                    const x1 = (outRect.left + outRect.width / 2 - rect.left) / scale;
                    const y1 = (outRect.top + outRect.height / 2 - rect.top) / scale;
                    const x2 = (inRect.left + inRect.width / 2 - rect.left) / scale;
                    const y2 = (inRect.top + inRect.height / 2 - rect.top) / scale;
                    
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.classList.add('connection-line');
                    
                    const ctrlX = Math.abs(x2 - x1) / 2 + 50;
                    const d = `M ${x1} ${y1} C ${x1 + ctrlX} ${y1}, ${x2 - ctrlX} ${y2}, ${x2} ${y2}`;
                    path.setAttribute('d', d);
                    
                    // Click to delete connection
                    path.addEventListener('click', (e) => {
                        e.stopPropagation();
                        connections.splice(index, 1);
                        updateConnections();
                    });

                    connectionsLayer.appendChild(path);
                }
            }
        });
    };

    // ----- Variables -----
    const varInput = document.getElementById('new-var-name');
    const addVarBtn = document.getElementById('add-var-btn');
    const varList = document.getElementById('variables-list');

    const updateVariablesList = () => {
        varList.innerHTML = '';
        variables.forEach(v => {
            const item = document.createElement('div');
            item.className = 'variable-item';
            item.innerHTML = `
                <span>${v}</span>
                <i class="ph-bold ph-trash" onclick="deleteVariable('${v}')"></i>
            `;
            varList.appendChild(item);
        });

        // Update all select dropdowns
        document.querySelectorAll('select.node-data[data-key="variable"]').forEach(select => {
            const currentVal = select.value;
            select.innerHTML = `<option value="">Select Variable...</option>` + 
                Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('');
            if (variables.has(currentVal)) {
                select.value = currentVal;
            }
        });
    };

    const updateVariableDropdownsInNode = (nodeEl) => {
        nodeEl.querySelectorAll('select.node-data[data-key="variable"]').forEach(select => {
            const currentVal = select.value;
            select.innerHTML = `<option value="">Select Variable...</option>` + 
                Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('');
            if (variables.has(currentVal)) {
                select.value = currentVal;
            }
        });
    };

    addVarBtn.addEventListener('click', () => {
        const name = varInput.value.trim().replace(/[^a-zA-Z0-9_]/g, '');
        if (name && !variables.has(name)) {
            variables.add(name);
            varInput.value = '';
            updateVariablesList();
        }
    });

    window.deleteVariable = (name) => {
        variables.delete(name);
        updateVariablesList();
    };

    // ----- Init -----
    const accountId = localStorage.getItem('activeAccountId');

    // Load a flow from saved data
    const loadFlowData = (flowData) => {
        // Clear existing state
        nodesLayer.innerHTML = '';
        connectionsLayer.innerHTML = '';
        nodes.clear();
        connections = [];
        variables.clear();

        // Restore variables first (needed for dropdown population)
        if (flowData.variables && flowData.variables.length > 0) {
            flowData.variables.forEach(v => variables.add(v));
            updateVariablesList();
        }

        // Determine next node ID from existing data
        let maxId = 0;
        flowData.nodes.forEach(n => {
            const num = parseInt(n.id.replace('node_', ''));
            if (num > maxId) maxId = num;
        });

        // Create nodes
        flowData.nodes.forEach(n => {
            nextNodeId = parseInt(n.id.replace('node_', ''));
            createNode(n.type, n.x, n.y);

            // Populate data fields
            const nodeEl = document.getElementById(n.id);
            if (nodeEl && n.data) {
                // Set simple fields
                Object.entries(n.data).forEach(([key, value]) => {
                    if (key === 'options') return; // handled separately
                    const el = nodeEl.querySelector(`.node-data[data-key="${key}"]`);
                    if (el) {
                        el.value = value;
                    }
                });

                // Set options for getOption nodes
                if (n.type === 'getOption' && n.data.options) {
                    const container = nodeEl.querySelector('.options-container');
                    if (container) {
                        // First option already exists from template
                        const existingOptions = container.querySelectorAll('.node-option');
                        n.data.options.forEach((opt, idx) => {
                            if (idx === 0 && existingOptions[0]) {
                                // Update the first existing option
                                const input = existingOptions[0].querySelector('.option-input');
                                if (input) {
                                    input.value = opt.value;
                                    input.dataset.optionId = opt.id;
                                }
                                const port = existingOptions[0].querySelector('.port-out');
                                if (port) port.dataset.portId = opt.id;
                            } else {
                                // Add additional options
                                addOption(n.id);
                                const allOpts = container.querySelectorAll('.node-option');
                                const lastOpt = allOpts[allOpts.length - 1];
                                if (lastOpt) {
                                    const input = lastOpt.querySelector('.option-input');
                                    if (input) {
                                        input.value = opt.value;
                                        input.dataset.optionId = opt.id;
                                    }
                                    const port = lastOpt.querySelector('.port-out');
                                    if (port) port.dataset.portId = opt.id;
                                }
                            }
                        });
                    }
                }
            }
        });

        nextNodeId = maxId + 1;

        // Restore connections
        connections = flowData.connections ? [...flowData.connections] : [];

        // Re-render connections after a tick so DOM is ready
        requestAnimationFrame(() => {
            updateConnections();
        });
    };

    // ----- Helper: extract current flow data -----
    const getFlowData = () => {
        return {
            nodes: Array.from(nodes.values()).map(n => {
                const data = {};
                n.element.querySelectorAll('.node-data').forEach(el => {
                    if (el.dataset.optionId) {
                        if (!data.options) data.options = [];
                        data.options.push({ id: el.dataset.optionId, value: el.value });
                    } else {
                        data[el.dataset.key] = el.value;
                    }
                });
                return {
                    id: n.id,
                    type: n.type,
                    x: n.x,
                    y: n.y,
                    data: data
                };
            }),
            connections: connections,
            variables: Array.from(variables)
        };
    };

    // Save Flow logic
    document.getElementById('save-flow-btn').addEventListener('click', async () => {
        const flowData = getFlowData();
        console.log('Saved Flow Data:', flowData);

        let compiled = null;
        try {
            compiled = FlowCompiler.compile(flowData.nodes, flowData.connections, flowData.variables);
            console.log('Compiled Flow:', compiled);
        } catch (err) {
            console.warn('Compilation failed, saving diagram only:', err.message);
        }

        if (!accountId) {
            alert('No account selected. Please select an account first.');
            return;
        }

        try {
            const res = await fetch('/api/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-account-id': accountId,
                    'x-auth-token': localStorage.getItem('token')
                },
                body: JSON.stringify({
                    flowData: flowData,
                    compiledFlow: compiled
                })
            });
            if (res.ok) {
                alert('Flow saved successfully!');
            } else {
                const errData = await res.json();
                alert('Error saving flow: ' + (errData.message || 'Unknown error'));
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Failed to save flow. Check your connection.');
        }
    });

    // Load saved flow on startup
    const loadSavedFlow = async () => {
        if (!accountId) {
            // No account — just create a default start node
            nextNodeId = 0;
            createNode('start', 100, window.innerHeight / 2 - 100);
            nextNodeId = 1;
            return;
        }

        try {
            const res = await fetch('/api/settings', {
                headers: {
                    'x-account-id': accountId,
                    'x-auth-token': localStorage.getItem('token')
                }
            });
            const settings = await res.json();

            if (settings.flowData && settings.flowData.nodes && settings.flowData.nodes.length > 0) {
                loadFlowData(settings.flowData);
                console.log('✅ Loaded saved flow from database.');
            } else {
                // No saved flow — create default start node
                nextNodeId = 0;
                createNode('start', 100, window.innerHeight / 2 - 100);
                nextNodeId = 1;
            }
        } catch (err) {
            console.error('Failed to load saved flow:', err);
            nextNodeId = 0;
            createNode('start', 100, window.innerHeight / 2 - 100);
            nextNodeId = 1;
        }
    };

    loadSavedFlow();

    // ----- Simulator -----
    const simulator = new FlowSimulator();
    simulator.init();

    document.getElementById('run-simulator-btn').addEventListener('click', () => {
        try {
            const flowData = getFlowData();
            const compiled = FlowCompiler.compile(flowData.nodes, flowData.connections, flowData.variables);
            console.log('Compiled Flow:', compiled);
            simulator.open(compiled);
        } catch (err) {
            alert('Compilation error: ' + err.message);
            console.error(err);
        }
    });
});

