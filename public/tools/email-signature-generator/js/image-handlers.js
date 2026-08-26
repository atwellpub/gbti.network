/**
 * Image Handlers Module
 * This module handles all image upload and preview functionality
 * 
 * @module image-handlers
 */

// Define the EmailSignatureApp namespace if it doesn't exist
window.EmailSignatureApp = window.EmailSignatureApp || {};

/**
 * Image Handlers Module
 * @namespace
 */
EmailSignatureApp.ImageHandlers = (function() {
    'use strict';
    
    // Private variables
    let _config = {
        profileImage: {
            id: "profile-image-upload",
            previewId: "profile-image-preview-img",
            storageKey: "signature-profile-image",
            defaultSrc: "assets/logo-image.png"
        },
        logoImage: {
            id: "logo-image-upload",
            previewId: "logo-image-preview-img",
            storageKey: "signature-logo-image",
            defaultSrc: "assets/logo-image.png"
        },
        bannerImage: {
            id: "banner-image-upload",
            previewId: "banner-image-preview-img",
            storageKey: "signature-banner-image",
            defaultSrc: "assets/banner-image.png"
        }
    };
    
    // Track images that exceed localStorage quota
    let _fallbackImages = {};
    
    function _initializeImageHandlers() {
        DEBUG.info('Initializing image handlers...');
        
        // Initialize each image upload
        _initializeImageUpload(_config.profileImage);
        _initializeImageUpload(_config.logoImage);
        _initializeImageUpload(_config.bannerImage);
        
        // Load saved images from localStorage
        _loadSavedImages();
    }
    
    function _initializeImageUpload(imageConfig) {
        const uploadInput = document.getElementById(imageConfig.id);
        const previewImg = document.getElementById(imageConfig.previewId);
        
        if (!uploadInput || !previewImg) {
            console.error(`Could not initialize image upload for ${imageConfig.id}`);
            return;
        }
        
        // Add event listener for file selection
        uploadInput.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    // Update the preview image
                    previewImg.src = e.target.result;
                    
                    // Save to localStorage
                    _saveImageToStorage(imageConfig.storageKey, e.target.result, previewImg);
                    
                    // Trigger signature update
                    if (typeof EmailSignatureApp.SignatureUpdater !== 'undefined') {
                        EmailSignatureApp.SignatureUpdater.updateSignatures();
                    } else if (window.updateSignatures) {
                        window.updateSignatures();
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    /**
     * Save image to localStorage with error handling
     * @param {string} storageKey - The key for localStorage
     * @param {string} dataUrl - The data URL to save
     * @param {HTMLImageElement} previewImg - The preview image element
     */
    function _saveImageToStorage(storageKey, dataUrl, previewImg) {
        try {
            // Try to save to localStorage
            localStorage.setItem(storageKey, dataUrl);
            DEBUG.info(`Successfully saved ${storageKey} to localStorage`);
            
            // Clear any fallback image since we successfully stored it
            if (_fallbackImages[storageKey]) {
                delete _fallbackImages[storageKey];
            }
        } catch (error) {
            console.error(`Error saving ${storageKey} to localStorage:`, error);
            _handleStorageError(storageKey, dataUrl, previewImg);
        }
    }
    
    /**
     * Handle localStorage errors by falling back to in-memory storage
     * @param {string} storageKey - The key for localStorage
     * @param {string} dataUrl - The data URL to save
     * @param {HTMLImageElement} previewImg - The preview image element
     */
    function _handleStorageError(storageKey, dataUrl, previewImg) {
        // Store in fallback memory object
        _fallbackImages[storageKey] = dataUrl;
        DEBUG.warn(`Using in-memory fallback for ${storageKey}`);
        
        // Show warning to user about localStorage limitations
        _showStorageWarning();
    }
    
    /**
     * Show a warning to the user about localStorage limitations
     */
    function _showStorageWarning() {
        // Check if we've already shown the warning
        if (localStorage.getItem('storage-warning-shown')) {
            return;
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background-color: #ff9800; color: white; padding: 15px; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 9999; max-width: 350px;';
        
        notification.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: bold;">Storage Limitation</div>
            <div>Your browser's storage limit has been reached. Some uploaded images will only be available for the current session.</div>
            <div style="margin-top: 10px;">For best results:</div>
            <ul style="margin-top: 5px; padding-left: 20px;">
                <li>Use JPG format for photos</li>
                <li>Use PNG format for logos with transparency</li>
            </ul>
            <div style="margin-top: 10px; display: flex; justify-content: space-between;">
                <button id="dont-show-again" style="background: transparent; border: 1px solid white; color: white; padding: 5px 10px; cursor: pointer;">Don't show again</button>
                <button id="close-warning" style="background: white; border: none; color: #ff9800; padding: 5px 10px; cursor: pointer;">Close</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Add event listeners for buttons
        document.getElementById('dont-show-again').addEventListener('click', function() {
            localStorage.setItem('storage-warning-shown', 'true');
            notification.remove();
        });
        
        document.getElementById('close-warning').addEventListener('click', function() {
            notification.remove();
        });
        
        // Auto-hide after 15 seconds
        setTimeout(function() {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 15000);
    }
    
    /**
     * Get image from storage (localStorage or fallback memory)
     * @param {string} storageKey - The key for localStorage
     * @returns {string|null} - The data URL or null if not found
     */
    function _getImageFromStorage(storageKey) {
        // First check fallback memory in case localStorage failed
        if (_fallbackImages[storageKey]) {
            return _fallbackImages[storageKey];
        }
        
        // Then try localStorage
        return localStorage.getItem(storageKey);
    }
    
    function _loadSavedImages() {
        // Profile image
        const profileImg = document.getElementById(_config.profileImage.previewId);
        const savedProfileImage = _getImageFromStorage(_config.profileImage.storageKey);
        if (profileImg && savedProfileImage) {
            profileImg.src = savedProfileImage;
        }
        
        // Logo image
        const logoImg = document.getElementById(_config.logoImage.previewId);
        const savedLogoImage = _getImageFromStorage(_config.logoImage.storageKey);
        if (logoImg && savedLogoImage) {
            logoImg.src = savedLogoImage;
        }
        
        // Banner image
        const bannerImg = document.getElementById(_config.bannerImage.previewId);
        const savedBannerImage = _getImageFromStorage(_config.bannerImage.storageKey);
        if (bannerImg && savedBannerImage) {
            bannerImg.src = savedBannerImage;
        }
    }
    
    function _resetImage(imageConfig) {
        const previewImg = document.getElementById(imageConfig.previewId);
        
        if (previewImg) {
            // Handle WordPress paths for default images
            let defaultSrc = imageConfig.defaultSrc;
            
            // In WordPress environments, prepend path with toolBaseUrl
            if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                defaultSrc = EmailSignatureGeneratorConfig.toolBaseUrl + defaultSrc;
            }
            
            previewImg.src = defaultSrc;
        }
        
        // Clear from localStorage
        localStorage.removeItem(imageConfig.storageKey);
    }
    
    function _resetImages() {
        // Reset each image type
        _resetImage(_config.profileImage);
        _resetImage(_config.logoImage);
        _resetImage(_config.bannerImage);
        
        // Update all signatures
        _updateImages();
    }
    
    function _updateImages() {
        // Get profile image
        const profileImage = document.getElementById(_config.profileImage.previewId);
        if (profileImage && profileImage.src) {
            document.querySelectorAll('.profile-img, .profile-image').forEach(img => {
                img.src = profileImage.src;
            });
        } else {
            // Use default with WordPress path support
            let defaultSrc = _config.profileImage.defaultSrc;
            if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                defaultSrc = EmailSignatureGeneratorConfig.toolBaseUrl + defaultSrc;
            }
            document.querySelectorAll('.profile-img, .profile-image').forEach(img => {
                img.src = defaultSrc;
            });
        }
        
        // Get logo image
        const logoImage = document.getElementById(_config.logoImage.previewId);
        if (logoImage && logoImage.src) {
            document.querySelectorAll('.logo-img, .company-logo').forEach(img => {
                img.src = logoImage.src;
            });
        } else {
            // Use default with WordPress path support
            let defaultSrc = _config.logoImage.defaultSrc;
            if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                defaultSrc = EmailSignatureGeneratorConfig.toolBaseUrl + defaultSrc;
            }
            document.querySelectorAll('.logo-img, .company-logo').forEach(img => {
                img.src = defaultSrc;
            });
        }
        
        // Get banner image
        const bannerImage = document.getElementById(_config.bannerImage.previewId);
        if (bannerImage && bannerImage.src) {
            document.querySelectorAll('.banner-img, .banner-image').forEach(img => {
                img.src = bannerImage.src;
            });
        } else {
            // Use default with WordPress path support
            let defaultSrc = _config.bannerImage.defaultSrc;
            if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                defaultSrc = EmailSignatureGeneratorConfig.toolBaseUrl + defaultSrc;
            }
            document.querySelectorAll('.banner-img, .banner-image').forEach(img => {
                img.src = defaultSrc;
            });
        }
    }
    
    /**
     * Update specific image type in signatures
     * @param {string} imageType - Type of image (profile, logo, banner)
     * @param {string} imageDataUrl - Data URL of the image
     */
    function _updateSignatureImages(imageType, imageDataUrl) {
        if (!imageDataUrl) {
            console.warn(`No image data provided for ${imageType}`);
            return;
        }

        DEBUG.info(`Updating ${imageType} images in signatures with data URL: ${imageDataUrl.substring(0, 50)}...`);

        if (imageType === 'profile') {
            // Update all profile images in signatures
            document.querySelectorAll('.profile-img, .profile-img-square, .animated-profile').forEach(img => {
                img.src = imageDataUrl;
            });
        } else if (imageType === 'logo') {
            // Update all logo images in signatures
            document.querySelectorAll('.company img, .company-logo').forEach(img => {
                if (img.alt.includes('Logo') || img.classList.contains('company-logo')) {
                    img.src = imageDataUrl;
                }
            });
        } else if (imageType === 'banner') {
            // Update all banner images in signatures
            document.querySelectorAll('.animated-header img').forEach(img => {
                if (img.alt.includes('Banner')) {
                    img.src = imageDataUrl;
                }
            });
        }
    }
    
    /**
     * Update image configurations
     * @param {Object} newConfig - New configuration to merge with existing config
     */
    function _updateConfig(newConfig) {
        _config = Object.assign({}, _config, newConfig);
        DEBUG.info('Updated image handler configuration');
    }
    
    // Public API
    return {
        initialize: _initializeImageHandlers,
        resetImages: _resetImages,
        updateImages: _updateImages,
        updateSignatureImages: _updateSignatureImages,
        updateConfig: _updateConfig,
        getImageFromStorage: _getImageFromStorage,
        initializeImageUpload: _initializeImageUpload,
        loadSavedImages: _loadSavedImages
    };
})();

// For backwards compatibility with global functions
function initializeImageHandlers() {
    EmailSignatureApp.ImageHandlers.initialize();
}

function initializeImageUpload(uploadId, previewId, storageKey) {
    // Create a config object compatible with the modern implementation
    const imageConfig = {
        id: uploadId,
        previewId: previewId,
        storageKey: storageKey
    };
    
    // Use the modern implementation internally
    EmailSignatureApp.ImageHandlers.initializeImageUpload(imageConfig);
}

function resetImages() {
    EmailSignatureApp.ImageHandlers.resetImages();
}

function updateImages() {
    EmailSignatureApp.ImageHandlers.updateImages();
}

function updateSignatureImages(imageType, imageDataUrl) {
    EmailSignatureApp.ImageHandlers.updateSignatureImages(imageType, imageDataUrl);
}

function getImageFromStorage(storageKey) {
    return EmailSignatureApp.ImageHandlers.getImageFromStorage(storageKey);
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Module will be initialized by core.js or main initialization
});

// CommonJS module exports (for potential future bundling)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EmailSignatureApp.ImageHandlers;
}
