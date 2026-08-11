document.addEventListener('DOMContentLoaded', () => {
    // Basic DOM elements
    const uploadBtn = document.getElementById('upload-btn');
    const uploadModal = document.getElementById('upload-modal');
    const closeBtns = document.querySelectorAll('.close-btn');
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('upload-dropzone');
    const newFolderBtn = document.getElementById('new-folder-btn');
    
    // File interaction state
    let currentFolderId = 'root';
    
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '../login.html';
        return;
    }

    const headers = {
        'x-auth-token': token
    };

    // Open Upload Modal
    uploadBtn.addEventListener('click', () => {
        uploadModal.classList.add('active');
    });

    // Close Modals
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay').classList.remove('active');
        });
    });

    // Dropzone Drag & Drop
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
        handleFiles(e.dataTransfer.files);
    }, false);

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() { handleFiles(this.files); });

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
                    headers: { 'x-auth-token': token }, // Don't set Content-Type for FormData
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
        loadUsage();
    }
    
    // New Folder
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
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to create folder');
            }
        } catch (err) {
            console.error(err);
        }
    });
    
    // Refresh Button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadFolderContents(currentFolderId);
        loadUsage();
    });
    
    // Initial Load
    async function loadFolderContents(folderId) {
        const fileGrid = document.getElementById('file-grid');
        const emptyState = document.getElementById('empty-state');
        const breadcrumb = document.getElementById('breadcrumb');
        
        try {
            const res = await fetch(`/api/storage/list/${folderId}`, { headers });
            if (res.status === 401) {
                window.location.href = '../login.html';
                return;
            }
            const data = await res.json();
            
            // Guard: API may return an error object instead of { folders, files }
            if (!data.folders || !data.files) {
                console.error('Unexpected storage API response:', data);
                return;
            }

            fileGrid.innerHTML = '';
            
            if (data.folders.length === 0 && data.files.length === 0) {
                emptyState.style.display = 'flex';
            } else {
                emptyState.style.display = 'none';
                
                // Add folders
                data.folders.forEach(folder => {
                    const el = document.createElement('div');
                    el.className = 'file-item';
                    el.innerHTML = `<i class="ph-fill ph-folder file-icon folder"></i><span class="file-name">${folder.name}</span>`;
                    el.ondblclick = () => {
                        currentFolderId = folder._id;
                        breadcrumb.innerHTML += `<span class="crumb" data-id="${folder._id}">${folder.name}</span>`;
                        loadFolderContents(currentFolderId);
                    };
                    fileGrid.appendChild(el);
                });
                
                // Add files
                data.files.forEach(file => {
                    const el = document.createElement('div');
                    el.className = 'file-item';
                    
                    let iconClass = 'ph-file';
                    let colorClass = '';
                    if (file.type === 'image') { iconClass = 'ph-image'; colorClass = 'image'; }
                    else if (file.type === 'pdf') { iconClass = 'ph-file-pdf'; colorClass = 'pdf'; }
                    else if (file.type === 'video') { iconClass = 'ph-video-camera'; colorClass = 'video'; }
                    else if (file.type === 'audio') { iconClass = 'ph-speaker-hifi'; }
                    
                    el.innerHTML = `<i class="ph-fill ${iconClass} file-icon ${colorClass}"></i><span class="file-name">${file.originalName}</span>`;
                    el.onclick = () => showPreview(file);
                    fileGrid.appendChild(el);
                });
            }
        } catch (err) {
            console.error(err);
        }
    }
    
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
            
            document.getElementById('storage-used-text').innerText = `${usedMB} MB`;
            document.getElementById('storage-total-text').innerText = `${limitMB} MB`;
            document.getElementById('storage-percent-text').innerText = `${pct}% used`;
            document.getElementById('storage-bar-fill').style.width = `${pct}%`;
        } catch (err) {
            console.error(err);
        }
    }

    function showPreview(file) {
        document.getElementById('preview-empty').style.display = 'none';
        document.getElementById('preview-content').style.display = 'flex';
        
        document.getElementById('preview-filename').innerText = file.originalName;
        document.getElementById('preview-type').innerText = file.type;
        document.getElementById('preview-size').innerText = (file.size / 1024).toFixed(1) + ' KB';
        document.getElementById('preview-date').innerText = new Date(file.uploadDate).toLocaleDateString();
        document.getElementById('preview-id').innerText = file._id;
        
        // Setup download button
        const downloadBtn = document.getElementById('preview-download-btn');
        downloadBtn.onclick = () => {
            window.location.href = `/api/storage/download/${file._id}?token=${token}`; 
            // Better to use fetch and blob for secure downloads but this works if we pass token in query
            // However API expects header. Let's do fetch blob.
        };
        
        // For secure download:
        downloadBtn.onclick = async () => {
            const res = await fetch(`/api/storage/download/${file._id}`, { headers });
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.originalName;
            a.click();
        };

        const deleteBtn = document.getElementById('preview-delete-btn');
        deleteBtn.onclick = async () => {
            if (!confirm('Are you sure you want to delete this file?')) return;
            try {
                await fetch(`/api/storage/file/${file._id}`, { method: 'DELETE', headers });
                document.getElementById('preview-content').style.display = 'none';
                document.getElementById('preview-empty').style.display = 'flex';
                loadFolderContents(currentFolderId);
                loadUsage();
            } catch (err) {
                console.error(err);
            }
        };
    }

    // Breadcrumb navigation root click
    document.getElementById('breadcrumb').addEventListener('click', (e) => {
        if (e.target.classList.contains('crumb')) {
            const id = e.target.getAttribute('data-id');
            if (id === 'root') {
                currentFolderId = 'root';
                document.getElementById('breadcrumb').innerHTML = `<span class="crumb" data-id="root">Root</span>`;
                loadFolderContents(currentFolderId);
            }
        }
    });

    loadFolderContents(currentFolderId);
    loadUsage();
});
