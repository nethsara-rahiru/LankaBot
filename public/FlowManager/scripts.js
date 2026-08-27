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
        // Pan if clicking on any empty canvas area (not on a node or its children)
        const isCanvasArea = e.target === canvasContainer 
            || e.target === canvasWrapper 
            || e.target === nodesLayer 
            || e.target === connectionsLayer
            || e.target.tagName === 'svg';
        
        if (isCanvasArea && !e.target.closest('.flow-node')) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            canvasContainer.style.cursor = 'grabbing';
        }
    });

    // Touch: single-finger pan, two-finger pinch-to-zoom
    let touchStartDist = 0;
    let touchStartScale = 1;
    let touchPanStartX = 0;
    let touchPanStartY = 0;
    let touchIsPanning = false;

    const getTouchDist = (t1, t2) => {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    canvasContainer.addEventListener('touchstart', (e) => {
        if (e.target.closest('.port') || e.target.closest('.node-header')) return;
        if (e.target.closest('.flow-node') && !e.target.closest('.node-header')) return;

        if (e.touches.length === 1) {
            const isCanvasArea = e.target === canvasContainer
                || e.target === canvasWrapper
                || e.target === nodesLayer
                || e.target === connectionsLayer
                || e.target.tagName === 'svg';
            if (isCanvasArea && !e.target.closest('.flow-node')) {
                touchIsPanning = true;
                touchPanStartX = e.touches[0].clientX - panX;
                touchPanStartY = e.touches[0].clientY - panY;
            }
        } else if (e.touches.length === 2) {
            touchIsPanning = false;
            touchStartDist = getTouchDist(e.touches[0], e.touches[1]);
            touchStartScale = scale;
            touchPanStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            touchPanStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && touchIsPanning) {
            panX = e.touches[0].clientX - touchPanStartX;
            panY = e.touches[0].clientY - touchPanStartY;
            updateCanvasTransform();
        } else if (e.touches.length === 2) {
            const dist = getTouchDist(e.touches[0], e.touches[1]);
            const newScale = Math.max(0.2, Math.min(3, touchStartScale * (dist / touchStartDist)));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = canvasContainer.getBoundingClientRect();
            const localX = midX - rect.left;
            const localY = midY - rect.top;
            panX = localX - (localX - panX) * (newScale / scale);
            panY = localY - (localY - panY) * (newScale / scale);
            scale = newScale;
            updateCanvasTransform();
        }
    }, { passive: false });

    canvasContainer.addEventListener('touchend', () => {
        touchIsPanning = false;
    }, { passive: true });

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

    // Arrow key panning for diagram canvas
    window.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        if (active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' ||
            active.isContentEditable
        )) {
            return;
        }

        const step = e.shiftKey ? 100 : 40;
        if (e.key === 'ArrowUp') {
            panY += step;
            updateCanvasTransform();
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            panY -= step;
            updateCanvasTransform();
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            panX += step;
            updateCanvasTransform();
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            panX -= step;
            updateCanvasTransform();
            e.preventDefault();
        }
    });

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
            case 'newFlow':
                content = `
                    <input type="text" placeholder="Topic (Flow ID)" class="node-data" data-key="topic">
                    <input type="text" placeholder="Description" class="node-data" data-key="description" style="margin-top: 0.5rem; font-size: 0.8rem;">
                `;
                break;
            case 'say':
                content = `
                    <textarea placeholder="Message to send..." class="node-data" data-key="message"></textarea>
                    <input type="text" placeholder="Optional Media ID (from Storage)" class="node-data" data-key="mediaId" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                `;
                break;
            case 'sendMessage':
                content = `
                    <input type="text" placeholder="Phone Number (e.g. 94712345678 or {{phone}})" class="node-data" data-key="phone">
                    <textarea placeholder="Message to send..." class="node-data" data-key="message" style="margin-top: 0.5rem;"></textarea>
                    <input type="text" placeholder="Optional Image ID / Media ID" class="node-data" data-key="imageId" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                `;
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
            case 'if':
                content = `
                    <input type="text" placeholder="Variable 1 or Value" class="node-data" data-key="var1">
                    <select class="node-data" data-key="condition" style="margin-top: 0.5rem;">
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                    </select>
                    <input type="text" placeholder="Variable 2 or Value" class="node-data" data-key="var2" style="margin-top: 0.5rem;">
                `;
                break;
            case 'ifAI':
                content = `<input type="text" placeholder="AI Prompt (returns true/false)" class="node-data" data-key="prompt">`;
                break;
            case 'catalogSelector':
                content = `
                    <input type="text" placeholder="Prompt message (e.g. Which item would you like to select?)" class="node-data" data-key="prompt">
                    <select class="node-data catalog-type-dropdown" data-key="itemType" style="margin-top: 0.5rem;" onchange="loadCatalogOptions('${id}', this.value)">
                        <option value="">All Catalog Types</option>
                    </select>
                    <input type="text" placeholder="AI Prompt (Optional instructions for item selection)" class="node-data" data-key="aiPrompt" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                    <div class="catalog-options-container" id="catalog-options-${id}" style="margin-top: 0.5rem;">
                        <div style="font-size: 0.78rem; color: var(--text-dim); padding: 0.4rem 0; display:flex; align-items:center; gap:0.4rem;">
                            <i class="ph-bold ph-circle-notch" style="animation: spin 1s linear infinite;"></i> Loading catalog items...
                        </div>
                    </div>
                    <select class="node-data" data-key="variable" style="margin-top: 0.5rem;">
                        <option value="">Save Selected Item to Variable...</option>
                        ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                break;
            case 'variantSelector':
                content = `
                    <select class="node-data" data-key="productMode" style="margin-bottom: 0.5rem; width: 100%;" onchange="toggleVariantProductMode('${id}', this.value)">
                        <option value="dropdown">Select Product (Dropdown)</option>
                        <option value="variable">Use Product Variable</option>
                    </select>
                    
                    <div id="product-dropdown-container-${id}">
                        <select class="node-data product-list-dropdown" data-key="productId" style="width: 100%;">
                            <option value="">Loading Products...</option>
                        </select>
                    </div>

                    <div id="product-variable-container-${id}" style="display: none;">
                        <select class="node-data" data-key="productVariable" style="width: 100%;">
                            <option value="">Select Product Variable...</option>
                            ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                        </select>
                    </div>

                    <input type="text" placeholder="Prompt message (e.g. Select a size/variant for {{productName}})" class="node-data" data-key="prompt" style="margin-top: 0.5rem;">
                    <input type="text" placeholder="AI Prompt (Optional variant extraction instructions)" class="node-data" data-key="aiPrompt" style="margin-top: 0.5rem; font-size: 0.8rem; background: rgba(52, 152, 219, 0.05); border-color: rgba(52, 152, 219, 0.2);">
                    
                    <select class="node-data" data-key="variable" style="margin-top: 0.5rem;">
                        <option value="">Save Selected Variant to Variable...</option>
                        ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                break;
            case 'showProductCard':
                content = `
                    <select class="node-data" data-key="productMode" style="margin-bottom: 0.5rem; width: 100%;" onchange="toggleVariantProductMode('${id}', this.value)">
                        <option value="dropdown">Select Product (Dropdown)</option>
                        <option value="variable">Use Product Variable</option>
                    </select>
                    
                    <div id="product-dropdown-container-${id}">
                        <select class="node-data product-list-dropdown" data-key="productId" style="width: 100%;">
                            <option value="">Loading Products...</option>
                        </select>
                    </div>

                    <div id="product-variable-container-${id}" style="display: none;">
                        <select class="node-data" data-key="productVariable" style="width: 100%;">
                            <option value="">Select Product Variable...</option>
                            ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                        </select>
                    </div>

                    <input type="text" placeholder="Card Message Template (Optional override, e.g. 🏷️ *{{name}}*\nRs. {{price}})" class="node-data" data-key="cardTemplate" style="margin-top: 0.5rem; font-size: 0.8rem;">
                `;
                break;
            case 'showCatalog':
                content = `
                    <p style="margin:0 0 0.5rem; font-size: 0.8rem; color: var(--text-dim);">Send catalog items using the configured Menu Style template.</p>
                    <select class="node-data catalog-type-dropdown" data-key="itemType">
                        <option value="">All Items</option>
                    </select>
                    <select class="node-data menu-style-dropdown" data-key="menuStyle" style="margin-top: 0.5rem;">
                        <option value="">Default Menu Style</option>
                    </select>
                `;
                break;
            case 'arrayManager':
                content = `
                    <select class="node-data" data-key="action">
                        <option value="push">Add Item (Push)</option>
                        <option value="edit">Edit Item</option>
                        <option value="delete">Delete Item</option>
                        <option value="clear">Clear Array</option>
                    </select>
                    <select class="node-data" data-key="variable" style="margin-top: 0.5rem;">
                        <option value="">Target Variable...</option>
                        ${Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('')}
                    </select>
                `;
                break;
            case 'placeOrder':
                const getManualOrderFields = () => {
                    const aId = localStorage.getItem('activeAccountId');
                    let cols = [
                        { id: 'customer', label: 'Customer', key: 'customer', defaultVar: '{{customer}}' },
                        { id: 'items', label: 'Items', key: 'items', defaultVar: '{{cart}}' }
                    ];
                    try {
                        const saved = localStorage.getItem(`order_columns_${aId}`);
                        if (saved) {
                            const parsed = JSON.parse(saved);
                            parsed.forEach(c => {
                                if (['orderId', 'status', 'date'].includes(c.id)) return; // skip auto system fields
                                const existingIndex = cols.findIndex(item => item.id === c.id || item.key === c.key);
                                if (existingIndex !== -1) {
                                    cols[existingIndex].label = c.label;
                                } else {
                                    cols.push({
                                        id: c.id,
                                        label: c.label,
                                        key: c.key || c.id,
                                        defaultVar: `{{${c.key || c.id}}}`
                                    });
                                }
                            });
                        }
                    } catch (e) {}
                    return cols;
                };

                const fieldsToRender = getManualOrderFields();
                content = `
                    <p style="margin:0 0 0.5rem 0; font-size: 0.78rem; color: var(--text-dim);">Map manual data entry columns to variables or values:</p>
                    <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                        ${fieldsToRender.map(f => `
                            <div class="order-field-row" style="display:flex; align-items:center; justify-space-between; gap:0.4rem;">
                                <label style="font-size:0.75rem; color:var(--text-dim); min-width:100px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${f.label}">${f.label}:</label>
                                <input type="text" placeholder="e.g. ${f.defaultVar}" class="node-data" data-key="field_${f.key}" style="font-size:0.78rem; padding:0.25rem 0.4rem; flex:1;">
                            </div>
                        `).join('')}
                    </div>
                `;
                break;
        }

        const nodeLabels = {
            say: 'say()',
            sendMessage: 'Send Message',
            get: 'get(var)',
            getOption: 'getOption(list)',
            wait: 'wait()',
            if: 'If',
            ifAI: 'If (AI)',
            catalogSelector: 'Catalog Selector',
            variantSelector: 'Variant Selector',
            showProductCard: 'Show Product Card',
            showCatalog: 'Show Catalog',
            arrayManager: 'Array Manager',
            placeOrder: 'Place Order',
            newFlow: 'New Flow'
        };
        const nodeIcons = {
            say: 'ph-chat-circle-text',
            sendMessage: 'ph-paper-plane-tilt',
            get: 'ph-download-simple',
            getOption: 'ph-list-dashes',
            wait: 'ph-clock',
            if: 'ph-git-merge',
            ifAI: 'ph-brain',
            catalogSelector: 'ph-storefront',
            variantSelector: 'ph-swatchbook',
            showProductCard: 'ph-card',
            showCatalog: 'ph-list-numbers',
            arrayManager: 'ph-list-plus',
            placeOrder: 'ph-shopping-cart',
            newFlow: 'ph-file-plus'
        };
        const label = nodeLabels[type] || type;
        const icon = nodeIcons[type] || 'ph-cube';

        return `
            <div class="port port-in" data-node-id="${id}" data-port-id="in"></div>
            <div class="node-header">
                <i class="ph-bold ${icon}"></i>
                <span>${label}</span>
                <i class="ph-bold ph-trash node-delete" onclick="deleteNode('${id}')"></i>
            </div>
            <div class="node-content">
                ${content}
            </div>
            ${(type === 'if' || type === 'ifAI') ? `
                <div class="port-container" style="display: flex; justify-content: space-between; position: relative; bottom: -8px; width: 100%;">
                    <div class="port port-out" data-node-id="${id}" data-port-id="true" style="position: static; margin-left: -5px; transform: none; background: #2ecc71; border-color: #27ae60;" title="True"></div>
                    <div class="port port-out" data-node-id="${id}" data-port-id="false" style="position: static; margin-right: -5px; transform: none; background: #e74c3c; border-color: #c0392b;" title="False"></div>
                </div>
            ` : (type !== 'getOption' && type !== 'catalogSelector' ? `<div class="port port-out" data-node-id="${id}" data-port-id="out"></div>` : '')}
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

    // Render catalog items — each item gets its own output port for per-item branching
    const renderCatalogOptions = (nodeId, items) => {
        const container = document.getElementById(`catalog-options-${nodeId}`);
        if (!container) return;

        container.innerHTML = '';

        if (!items || items.length === 0) {
            container.innerHTML = `<div style="font-size:0.78rem; color:var(--text-dim); padding:0.4rem 0;">No catalog items found. Add items in the Catalog Manager.</div>`;
            return;
        }

        items.forEach((item, idx) => {
            const name = item.fields?.name || item.name || `Item ${idx + 1}`;
            const price = item.fields?.price !== undefined ? ` • Rs. ${item.fields.price}` : '';
            const category = item.fields?.category || item.category || '';
            // Use _id as port ID so each item has a stable, unique port
            const portId = `cat_${item._id || item.id || idx}`;

            const div = document.createElement('div');
            div.className = 'node-option catalog-item-option';
            div.dataset.portId = portId;
            div.dataset.itemName = name;
            div.innerHTML = `
                <span class="item-name" style="flex:1; font-size:0.82rem; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${name}${price}${category ? ' — ' + category : ''}">${name}<span style="color:var(--text-dim);font-size:0.75rem;">${price}</span></span>
                <div class="port port-out" data-node-id="${nodeId}" data-port-id="${portId}" title="${name}"></div>
            `;
            container.appendChild(div);
        });

        // Wire up ports for the newly added items
        setupPorts(container.querySelectorAll('.port'));

        // Re-draw lines after ports are mounted
        requestAnimationFrame(() => updateConnections());
    };

    // Fetch catalog items from API and render as option rows
    window.loadCatalogOptions = async (nodeId, itemType) => {
        const container = document.getElementById(`catalog-options-${nodeId}`);
        if (!container) return;

        container.innerHTML = `<div style="font-size:0.78rem; color:var(--text-dim); padding:0.4rem 0; display:flex; align-items:center; gap:0.4rem;"><i class="ph-bold ph-circle-notch" style="animation:spin 1s linear infinite;"></i> Loading...</div>`;

        try {
            const aId = localStorage.getItem('activeAccountId');
            const tok = localStorage.getItem('token');
            const url = `/api/catalog${itemType ? '?type=' + encodeURIComponent(itemType) : ''}`;
            const res = await fetch(url, {
                headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
            });
            if (res.ok) {
                const items = await res.json();
                renderCatalogOptions(nodeId, items);
            } else {
                container.innerHTML = `<div style="font-size:0.78rem; color:#e74c3c; padding:0.4rem 0;">Error loading catalog items.</div>`;
            }
        } catch (e) {
            console.error('Failed to load catalog for node:', e);
            container.innerHTML = `<div style="font-size:0.78rem; color:#e74c3c; padding:0.4rem 0;">Error: ${e.message}</div>`;
        }
    };

    const createNode = (type, x, y, customId = null) => {
        const id = customId || `node_${nextNodeId++}`;
        if (customId) {
            const num = parseInt(customId.replace('node_', ''), 10);
            if (!isNaN(num) && num >= nextNodeId) nextNodeId = num + 1;
        }
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

        // For catalogSelector: async-fetch catalog items and render as option ports
        if (type === 'catalogSelector') {
            loadCatalogOptions(id, '');
        }
    };

    const setupNodeDragging = (nodeEl, id) => {
        const header = nodeEl.querySelector('.node-header');
        let isDragging = false;
        let startX, startY;

        // Mouse drag
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('node-delete')) return;
            isDragging = true;
            nodesLayer.appendChild(nodeEl);
            const rect = nodeEl.getBoundingClientRect();
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

        // Touch drag
        let touchDragging = false;
        let touchStartX, touchStartY;

        header.addEventListener('touchstart', (e) => {
            if (e.target.classList.contains('node-delete')) return;
            if (e.touches.length !== 1) return;
            e.stopPropagation();
            touchDragging = true;
            nodesLayer.appendChild(nodeEl);
            const touch = e.touches[0];
            const rect = nodeEl.getBoundingClientRect();
            touchStartX = (touch.clientX - rect.left) / scale;
            touchStartY = (touch.clientY - rect.top) / scale;
            document.querySelectorAll('.flow-node').forEach(n => n.classList.remove('selected'));
            nodeEl.classList.add('selected');
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (touchDragging && e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                const wrapperRect = canvasWrapper.getBoundingClientRect();
                const newX = (touch.clientX - wrapperRect.left) / scale - touchStartX;
                const newY = (touch.clientY - wrapperRect.top) / scale - touchStartY;
                nodeEl.style.left = `${newX}px`;
                nodeEl.style.top = `${newY}px`;
                const nodeData = nodes.get(id);
                nodeData.x = newX;
                nodeData.y = newY;
                updateConnections();
            }
        }, { passive: false });

        window.addEventListener('touchend', () => {
            if (touchDragging) touchDragging = false;
        }, { passive: true });
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
            // Mouse connection drawing
            port.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if (port.classList.contains('port-out')) {
                    isDrawingConnection = true;
                    activeStartPort = port;
                    port.classList.add('active');
                }
            });

            port.addEventListener('mouseup', (e) => {
                e.stopPropagation();
                finishConnection(port);
            });

            // Touch connection drawing
            port.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                if (port.classList.contains('port-out')) {
                    isDrawingConnection = true;
                    activeStartPort = port;
                    port.classList.add('active');
                }
            }, { passive: true });

            port.addEventListener('touchend', (e) => {
                e.stopPropagation();
                // Find the element under the finger
                if (e.changedTouches.length > 0) {
                    const touch = e.changedTouches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const portTarget = target ? target.closest('.port') : null;
                    if (portTarget && portTarget !== port) {
                        finishConnection(portTarget);
                    } else {
                        cancelConnection();
                    }
                }
            }, { passive: true });
        });
    };

    const finishConnection = (port) => {
        if (isDrawingConnection && activeStartPort && port.classList.contains('port-in')) {
            const sourceNode = activeStartPort.dataset.nodeId;
            const sourcePort = activeStartPort.dataset.portId;
            const targetNode = port.dataset.nodeId;
            if (sourceNode !== targetNode) {
                const exists = connections.some(c => c.source === sourceNode && c.sourcePort === sourcePort && c.target === targetNode);
                if (!exists) {
                    if (sourcePort === 'out') {
                        connections = connections.filter(c => !(c.source === sourceNode && c.sourcePort === 'out'));
                    }
                    connections.push({ source: sourceNode, sourcePort: sourcePort, target: targetNode });
                    updateConnections();
                }
            }
        }
        cancelConnection();
    };

    const cancelConnection = () => {
        if (activeStartPort) activeStartPort.classList.remove('active');
        isDrawingConnection = false;
        activeStartPort = null;
        if (tempLine) { tempLine.remove(); tempLine = null; }
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
                        connections = connections.filter(c => !(c.source === conn.source && c.sourcePort === conn.sourcePort && c.target === conn.target));
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
        document.querySelectorAll('select.node-data[data-key="variable"], select.node-data[data-key="productVariable"]').forEach(select => {
            const currentVal = select.value;
            const placeholder = select.getAttribute('data-key') === 'productVariable' ? 'Select Product Variable...' : 'Select Variable...';
            select.innerHTML = `<option value="">${placeholder}</option>` + 
                Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('');
            if (variables.has(currentVal)) {
                select.value = currentVal;
            }
        });
    };

    window.toggleVariantProductMode = (nodeId, mode) => {
        const dropdownContainer = document.getElementById(`product-dropdown-container-${nodeId}`);
        const variableContainer = document.getElementById(`product-variable-container-${nodeId}`);
        if (dropdownContainer && variableContainer) {
            if (mode === 'variable') {
                dropdownContainer.style.display = 'none';
                variableContainer.style.display = 'block';
            } else {
                dropdownContainer.style.display = 'block';
                variableContainer.style.display = 'none';
            }
        }
    };

    const updateVariableDropdownsInNode = (nodeEl) => {
        nodeEl.querySelectorAll('select.node-data[data-key="variable"], select.node-data[data-key="productVariable"]').forEach(select => {
            const currentVal = select.value;
            const placeholder = select.getAttribute('data-key') === 'productVariable' ? 'Select Product Variable...' : 'Select Variable...';
            select.innerHTML = `<option value="">${placeholder}</option>` + 
                Array.from(variables).map(v => `<option value="${v}">${v}</option>`).join('');
            if (variables.has(currentVal)) {
                select.value = currentVal;
            }
        });
        populateCatalogTypeDropdownsInNode(nodeEl);
        populateMenuStyleDropdownsInNode(nodeEl);
        populateProductDropdownInNode(nodeEl);
    };

    const populateProductDropdownInNode = async (nodeEl) => {
        const selects = nodeEl ? nodeEl.querySelectorAll('select.product-list-dropdown') : document.querySelectorAll('select.product-list-dropdown');
        if (!selects || selects.length === 0) return;

        try {
            const aId = localStorage.getItem('activeAccountId');
            const tok = localStorage.getItem('token');
            const res = await fetch('/api/catalog', {
                headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
            });
            if (res.ok) {
                const items = await res.json();
                selects.forEach(select => {
                    const currentVal = select.value;
                    let html = `<option value="">Select a Product...</option>`;
                    items.forEach(item => {
                        const name = item.fields?.name || item.name || 'Unnamed Product';
                        const price = item.fields?.price !== undefined ? ` (Rs. ${item.fields.price})` : '';
                        const idVal = item._id || item.id;
                        html += `<option value="${idVal}">${name}${price}</option>`;
                    });
                    select.innerHTML = html;
                    if (currentVal) select.value = currentVal;
                });
            }
        } catch (e) {
            console.error('Failed to populate product dropdowns for variant selector:', e);
        }
    };

    const populateCatalogTypeDropdownsInNode = async (nodeEl) => {
        const selects = nodeEl ? nodeEl.querySelectorAll('select.catalog-type-dropdown') : document.querySelectorAll('select.catalog-type-dropdown');
        if (!selects || selects.length === 0) return;

        try {
            const aId = localStorage.getItem('activeAccountId');
            const tok = localStorage.getItem('token');
            const res = await fetch('/api/settings', {
                headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
            });
            if (res.ok) {
                const settings = await res.json();
                const types = (Array.isArray(settings.customCatalogTypes) && settings.customCatalogTypes.length > 0)
                    ? settings.customCatalogTypes
                    : ['product', 'service'];
                
                selects.forEach(select => {
                    const currentVal = select.value;
                    let html = `<option value="">All Catalog Types</option>`;
                    types.forEach(t => {
                        const label = t.charAt(0).toUpperCase() + t.slice(1);
                        html += `<option value="${t}">${label}s Only</option>`;
                    });
                    select.innerHTML = html;
                    if (currentVal) select.value = currentVal;
                });
            }
        } catch (e) {
            console.error('Failed to populate catalog type dropdowns:', e);
        }
    };

    const populateMenuStyleDropdownsInNode = async (nodeEl) => {
        const selects = nodeEl ? nodeEl.querySelectorAll('select.menu-style-dropdown') : document.querySelectorAll('select.menu-style-dropdown');
        if (!selects || selects.length === 0) return;

        try {
            const aId = localStorage.getItem('activeAccountId');
            const tok = localStorage.getItem('token');
            const res = await fetch('/api/settings', {
                headers: { 'x-account-id': aId || '', 'x-auth-token': tok || '' }
            });
            if (res.ok) {
                const settings = await res.json();
                const styles = (Array.isArray(settings.menuStyles) && settings.menuStyles.length > 0)
                    ? settings.menuStyles
                    : [{ id: 'default', name: 'Default' }];

                selects.forEach(select => {
                    const currentVal = select.value;
                    let html = `<option value="">Default Menu Style</option>`;
                    styles.forEach(s => {
                        html += `<option value="${s.name}">${s.name}</option>`;
                    });
                    select.innerHTML = html;
                    if (currentVal) select.value = currentVal;
                });
            }
        } catch (e) {
            console.error('Failed to populate menu style dropdowns:', e);
        }
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
            createNode(n.type, n.x, n.y, n.id);

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

                // Restore catalogSelector: async-refresh items from API (display only, no per-item ports)
                if (n.type === 'catalogSelector') {
                    loadCatalogOptions(n.id, n.data.itemType || '');
                }

                if (n.type === 'variantSelector' || n.type === 'showProductCard') {
                    if (n.data.productMode) {
                        toggleVariantProductMode(n.id, n.data.productMode);
                    }
                    populateProductDropdownInNode(nodeEl);
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
                if (n.type === 'catalogSelector') {
                    data.catalogOptions = [];
                    n.element.querySelectorAll('.catalog-item-option').forEach(el => {
                        const portId = el.dataset.portId;
                        const value = el.dataset.itemName || (el.querySelector('.item-name') ? el.querySelector('.item-name').textContent : el.textContent);
                        data.catalogOptions.push({ id: portId, value: value });
                    });
                }
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

    // ----- Mobile Sidebar Controls -----
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    const backdrop = document.getElementById('mobile-backdrop');

    const closeSidebars = () => {
        leftSidebar.classList.remove('mobile-open');
        rightSidebar.classList.remove('mobile-open');
        backdrop.classList.remove('active');
    };

    document.getElementById('toggle-nodes-btn').addEventListener('click', () => {
        const isOpen = leftSidebar.classList.contains('mobile-open');
        closeSidebars();
        if (!isOpen) {
            leftSidebar.classList.add('mobile-open');
            backdrop.classList.add('active');
        }
    });

    document.getElementById('toggle-vars-btn').addEventListener('click', () => {
        const isOpen = rightSidebar.classList.contains('mobile-open');
        closeSidebars();
        if (!isOpen) {
            rightSidebar.classList.add('mobile-open');
            backdrop.classList.add('active');
        }
    });

    document.getElementById('close-nodes-btn').addEventListener('click', closeSidebars);
    document.getElementById('close-vars-btn').addEventListener('click', closeSidebars);
    backdrop.addEventListener('click', closeSidebars);

    // ----- Mobile: FAB + Tap-to-Add node -----
    // On mobile, drag-and-drop from palette doesn't work, so tapping a palette item adds the node to the center of the canvas
    const isTouchDevice = () => window.matchMedia('(max-width: 768px)').matches || ('ontouchstart' in window);

    document.querySelectorAll('.palette-item').forEach(item => {
        item.addEventListener('click', () => {
            if (!isTouchDevice()) return; // Only on mobile — desktop uses drag
            const type = item.dataset.type;
            if (!type) return;
            // Place at canvas center
            const rect = canvasContainer.getBoundingClientRect();
            const cx = (rect.width / 2 - panX) / scale;
            const cy = (rect.height / 2 - panY) / scale;
            createNode(type, cx - 120, cy - 50);
            closeSidebars();
        });
    });

    // FAB: open the nodes sidebar
    const fab = document.getElementById('add-node-fab');
    if (fab) {
        fab.addEventListener('click', () => {
            const isOpen = leftSidebar.classList.contains('mobile-open');
            closeSidebars();
            if (!isOpen) {
                leftSidebar.classList.add('mobile-open');
                backdrop.classList.add('active');
            }
        });
    }

    // Also update touchmove for connection drawing on ports
    window.addEventListener('touchmove', (e) => {
        if (isDrawingConnection && activeStartPort) {
            const touch = e.touches[0];
            const rect = canvasWrapper.getBoundingClientRect();
            const mouseX = (touch.clientX - rect.left) / scale;
            const mouseY = (touch.clientY - rect.top) / scale;
            const startRect = activeStartPort.getBoundingClientRect();
            const startX = (startRect.left + startRect.width / 2 - rect.left) / scale;
            const startY = (startRect.top + startRect.height / 2 - rect.top) / scale;
            drawTempLine(startX, startY, mouseX, mouseY);
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (isDrawingConnection) cancelConnection();
    }, { passive: true });
});

