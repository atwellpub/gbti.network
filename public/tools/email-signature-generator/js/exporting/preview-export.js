
/**
 * Preview Export Module for Email Signature Generator
 * Provides functionality to preview exported signature HTML directly in the browser
 * This is only active on .local domains for development purposes
 */

// Import modules for module environment
if (typeof require !== 'undefined') {
    const DEBUG = require('../debug');
}

const previewExport = {
    // Configuration
    _config: {
        previewContainerId: 'signature-export-preview-container',
        previewButtonClass: 'preview-export-button',
        previewContainerClass: 'export-preview-container',
        closeButtonClass: 'close-preview-button'
    },
    
    /**
     * Initialize the preview export functionality
     * Only activates on .local domains
     */
    initialize: function() {
        try {
            if (typeof DEBUG !== 'undefined') {
                DEBUG.info('Initializing preview export module');
            } else {
                DEBUG.info('Initializing preview export module');
            }
            
            // Only add the preview button if we're on a .local domain
            if (window.location.hostname.indexOf('.local') === -1) {
                if (typeof DEBUG !== 'undefined') {
                    DEBUG.info('Not on a .local domain, preview export disabled');
                } else {
                    DEBUG.info('Not on a .local domain, preview export disabled');
                }
                return;
            }
            
            // Create a container for previews if it doesn't exist
            this.ensurePreviewContainer();
            
            // Register with download buttons module
            if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
                // Extend the download buttons module with our preview functionality
                this.extendDownloadButtons();
            } else {
                // If the download buttons module isn't available yet, wait and try again
                setTimeout(() => this.initialize(), 500);
            }
            
        } catch (error) {
            if (typeof DEBUG !== 'undefined') {
                DEBUG.error('Error initializing preview export:', error);
            } else {
                console.error('Error initializing preview export:', error);
            }
        }
    },
    
    ensurePreviewContainer: function() {
        // Check if container already exists
        let container = document.getElementById(this._config.previewContainerId);
        if (!container) {
            // Create container
            container = document.createElement('div');
            container.id = this._config.previewContainerId;
            container.className = this._config.previewContainerClass;
            container.style.display = 'none';
            
            // Create header with close button
            const header = document.createElement('div');
            header.className = 'export-preview-header';
            
            const title = document.createElement('h3');
            title.textContent = 'Exported Signature Preview';
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.className = this._config.closeButtonClass;
            closeBtn.addEventListener('click', () => {
                container.style.display = 'none';
            });
            
            header.appendChild(title);
            header.appendChild(closeBtn);
            container.appendChild(header);
            
            // Create content area
            const content = document.createElement('div');
            content.id = 'export-preview-content';
            container.appendChild(content);
            
            // Add to body
            document.body.appendChild(container);
        }
    },
    
    extendDownloadButtons: function() {
        const originalInitialize = window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload;
        
        // Override the initialize method to add our preview button
        window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload = (force = false) => {
            // Call the original method first
            originalInitialize.call(window.EmailSignatureApp.DownloadButtons, force);
            
            // Then add our preview buttons
            this.addPreviewButtons();
        };
        
        if (typeof DEBUG !== 'undefined') {
            DEBUG.info('Download buttons module extended with preview functionality');
        } else {
            DEBUG.info('Download buttons module extended with preview functionality');
        }
        
        // Initialize on existing buttons
        this.addPreviewButtons();
    },
    
    addPreviewButtons: function() {
        try {
            // Get all signature wrappers that have download buttons but no preview buttons yet
            const signatureWrappers = document.querySelectorAll('.signature-wrapper');
            
            signatureWrappers.forEach(wrapper => {
                const downloadButton = wrapper.querySelector('.download-button');
                
                // Skip if there's no download button or if preview button already exists
                if (!downloadButton || wrapper.querySelector('.' + this._config.previewButtonClass)) {
                    return;
                }
                
                // Get the signature element
                const signature = wrapper.querySelector('.signature');
                if (!signature) {
                    return;
                }
                
                // Create a container for buttons if it doesn't exist
                let buttonsContainer = wrapper.querySelector('.signature-buttons');
                if (!buttonsContainer) {
                    buttonsContainer = document.createElement('div');
                    buttonsContainer.className = 'signature-buttons';
                    
                    // Move the download button to the container
                    if (downloadButton.parentNode) {
                        downloadButton.parentNode.insertBefore(buttonsContainer, downloadButton);
                        buttonsContainer.appendChild(downloadButton);
                    }
                }
                
                // Create preview button
                const previewButton = document.createElement('button');
                previewButton.className = this._config.previewButtonClass;
                previewButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg> Preview Export';
                
                // Add click event to preview button
                previewButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    this.generatePreview(signature);
                });
                
                // Add preview button before download button (to the left)
                buttonsContainer.insertBefore(previewButton, downloadButton);
            });
            
            if (typeof DEBUG !== 'undefined') {
                DEBUG.info('Preview buttons added to signatures');
            } else {
                DEBUG.info('Preview buttons added to signatures');
            }
        } catch (error) {
            if (typeof DEBUG !== 'undefined') {
                DEBUG.error('Error adding preview buttons:', error);
            } else {
                console.error('Error adding preview buttons:', error);
            }
        }
    },
    
    generatePreview: async function(signature) {
        try {
            // Ensure the preview container exists
            this.ensurePreviewContainer();
            
            // Get reference to exportFileHtml module
            const exportFileHtml = window.EmailSignatureApp?.ExportFileHtml || {};
            
            // Check if we have the required methods
            if (!exportFileHtml.prepareSignatureForExport) {
                throw new Error('Required method prepareSignatureForExport not found in ExportFileHtml module');
            }
            
            // Process the signature for export
            const processedWrapper = await exportFileHtml.prepareSignatureForExport(signature, {
                stripClasses: true,
                convertImagesToBase64: true
            });
            
            // Get the processed HTML and show it
            const html = processedWrapper.innerHTML;
            this.showPreview(html);
            
            if (typeof DEBUG !== 'undefined') {
                DEBUG.info('Export preview generated successfully');
            } else {
                DEBUG.info('Export preview generated successfully');
            }
        } catch (error) {
            if (typeof DEBUG !== 'undefined') {
                DEBUG.error('Error generating export preview:', error);
            } else {
                console.error('Error generating export preview:', error);
            }
            alert('Error generating export preview: ' + error.message);
        }
    },
    
    showPreview: function(html) {
        // Get the preview container
        const container = document.getElementById(this._config.previewContainerId);
        if (!container) {
            throw new Error('Preview container not found');
        }
        
        // Get the content element
        const content = document.getElementById('export-preview-content');
        if (!content) {
            throw new Error('Preview content element not found');
        }
        
        // Set the content
        content.innerHTML = html;
        
        // Show the container
        container.style.display = 'block';
    }
};

// For browser use
if (typeof window !== 'undefined') {
    // Initialize the DEBUG module if it exists in the browser environment
    if (!window.DEBUG && window.EmailSignatureApp && window.EmailSignatureApp.Debug) {
        window.DEBUG = window.EmailSignatureApp.Debug;
    }
    
    // Make the module available globally
    if (!window.EmailSignatureApp) {
        window.EmailSignatureApp = {};
    }
    
    window.EmailSignatureApp.PreviewExport = previewExport;
    
    // Automatically initialize if in a local domain
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            if (window.location.hostname.includes('.local')) {
                previewExport.initialize();
            }
        });
    } else {
        if (window.location.hostname.includes('.local')) {
            previewExport.initialize();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = previewExport;
}