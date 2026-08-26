/**
 * Image Processing Module for Email Signature Generator
 * Provides functions for handling images in email signatures
 */

const imageProcessing = {
    /**
     * Process user-uploaded images from localStorage and add them to the zip
     * @param {HTMLElement} signatureClone - The signature element clone
     * @param {Object} zip - The JSZip instance
     * @param {Object} assetsFolder - The assets folder in the zip
     * @returns {Promise<void>}
     */
    processUserUploadedImages: async function(signatureClone, zip, assetsFolder) {
        // Image types that need to be processed with correct file extensions
        const imageTypes = [
            { 
                type: 'profile', 
                storageKey: 'signature-profile-image', 
                selector: 'img.profile-img',
                defaultFilename: 'profile-image.jpg'
            },
            { 
                type: 'logo', 
                storageKey: 'signature-logo-image', 
                selector: 'img.company-logo',
                defaultFilename: 'logo-image.png'
            },
            { 
                type: 'banner', 
                storageKey: 'signature-banner-image', 
                selector: 'img.banner-img',
                defaultFilename: 'banner-image.png'
            }
        ];

        // Process each image type
        for (const imageType of imageTypes) {
            DEBUG.info(`[DEBUG] Starting to process ${imageType.type} image with key ${imageType.storageKey}`);
            
            try {
                // Get image from storage
                let dataUrl;
                
                // Check if the ImageHandlers module is available
                const imageHandlersAvailable = window.EmailSignatureApp && 
                                              window.EmailSignatureApp.ImageHandlers && 
                                              typeof window.EmailSignatureApp.ImageHandlers.getImageFromStorage === 'function';
                
                DEBUG.info(`[DEBUG] ImageHandlers module available: ${imageHandlersAvailable}`);
                
                if (imageHandlersAvailable) {
                    dataUrl = window.EmailSignatureApp.ImageHandlers.getImageFromStorage(imageType.storageKey);
                    DEBUG.info(`[DEBUG] Using ImageHandlers to get ${imageType.type} image. Result: ${dataUrl ? 'Image found' : 'No image found'}`);
                } else {
                    DEBUG.info(`[DEBUG] ImageHandlers module not available, checking localStorage directly`);
                    
                    // Direct attempt to get from localStorage
                    try {
                        dataUrl = localStorage.getItem(imageType.storageKey);
                        DEBUG.info(`[DEBUG] Direct localStorage check for ${imageType.storageKey}: ${dataUrl ? 'Image found' : 'No image found'}`);
                    } catch (localStorageError) {
                        DEBUG.error(`[DEBUG] Error accessing localStorage directly: ${localStorageError.message}`);
                    }
                    
                    // Try window._fallbackImages as a backup
                    if (!dataUrl && window._fallbackImages && window._fallbackImages[imageType.storageKey]) {
                        dataUrl = window._fallbackImages[imageType.storageKey];
                        DEBUG.info(`[DEBUG] Retrieved ${imageType.type} image from fallback memory`);
                    } else if (!dataUrl) {
                        DEBUG.warn(`[DEBUG] No image found in fallback memory for ${imageType.storageKey}`);
                    }
                }
                
                // Skip if no custom image is saved
                if (!dataUrl || !dataUrl.startsWith('data:')) {
                    DEBUG.info(`[DEBUG] No valid custom ${imageType.type} image found to include in ZIP. dataUrl exists: ${!!dataUrl}`);
                    continue;
                }
                
                DEBUG.info(`[DEBUG] Valid ${imageType.type} image found, processing for ZIP inclusion`);
                
                // Extract MIME type from data URL
                let extension = 'jpg'; // Default fallback extension
                let mimeType = '';
                
                // Format is typically: data:image/png;base64,iVBORw0KGg...
                const mimeMatch = dataUrl.match(/data:([^;]+);/);
                if (mimeMatch && mimeMatch[1]) {
                    mimeType = mimeMatch[1];
                    DEBUG.info(`[DEBUG] Detected MIME type for ${imageType.type} image: ${mimeType}`);
                    
                    // Map MIME type to file extension
                    if (mimeType.includes('png')) {
                        extension = 'png';
                    } else if (mimeType.includes('gif')) {
                        extension = 'gif';
                    } else if (mimeType.includes('svg')) {
                        extension = 'svg';
                    } else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
                        extension = 'jpg';
                    } else if (mimeType.includes('webp')) {
                        extension = 'webp';
                    }
                } else {
                    DEBUG.warn(`[DEBUG] Could not detect MIME type from data URL for ${imageType.type}, using default extension`);
                }
                
                // Generate filename based on actual file type, not hardcoded
                const baseFilename = imageType.defaultFilename.split('.')[0];
                const filename = `${baseFilename}.${extension}`;
                
                DEBUG.info(`[DEBUG] Using filename with correct extension: ${filename}`);
                
                // Convert data URL to blob
                const blob = await this.dataUrlToBlob(dataUrl);
                
                // Add the image to the zip
                assetsFolder.file(filename, blob);
                DEBUG.info(`[DEBUG] Added ${imageType.type} image to ZIP as: ${filename}`);
                
                // Update image references in the signature HTML
                const imgElements = signatureClone.querySelectorAll(imageType.selector);
                if (imgElements.length > 0) {
                    for (const imgElement of imgElements) {
                        // Set the correct path for the image in the HTML
                        imgElement.setAttribute('src', `assets/${filename}`);
                        DEBUG.info(`[DEBUG] Updated ${imageType.type} image src to: assets/${filename}`);
                    }
                } else {
                    DEBUG.warn(`[DEBUG] No ${imageType.selector} elements found in signature`);
                }
                
            } catch (error) {
                DEBUG.error(`[DEBUG] Error processing ${imageType.type} image:`, error);
            }
        }
    },

    /** @returns {Promise<Blob>} */
    dataUrlToBlob: function(dataUrl) {
        return new Promise((resolve, reject) => {
            try {
                // Split the data URL to get the content type and base64 data
                const [prefix, base64Data] = dataUrl.split(',');
                const contentType = prefix.split(':')[1].split(';')[0];
                
                // Convert base64 to binary
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                // Create and return a Blob
                const blob = new Blob([bytes], { type: contentType });
                resolve(blob);
            } catch (error) {
                reject(new Error(`Failed to convert data URL to Blob: ${error.message}`));
            }
        });
    },

    /**
     * Process all images in a signature and add them to the zip
     * @param {HTMLElement} signatureClone - The signature element to process
     * @param {Object} zip - The JSZip instance
     * @param {Object} assetsFolder - The assets folder in the zip
     * @param {Object} iconsFolder - The icons folder in the zip
     * @param {Set<string>} addedAssets - Set of already added assets
     * @param {string} baseUrl - Base URL for resolving relative paths
     * @returns {Promise<Array>} - Array of promises for image processing
     */
    processSignatureImages: function(signatureClone, zip, assetsFolder, iconsFolder, addedAssets, baseUrl) {
        // Use the WordPress tool base URL if available
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            baseUrl = EmailSignatureGeneratorConfig.toolBaseUrl;
        }
        
        // Get all images from the signature
        const signatureImages = signatureClone.querySelectorAll('img');
        DEBUG.info(`Found ${signatureImages.length} images in signature`);

        // Create a tracking set for processed image filenames to avoid conflicts
        const processedFilenames = new Set();
        
        // Add standard user-uploaded image filenames to the tracking set
        // These are the ones we've already processed in processUserUploadedImages
        ['profile-image.png', 'profile-image.jpg', 'logo-image.png', 'banner-image.png'].forEach(name => {
            processedFilenames.add(name);
        });

        // Track which image selectors we've already processed
        const processedSelectors = {
            'img.profile-img': true,
            'img.company-logo': true,
            'img.banner-img': true
        };

        // Collect promises for adding signature images to the zip
        const signatureImagePromises = [];
        
        // Process each image in the signature
        signatureImages.forEach(async (img, index) => {
            const src = img.getAttribute('src');
            if (!src) {
                DEBUG.warn(`Image #${index} has no src attribute`);
                return;
            }
            
            try {
                // Skip data URLs as they've been handled by processUserUploadedImages
                if (src.startsWith('data:')) {
                    return;
                }
                
                // Skip images that match selectors we've already processed
                // This helps avoid overwriting our custom uploaded images
                for (const selector in processedSelectors) {
                    if (img.matches(selector)) {
                        DEBUG.info(`Skipping image with selector ${selector} as it's already been processed by processUserUploadedImages`);
                        return;
                    }
                }
                
                // Handle both relative and absolute URLs
                const absoluteSrc = src.startsWith('http') ? src : new URL(src, baseUrl).href;
                DEBUG.debug(`Processing image: ${absoluteSrc}`);
                
                // Extract the filename from the path
                let filename = absoluteSrc.split('/').pop();
                
                // Check if this filename has already been processed
                // This prevents conflicts between default and custom images with the same name
                if (processedFilenames.has(filename)) {
                    DEBUG.info(`Skipping duplicate filename ${filename} as it's already been processed`);
                    return;
                }
                
                // Add to processed filenames set
                processedFilenames.add(filename);
                
                // Update the src attribute to point to the local assets folder
                if (src.includes('assets/icons/')) {
                    // For social icons, ensure they point to local icons folder
                    img.setAttribute('src', `assets/icons/${filename}`);
                    DEBUG.info(`Updated social icon path to: assets/icons/${filename}`);
                } else if (src.includes('assets/')) {
                    // For other assets in the assets folder
                    const assetPath = 'assets/' + src.split('assets/')[1];
                    img.setAttribute('src', assetPath);
                    DEBUG.info(`Updated asset path to: ${assetPath}`);
                } else {
                    // For other images, put them in the assets folder
                    img.setAttribute('src', `assets/${filename}`);
                    DEBUG.info(`Updated image path to: assets/${filename}`);
                }
                
                // Add the image to the zip if it's not already being added
                if (!addedAssets.has(absoluteSrc)) {
                    const imagePromise = fetch(absoluteSrc)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Failed to fetch image: ${absoluteSrc}`);
                            }
                            return response.blob();
                        })
                        .then(blob => {
                            // Determine the correct folder based on the path
                            if (src.includes('assets/icons/')) {
                                // For icon assets, preserve the folder structure
                                iconsFolder.file(filename, blob);
                            } else {
                                // For other assets, put them in the assets folder
                                assetsFolder.file(filename, blob);
                            }
                            addedAssets.add(absoluteSrc);
                            DEBUG.info(`Added image to zip: ${filename}`);
                        })
                        .catch(error => {
                            DEBUG.error(`Error adding image to zip: ${error.message}`);
                        });
                    
                    // Add the promise to the array
                    signatureImagePromises.push(imagePromise);
                }
            } catch (error) {
                DEBUG.error(`Failed to process image #${index}:`, error);
            }
        });
        
        return signatureImagePromises;
    },

    /** @returns {string} assetPath unchanged when already http(s), '' when empty, else prefixed with the tool base. */
    getAssetUrl: function(assetPath) {

        if (!assetPath) {
            DEBUG.warn('Empty asset path provided to getAssetUrl');
            return '';
        }
        
        let assetUrl;
        
        // Check if the path is already a full URL
        if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
            return assetPath;
        }
        
        // Get the tool base URL from the configuration
        const toolBaseUrl = window.EmailSignatureGeneratorConfig && 
                           window.EmailSignatureGeneratorConfig.toolBaseUrl ? 
                           window.EmailSignatureGeneratorConfig.toolBaseUrl : '';
        
        const templatesPath = window.EmailSignatureGeneratorConfig && 
                             window.EmailSignatureGeneratorConfig.templatesPath ? 
                             window.EmailSignatureGeneratorConfig.templatesPath : '';
        
        // Determine correct base path based on asset type
        if (assetPath.startsWith('assets/icons/')) {
            // For icons, use the tool base URL
            assetUrl = toolBaseUrl + assetPath;
        } else if (assetPath.startsWith('assets/')) {
            // For other assets like logo, banner, etc.
            assetUrl = toolBaseUrl + assetPath;
        } else {
            // For template assets
            assetUrl = templatesPath + assetPath;
        }
        
        DEBUG.debug(`Converted asset path ${assetPath} to URL: ${assetUrl}`);
        return assetUrl;
    },

    /**
     * Converts an image to base64 if it isn't already
     * @param {HTMLImageElement} img - The image element
     * @returns {Promise<void>}
     */
    convertImageToBase64: async function(img) {
        // Skip if already data URL
        if (img.src.startsWith('data:')) {
            return;
        }
        
        try {
            // Try to get from storage if it's a user-uploaded image
            const uniqueId = img.getAttribute('data-unique-id');
            if (uniqueId) {
                const imageHandlers = window.EmailSignatureApp?.ImageHandlers;
                if (imageHandlers && typeof imageHandlers.getImageFromStorage === 'function') {
                    const imageData = imageHandlers.getImageFromStorage(uniqueId);
                    if (imageData) {
                        img.src = imageData;
                        return;
                    }
                }
            }
            
            // Otherwise fetch and convert
            const response = await fetch(img.src);
            const blob = await response.blob();
            const reader = new FileReader();
            
            await new Promise((resolve, reject) => {
                reader.onload = () => {
                    img.src = reader.result;
                    resolve();
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            DEBUG.error('Error converting image to base64:', error);
            // Keep original src on error
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = imageProcessing;
} else {
    // For browser environments
    if (typeof window !== 'undefined') {
        // Initialize the DEBUG module if it exists in the browser environment
        if (window.DEBUG && typeof window.DEBUG.init === 'function') {
            // Use the global EmailSignatureGeneratorConfig if available
            if (typeof EmailSignatureGeneratorConfig !== 'undefined') {
                window.DEBUG.init(EmailSignatureGeneratorConfig);
            } else {
                window.DEBUG.init({ debug: { enabled: true, logLevel: 'info' } });
            }
        }

        window.EmailSignatureApp = window.EmailSignatureApp || {};
        window.EmailSignatureApp.ImageProcessing = imageProcessing;
    }
}