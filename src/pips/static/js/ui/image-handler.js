/**
 * Image Handler - Handles image upload and drag & drop functionality
 */
import { Logger } from '../core/logger.js';
import { domManager } from './dom-manager.js';

export class ImageHandler {
    constructor() {
        this.isInitialized = false;
        this.currentImageData = null;
    }

    initialize() {
        if (this.isInitialized) return;
        
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.isInitialized = true;
        
        Logger.debug('Image', 'Image handler initialized');
    }

    setupEventListeners() {
        // Image upload listeners
        domManager.getElement('imageInput')?.addEventListener('change', (e) => this.handleImageUpload(e));
        domManager.getElement('imageUploadBtn')?.addEventListener('click', () => this.triggerImageUpload());
        
        Logger.debug('Image', 'Event listeners set up');
    }

    setupDragAndDrop() {
        const imageUpload = domManager.getElement('imageUpload');
        
        if (!imageUpload) {
            Logger.warn('Image', 'Image upload element not found');
            return;
        }

        imageUpload.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageUpload.classList.add('drag-over');
        });
        
        imageUpload.addEventListener('dragleave', () => {
            imageUpload.classList.remove('drag-over');
        });
        
        imageUpload.addEventListener('drop', (e) => {
            e.preventDefault();
            imageUpload.classList.remove('drag-over');
            
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.processImageFile(file);
            } else {
                domManager.updateStatus('Please drop a valid image file', 'warning');
            }
        });

        Logger.debug('Image', 'Drag and drop set up');
    }

    triggerImageUpload() {
        const imageInput = domManager.getElement('imageInput');
        if (imageInput) {
            imageInput.click();
        }
    }

    handleImageUpload(e) {
        const file = e.target.files[0];
        if (file) {
            this.processImageFile(file);
        }
    }

    processImageFile(file) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            domManager.updateStatus('Please select a valid image file', 'warning');
            return;
        }

        // Validate file size (10MB limit)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            domManager.updateStatus('Image file is too large. Please select a file under 10MB', 'warning');
            return;
        }

        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                this.displayImagePreview(e.target.result);
                this.currentImageData = e.target.result;
                domManager.updateStatus(`Image "${file.name}" loaded successfully`, 'success');
                Logger.debug('Image', `Image processed: ${file.name} (${file.size} bytes)`);
            } catch (error) {
                Logger.error('Image', 'Error processing image:', error);
                domManager.updateStatus('Error processing image', 'error');
            }
        };
        
        reader.onerror = () => {
            Logger.error('Image', 'Error reading image file');
            domManager.updateStatus('Error reading image file', 'error');
        };
        
        reader.readAsDataURL(file);
    }

    displayImagePreview(imageSrc) {
        const imagePreview = domManager.getElement('imagePreview');
        const imageUpload = domManager.getElement('imageUpload');
        const imageUploadBtn = domManager.getElement('imageUploadBtn');
        
        if (imagePreview) {
            imagePreview.src = imageSrc;
            imagePreview.style.display = 'block';
        }
        
        if (imageUpload) {
            imageUpload.classList.add('has-image');
        }
        
        if (imageUploadBtn) {
            imageUploadBtn.innerHTML = `
                <i data-feather="check-circle" style="width: 16px; height: 16px;"></i>
                Image Selected
            `;
            
            // Replace feather icons
            if (typeof feather !== 'undefined') {
                feather.replace(imageUploadBtn);
            }
        }
    }

    clearImage() {
        const imagePreview = domManager.getElement('imagePreview');
        const imageUpload = domManager.getElement('imageUpload');
        const imageUploadBtn = domManager.getElement('imageUploadBtn');
        const imageInput = domManager.getElement('imageInput');
        
        if (imagePreview) {
            imagePreview.style.display = 'none';
            imagePreview.src = '';
        }
        
        if (imageUpload) {
            imageUpload.classList.remove('has-image');
        }
        
        if (imageUploadBtn) {
            imageUploadBtn.innerHTML = `
                <i data-feather="upload" style="width: 16px; height: 16px;"></i>
                Upload Image
            `;
            
            // Replace feather icons
            if (typeof feather !== 'undefined') {
                feather.replace(imageUploadBtn);
            }
        }
        
        if (imageInput) {
            imageInput.value = '';
        }
        
        this.currentImageData = null;
        Logger.debug('Image', 'Image cleared');
    }

    getCurrentImageData() {
        return this.currentImageData;
    }

    hasImage() {
        return this.currentImageData !== null;
    }

    // Get image data in format suitable for sending to server
    getImageForSubmission() {
        if (!this.currentImageData) {
            return null;
        }
        
        try {
            // Extract base64 data without the data URL prefix
            const base64Data = this.currentImageData.split(',')[1];
            const mimeType = this.currentImageData.split(';')[0].split(':')[1];
            
            return {
                data: base64Data,
                mimeType: mimeType,
                filename: `uploaded_image.${this.getExtensionFromMimeType(mimeType)}`
            };
        } catch (error) {
            Logger.error('Image', 'Error preparing image for submission:', error);
            return null;
        }
    }

    getExtensionFromMimeType(mimeType) {
        const extensions = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg'
        };
        
        return extensions[mimeType] || 'jpg';
    }

    // Validate image before processing
    validateImage(file) {
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
        const maxSize = 10 * 1024 * 1024; // 10MB
        
        const errors = [];
        
        if (!validTypes.includes(file.type)) {
            errors.push('Invalid file type. Please select a JPEG, PNG, GIF, WebP, or BMP image.');
        }
        
        if (file.size > maxSize) {
            errors.push('File size too large. Please select an image under 10MB.');
        }
        
        if (file.size === 0) {
            errors.push('File appears to be empty.');
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // Get image metadata
    getImageMetadata(file) {
        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified ? new Date(file.lastModified) : null
        };
    }

    // Handle paste events for image upload
    setupPasteHandler() {
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    
                    if (file) {
                        this.processImageFile(file);
                        domManager.updateStatus('Image pasted from clipboard', 'success');
                    }
                    break;
                }
            }
        });
        
        Logger.debug('Image', 'Paste handler set up');
    }

    // Generate image thumbnail for preview
    generateThumbnail(imageSrc, maxWidth = 200, maxHeight = 200) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            img.onload = () => {
                // Calculate new dimensions
                let { width, height } = img;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw resized image
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to data URL
                const thumbnailData = canvas.toDataURL('image/jpeg', 0.8);
                resolve(thumbnailData);
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load image for thumbnail generation'));
            };
            
            img.src = imageSrc;
        });
    }

    // SESSION MANAGEMENT METHODS
    loadSessionImage(imageData) {
        const imagePreview = domManager.getElement('imagePreview');
        const imageUpload = document.querySelector('.image-upload');
        const uploadBtn = document.querySelector('.image-upload-btn');
        
        if (imageData && imagePreview && imageUpload && uploadBtn) {
            // Load image into preview
            imagePreview.src = imageData;
            imagePreview.style.display = 'block';
            imageUpload.classList.add('has-image');
            
            // Update button state
            uploadBtn.innerHTML = `
                <i data-feather="check-circle" style="width: 16px; height: 16px;"></i>
                Image Selected
            `;
            
            // Store image data
            this.currentImageData = imageData;
            
            Logger.debug('Image', 'Session image loaded');
        } else {
            // Clear image if no data provided
            this.clearImage();
        }
        
        // Replace feather icons
        try {
            if (typeof feather !== 'undefined' && uploadBtn) {
                feather.replace(uploadBtn);
            }
        } catch (e) {
            Logger.warn('Image', 'Could not replace feather icons in upload button:', e);
        }
    }
}

// Create singleton instance
export const imageHandler = new ImageHandler(); 