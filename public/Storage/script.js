document.addEventListener('DOMContentLoaded', () => {
    // Basic DOM elements
    const uploadBtn = document.getElementById('upload-btn');
    const uploadModal = document.getElementById('upload-modal');
    const moveModal = document.getElementById('move-modal');
    const closeBtns = document.querySelectorAll('.close-btn, .close-btn-action');
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('upload-dropzone');
    const newFolderBtn = document.getElementById('new-folder-btn');
    const searchInput = document.getElementById('search-input');
    const refreshBtn = document.getElementById('refresh-btn');
    const breadcrumb = document.getElementById('breadcrumb');
    const folderTreeContainer = document.getElementById('folder-tree');
    
    // Preview panel elements
    const previewEmpty = document.getElementById('preview-empty');
    const previewContent = document.getElementById('preview-content');
    const previewVisual = document.getElementById('preview-visual');
    const previewFilename = document.getElementById('preview-filename');
    const previewType = document.getElementById('preview-type');
    const previewSize = document.getElementById('preview-size');
    const previewDate = document.getElementById('preview-date');
    const previewId = document.getElementById('preview-id');
    const downloadBtn = document.getElementById('preview-download-btn');
    const moveBtn = document.getElementById('preview-move-btn');
    const deleteBtn = document.getElementById('preview-delete-btn');

    // Move modal elements
    const moveFolderSelectList = document.getElementById('move-folder-select-list');
    const moveItemTitle = document.getElementById('move-item-title');
    const confirmMoveBtn = document.getElementById('confirm-move-btn');

    // App state
    let currentFolderId = 'root';
    let breadcrumbStack = [{ id: 'root', name: 'Root' }];
    let currentSelectedItem = null; // { type: 'file'|'folder', data: object }
    let selectedMoveTargetFolderId = null;
    let allUserFolders = [];
    let draggedItemPayload = null;

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '../login.html';
        return;
    }

    const headers = {
        'x-auth-token': token
    };

    // Open Upload Modal
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            uploadModal.classList.add('active');
        });
    }

    // Close Modals
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        });
    });

    // Dropzone Drag & Drop for Uploads
    if (dropzone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
        });

        dropzone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFiles(e.dataTransfer.files);
            }
        }, false);

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', function() { handleFiles(this.files); });
    }

    async function handleFiles(files) {
        if (files.length === 0) return;
        
        for (let file of files) {
            const formData = new FormData();
            formData.append('file', file);
            if (currentFolderId !== 'root') {
                formData.append('folderId', currentFolderId);
            }

            try {
                const res = await fetch('/api/storage/upload', {
                    method: 'POST',
                    headers: { 'x-auth-token': token },
                    body: formData
                });
                if (res.status === 401) {
                    window.location.href = '../login.html';
                    return;
                }
                if (!res.ok) {
                    const data = await res.json();
                    alert(`Failed to upload ${file.name}: ${data.error || data.msg}`);
                }
            } catch (err) {
                console.error(err);
            }
        }
        
        uploadModal.classList.remove('active');
        loadFolderContents(currentFolderId);
        loadFolderTree();
        loadUsage();
    }
    
    // New Folder
    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', async () => {
            const name = prompt('Enter folder name:');
            if (!name) return;
            
            try {
                const body = { name };
                if (currentFolderId !== 'root') body.parentId = currentFolderId;
                
                const res = await fetch('/api/storage/folder', {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                if (res.ok) {
                    loadFolderContents(currentFolderId);
                    loadFolderTree();
                } else {
                    const data = await res.json();
                    alert(data.error || 'Failed to create folder');
                }
            } catch (err) {
                console.error(err);
            }
        });
    }
    
    // Refresh Button
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadFolderContents(currentFolderId);
            loadFolderTree();
            loadUsage();
        });
    }

    // Search Filter
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            const items = document.querySelectorAll('#file-grid .file-item');
            items.forEach(item => {
                const name = item.querySelector('.file-name')?.innerText.toLowerCase() || '';
                if (name.includes(term)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    // Fetch all folders for tree and move dialog
    async function fetchAllFolders() {
        try {
            const res = await fetch('/api/storage/folders/all', { headers });
            if (res.ok) {
                allUserFolders = await res.json();
            }
        } catch (err) {
            console.error('Error fetching folders:', err);
        }
    }

    // Render Sidebar Folder Tree
    async function loadFolderTree() {
        await fetchAllFolders();
        if (!folderTreeContainer) return;

        folderTreeContainer.innerHTML = '';

        // Root Folder Tree Item
        const rootTreeItem = document.createElement('div');
        rootTreeItem.className = `tree-item ${currentFolderId === 'root' ? 'active' : ''}`;
        rootTreeItem.dataset.id = 'root';
        rootTreeItem.innerHTML = `<i class="ph-fill ph-house"></i> <span>Root</span>`;
        rootTreeItem.onclick = () => navigateToFolder('root', 'Root');
        setupDropTarget(rootTreeItem, 'root');
        folderTreeContainer.appendChild(rootTreeItem);

        // Build hierarchy map
        const childrenMap = {};
        allUserFolders.forEach(f => {
            const pId = f.parentId ? f.parentId.toString() : 'root';
            if (!childrenMap[pId]) childrenMap[pId] = [];
            childrenMap[pId].push(f);
        });

        function renderTreeNodes(parentId, level) {
            const nodes = childrenMap[parentId] || [];
            nodes.forEach(folder => {
                const item = document.createElement('div');
                item.className = `tree-item ${currentFolderId === folder._id ? 'active' : ''}`;
                item.dataset.id = folder._id;
                item.style.paddingLeft = `${0.8 + level * 0.8}rem`;
                item.innerHTML = `<i class="ph-fill ph-folder"></i> <span>${folder.name}</span>`;
                item.onclick = (e) => {
                    e.stopPropagation();
                    navigateToFolder(folder._id, folder.name);
                };
                setupDropTarget(item, folder._id);
                folderTreeContainer.appendChild(item);

                renderTreeNodes(folder._id.toString(), level + 1);
            });
        }

        renderTreeNodes('root', 1);
    }

    // Navigate to a specific folder
    function navigateToFolder(folderId, folderName) {
        currentFolderId = folderId;

        // Rebuild breadcrumb stack
        if (folderId === 'root') {
            breadcrumbStack = [{ id: 'root', name: 'Root' }];
        } else {
            // Reconstruct path from allUserFolders
            const path = [];
            let curr = allUserFolders.find(f => f._id === folderId);
            while (curr) {
                path.unshift({ id: curr._id, name: curr.name });
                curr = allUserFolders.find(f => f._id === (curr.parentId ? curr.parentId.toString() : null));
            }
            breadcrumbStack = [{ id: 'root', name: 'Root' }, ...path];
        }

        updateBreadcrumbUI();
        loadFolderContents(currentFolderId);
        loadFolderTree();
        clearPreview();
    }

    function updateBreadcrumbUI() {
        if (!breadcrumb) return;
        breadcrumb.innerHTML = '';
        breadcrumbStack.forEach((crumb, index) => {
            const span = document.createElement('span');
            span.className = 'crumb';
            span.dataset.id = crumb.id;
            span.innerText = crumb.name;
            span.onclick = () => {
                breadcrumbStack = breadcrumbStack.slice(0, index + 1);
                currentFolderId = crumb.id;
                updateBreadcrumbUI();
                loadFolderContents(currentFolderId);
                loadFolderTree();
                clearPreview();
            };
            setupDropTarget(span, crumb.id);
            breadcrumb.appendChild(span);
        });
    }

    // Load main content area folder contents
    async function loadFolderContents(folderId) {
        const fileGrid = document.getElementById('file-grid');
        const emptyState = document.getElementById('empty-state');
        
        try {
            const res = await fetch(`/api/storage/list/${folderId}`, { headers });
            if (res.status === 401) {
                window.location.href = '../login.html';
                return;
            }
            const data = await res.json();
            
            if (!data.folders || !data.files) {
                console.error('Unexpected storage API response:', data);
                return;
            }

            fileGrid.innerHTML = '';
            
            if (data.folders.length === 0 && data.files.length === 0) {
                emptyState.style.display = 'flex';
            } else {
                emptyState.style.display = 'none';
                
                // Render Folders
                data.folders.forEach(folder => {
                    const el = document.createElement('div');
                    el.className = 'file-item';
                    el.draggable = true;
                    el.dataset.id = folder._id;
                    el.dataset.type = 'folder';

                    el.innerHTML = `<i class="ph-fill ph-folder file-icon folder"></i><span class="file-name">${folder.name}</span>`;
                    
                    // Single click selects & previews folder info
                    el.onclick = (e) => {
                        e.stopPropagation();
                        selectGridItem(el, 'folder', folder);
                    };

                    // Double click enters folder
                    el.ondblclick = (e) => {
                        e.stopPropagation();
                        navigateToFolder(folder._id, folder.name);
                    };

                    setupDraggableSource(el, { id: folder._id, type: 'folder', name: folder.name });
                    setupDropTarget(el, folder._id);

                    fileGrid.appendChild(el);
                });
                
                // Render Files
                data.files.forEach(file => {
                    const el = document.createElement('div');
                    el.className = 'file-item';
                    el.draggable = true;
                    el.dataset.id = file._id;
                    el.dataset.type = 'file';
                    
                    let iconClass = 'ph-file';
                    let colorClass = '';
                    if (file.type === 'image') { iconClass = 'ph-image'; colorClass = 'image'; }
                    else if (file.type === 'pdf') { iconClass = 'ph-file-pdf'; colorClass = 'pdf'; }
                    else if (file.type === 'video') { iconClass = 'ph-video-camera'; colorClass = 'video'; }
                    else if (file.type === 'audio') { iconClass = 'ph-speaker-hifi'; }
                    
                    el.innerHTML = `<i class="ph-fill ${iconClass} file-icon ${colorClass}"></i><span class="file-name">${file.originalName}</span>`;
                    
                    el.onclick = (e) => {
                        e.stopPropagation();
                        selectGridItem(el, 'file', file);
                    };

                    setupDraggableSource(el, { id: file._id, type: 'file', name: file.originalName });

                    fileGrid.appendChild(el);
                });
            }
        } catch (err) {
            console.error(err);
        }
    }

    // Grid selection helper
    function selectGridItem(element, type, itemData) {
        document.querySelectorAll('#file-grid .file-item').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        currentSelectedItem = { type, data: itemData };
        
        if (type === 'file') {
            showPreview(itemData);
        } else {
            showFolderPreview(itemData);
        }
    }

    function clearPreview() {
        currentSelectedItem = null;
        if (previewEmpty) previewEmpty.style.display = 'flex';
        if (previewContent) previewContent.style.display = 'none';
        if (previewVisual) previewVisual.innerHTML = '';
    }

    // Drag and Drop move functionality setup
    function setupDraggableSource(element, payload) {
        element.addEventListener('dragstart', (e) => {
            draggedItemPayload = payload;
            e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            e.dataTransfer.effectAllowed = 'move';
            element.classList.add('dragging');
        });

        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            draggedItemPayload = null;
            document.querySelectorAll('.drag-over-folder').forEach(el => el.classList.remove('drag-over-folder'));
        });
    }

    function setupDropTarget(element, targetFolderId) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedItemPayload) return;

            // Don't allow dropping a folder onto itself
            if (draggedItemPayload.type === 'folder' && draggedItemPayload.id === targetFolderId) {
                return;
            }

            e.dataTransfer.dropEffect = 'move';
            element.classList.add('drag-over-folder');
        });

        element.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            element.classList.remove('drag-over-folder');
        });

        element.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            element.classList.remove('drag-over-folder');

            let payload = draggedItemPayload;
            if (!payload) {
                try {
                    const rawData = e.dataTransfer.getData('text/plain');
                    if (rawData) payload = JSON.parse(rawData);
                } catch (err) {
                    console.error('Failed to parse drag data:', err);
                }
            }

            if (!payload || !payload.id || !payload.type) return;

            if (payload.type === 'folder' && payload.id === targetFolderId) {
                alert('Cannot move a folder into itself.');
                return;
            }

            await moveItem(payload.id, payload.type, targetFolderId);
        });
    }

    // API to move file or folder
    async function moveItem(itemId, itemType, targetFolderId) {
        try {
            const res = await fetch('/api/storage/move', {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId,
                    itemType,
                    targetFolderId: targetFolderId === 'root' ? null : targetFolderId
                })
            });

            const data = await res.json();
            if (res.ok) {
                loadFolderContents(currentFolderId);
                loadFolderTree();
                loadUsage();
                clearPreview();
            } else {
                alert(data.error || 'Failed to move item');
            }
        } catch (err) {
            console.error('Error moving item:', err);
            alert('Server error while moving item');
        }
    }

    // File Preview
    async function showPreview(file) {
        if (!previewEmpty || !previewContent) return;

        previewEmpty.style.display = 'none';
        previewContent.style.display = 'flex';
        
        previewFilename.innerText = file.originalName;
        previewType.innerText = file.type || 'file';
        previewSize.innerText = (file.size / 1024).toFixed(1) + ' KB';
        previewDate.innerText = file.uploadDate ? new Date(file.uploadDate).toLocaleDateString() : 'N/A';
        previewId.innerText = file._id;

        // Visual Preview rendering
        previewVisual.innerHTML = '';
        const previewUrl = `/api/storage/view/${file._id}?token=${token}`;

        if (file.type === 'image' || (file.mimeType && file.mimeType.startsWith('image/'))) {
            const img = document.createElement('img');
            img.src = previewUrl;
            img.alt = file.originalName;
            previewVisual.appendChild(img);
        } else if (file.type === 'video' || (file.mimeType && file.mimeType.startsWith('video/'))) {
            const video = document.createElement('video');
            video.src = previewUrl;
            video.controls = true;
            video.autoplay = false;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '100%';
            previewVisual.appendChild(video);
        } else if (file.type === 'audio' || (file.mimeType && file.mimeType.startsWith('audio/'))) {
            const container = document.createElement('div');
            container.className = 'preview-audio-container';
            container.innerHTML = `<i class="ph-fill ph-speaker-hifi file-icon" style="font-size: 3.5rem; color: var(--primary);"></i>
                <audio src="${previewUrl}" controls></audio>`;
            previewVisual.appendChild(container);
        } else if (file.type === 'pdf' || file.mimeType === 'application/pdf') {
            const iframe = document.createElement('iframe');
            iframe.src = previewUrl;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            previewVisual.appendChild(iframe);
        } else if (file.mimeType && (file.mimeType.startsWith('text/') || file.mimeType.includes('json') || file.mimeType.includes('javascript') || file.mimeType.includes('xml'))) {
            try {
                const textRes = await fetch(previewUrl, { headers });
                if (textRes.ok) {
                    const text = await textRes.text();
                    const pre = document.createElement('pre');
                    pre.className = 'preview-text-container';
                    pre.innerText = text.slice(0, 5000) + (text.length > 5000 ? '\n... (truncated)' : '');
                    previewVisual.appendChild(pre);
                } else {
                    renderIconFallback(file);
                }
            } catch (e) {
                renderIconFallback(file);
            }
        } else {
            renderIconFallback(file);
        }

        // Action buttons
        downloadBtn.style.display = 'flex';
        downloadBtn.onclick = async () => {
            try {
                const res = await fetch(`/api/storage/download/${file._id}`, { headers });
                if (!res.ok) throw new Error('Download failed');
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.originalName;
                a.click();
                window.URL.revokeObjectURL(url);
            } catch (err) {
                console.error(err);
                // Fallback to direct location download with token query param
                window.location.href = `/api/storage/download/${file._id}?token=${token}`;
            }
        };

        moveBtn.onclick = () => {
            openMoveModal('file', file);
        };

        deleteBtn.onclick = async () => {
            if (!confirm(`Are you sure you want to delete "${file.originalName}"?`)) return;
            try {
                const res = await fetch(`/api/storage/file/${file._id}`, { method: 'DELETE', headers });
                if (res.ok) {
                    clearPreview();
                    loadFolderContents(currentFolderId);
                    loadUsage();
                } else {
                    const data = await res.json();
                    alert(data.error || 'Failed to delete file');
                }
            } catch (err) {
                console.error(err);
            }
        };
    }

    function renderIconFallback(file) {
        let iconClass = 'ph-file';
        let colorClass = '';
        if (file.type === 'pdf') iconClass = 'ph-file-pdf';
        previewVisual.innerHTML = `<i class="ph-fill ${iconClass} ${colorClass}" style="font-size: 4rem; color: var(--primary);"></i>`;
    }

    // Folder Preview info
    function showFolderPreview(folder) {
        if (!previewEmpty || !previewContent) return;

        previewEmpty.style.display = 'none';
        previewContent.style.display = 'flex';

        previewFilename.innerText = folder.name;
        previewType.innerText = 'Folder';
        previewSize.innerText = '-';
        previewDate.innerText = folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : 'N/A';
        previewId.innerText = folder._id;

        previewVisual.innerHTML = `<i class="ph-fill ph-folder" style="font-size: 4rem; color: var(--primary);"></i>`;

        downloadBtn.style.display = 'none';

        moveBtn.onclick = () => {
            openMoveModal('folder', folder);
        };

        deleteBtn.onclick = async () => {
            if (!confirm(`Are you sure you want to delete folder "${folder.name}"?`)) return;
            try {
                const res = await fetch(`/api/storage/folder/${folder._id}`, { method: 'DELETE', headers });
                const data = await res.json();
                if (res.ok) {
                    clearPreview();
                    loadFolderContents(currentFolderId);
                    loadFolderTree();
                } else {
                    alert(data.error || 'Failed to delete folder');
                }
            } catch (err) {
                console.error(err);
            }
        };
    }

    // Open Move Modal
    async function openMoveModal(itemType, itemData) {
        await fetchAllFolders();
        selectedMoveTargetFolderId = 'root';
        
        moveItemTitle.innerText = `Move "${itemData.originalName || itemData.name}" to:`;
        moveFolderSelectList.innerHTML = '';

        // Option 1: Root Folder
        const rootOption = document.createElement('div');
        rootOption.className = 'move-folder-option selected';
        rootOption.dataset.id = 'root';
        rootOption.innerHTML = `<i class="ph-fill ph-house"></i> <span>Root (Home)</span>`;
        rootOption.onclick = () => {
            document.querySelectorAll('.move-folder-option').forEach(el => el.classList.remove('selected'));
            rootOption.classList.add('selected');
            selectedMoveTargetFolderId = 'root';
        };
        moveFolderSelectList.appendChild(rootOption);

        // Option 2+: Other User Folders
        allUserFolders.forEach(folder => {
            // Prevent moving a folder into itself or its direct children
            if (itemType === 'folder' && folder._id === itemData._id) return;

            const option = document.createElement('div');
            option.className = 'move-folder-option';
            option.dataset.id = folder._id;
            option.innerHTML = `<i class="ph-fill ph-folder"></i> <span>${folder.name}</span>`;
            option.onclick = () => {
                document.querySelectorAll('.move-folder-option').forEach(el => el.classList.remove('selected'));
                option.classList.add('selected');
                selectedMoveTargetFolderId = folder._id;
            };
            moveFolderSelectList.appendChild(option);
        });

        confirmMoveBtn.onclick = async () => {
            await moveItem(itemData._id, itemType, selectedMoveTargetFolderId);
            moveModal.classList.remove('active');
        };

        moveModal.classList.add('active');
    }

    // Usage Statistics
    async function loadUsage() {
        try {
            const res = await fetch('/api/storage/usage', { headers });
            if (res.status === 401) {
                window.location.href = '../login.html';
                return;
            }
            const data = await res.json();
            
            const usedMB = (data.used / (1024 * 1024)).toFixed(2);
            const limitMB = (data.limit / (1024 * 1024)).toFixed(0);
            const pct = Math.min(100, Math.round((data.used / data.limit) * 100));
            
            const usedText = document.getElementById('storage-used-text');
            const totalText = document.getElementById('storage-total-text');
            const percentText = document.getElementById('storage-percent-text');
            const barFill = document.getElementById('storage-bar-fill');

            if (usedText) usedText.innerText = `${usedMB} MB`;
            if (totalText) totalText.innerText = `${limitMB} MB`;
            if (percentText) percentText.innerText = `${pct}% used`;
            if (barFill) barFill.style.width = `${pct}%`;
        } catch (err) {
            console.error(err);
        }
    }

    // Deselect item when clicking background container
    const rmContentContainer = document.getElementById('rm-content');
    if (rmContentContainer) {
        rmContentContainer.addEventListener('click', (e) => {
            if (e.target === rmContentContainer || e.target.id === 'file-grid') {
                document.querySelectorAll('#file-grid .file-item').forEach(el => el.classList.remove('selected'));
                clearPreview();
            }
        });
    }

    // Initializations
    updateBreadcrumbUI();
    loadFolderContents(currentFolderId);
    loadFolderTree();
    loadUsage();
});

