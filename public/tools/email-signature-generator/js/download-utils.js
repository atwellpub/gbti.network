/**
 * Download Utilities for Email Signature Generator
 * Provides functions for creating downloadable zip files with email signatures
 */

// Import modules for module environment
if (typeof require !== 'undefined') {
    const ImageProcessing = require('./exporting/image-processing');
    const SocialMediaHandlers = require('./exporting/social-media-handlers');
    const DEBUG = require('./debug');
}

const downloadUtils = {
    /**
     * Creates a zip file with the email signature and all required assets
     * @param {HTMLElement} signatureElement - The signature element to download
     * @returns {Promise<Blob>} - A promise that resolves to a Blob containing the zip file
     */
    createSignatureZip: async function(signatureElement) {
        // Check if JSZip is loaded
        if (typeof JSZip === 'undefined') {
            DEBUG.error('JSZip library is not loaded');
            throw new Error('JSZip library is not loaded');
        }

        // Get the base URL for assets. Standalone (non-WordPress) toolBaseUrl is "", which is NOT a valid
        // base for new URL(path, base) and threw "Invalid base URL", killing icon/image bundling. Fall back
        // to the current page's directory so relative asset paths (assets/icons/...) resolve and fetch.
        let baseUrl = window.EmailSignatureGeneratorConfig &&
                     window.EmailSignatureGeneratorConfig.toolBaseUrl ?
                     window.EmailSignatureGeneratorConfig.toolBaseUrl :
                     window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        DEBUG.info(`Base URL for assets: ${baseUrl}`);

        // Create a new zip file
        const zip = new JSZip();

        // Clone the signature to avoid modifying the displayed one
        const signatureClone = signatureElement.cloneNode(true);

        // Remove the "Click to download" text if it exists
        const infoTexts = signatureClone.querySelectorAll('div');
        infoTexts.forEach(element => {
            if (element.textContent === 'Click to download' || element.textContent === 'Preparing download...') {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }
        });

        // Remove any event listeners and data attributes
        signatureClone.removeAttribute('data-index');
        signatureClone.style.cursor = 'default';

        // Check if this is the classic template
        const isClassicTemplate = signatureClone.classList.contains('signature-classic');
        DEBUG.info(`Is classic template: ${isClassicTemplate}`);

        // Access to the image processing module
        const imageProcessing = window.EmailSignatureApp.ImageProcessing;

        // Ensure all styles are inlined for email compatibility
        await window.EmailSignatureApp.ExportFileHtml.inlineStyles(signatureClone);

        // Clean up the HTML for email insertion
        window.EmailSignatureApp.ExportFileHtml.cleanupHtmlForEmail(signatureClone);

        // Create necessary folders in the zip
        const assetsFolder = zip.folder("assets");
        const iconsFolder = assetsFolder.folder("icons");
        
        // Track assets that have been added to avoid duplicates
        const addedAssets = new Set();
        
        // FIXED: First check if there are user-uploaded images in localStorage
        DEBUG.info('[DEBUG] Checking for user-uploaded images in storage before deciding on default assets');
        
        // Define image types to check
        const imageTypes = [
            { storageKey: 'signature-profile-image', type: 'profile' },
            { storageKey: 'signature-logo-image', type: 'logo' },
            { storageKey: 'signature-banner-image', type: 'banner' }
        ];
        
        // Function to check if user uploaded images exist
        const checkUserUploadedImages = () => {
            // Instead of a simple boolean, track which image types exist
            const userImageTypes = {
                profile: false,
                logo: false,
                banner: false
            };
            
            // Try to use ImageHandlers module first if available
            if (window.EmailSignatureApp && 
                window.EmailSignatureApp.ImageHandlers && 
                typeof window.EmailSignatureApp.ImageHandlers.getImageFromStorage === 'function') {
                
                DEBUG.info('[DEBUG] Using ImageHandlers to check for user-uploaded images');
                
                for (const imgType of imageTypes) {
                    const dataUrl = window.EmailSignatureApp.ImageHandlers.getImageFromStorage(imgType.storageKey);
                    if (dataUrl && dataUrl.startsWith('data:')) {
                        DEBUG.info(`[DEBUG] Found user-uploaded ${imgType.type} image in storage`);
                        userImageTypes[imgType.type] = true;
                    }
                }
            } 
            // Fallback for when ImageHandlers isn't available
            else {
                DEBUG.info('[DEBUG] ImageHandlers not available, checking localStorage directly');
                
                // Check regular localStorage first
                for (const imgType of imageTypes) {
                    const dataUrl = localStorage.getItem(imgType.storageKey);
                    if (dataUrl && dataUrl.startsWith('data:')) {
                        DEBUG.info(`[DEBUG] Found user-uploaded ${imgType.type} image in localStorage`);
                        userImageTypes[imgType.type] = true;
                    }
                }
                
                // Also check fallback memory object if available
                if (window._fallbackImages) {
                    for (const imgType of imageTypes) {
                        if (window._fallbackImages[imgType.storageKey] && 
                            window._fallbackImages[imgType.storageKey].startsWith('data:')) {
                            DEBUG.info(`[DEBUG] Found user-uploaded ${imgType.type} image in fallback memory`);
                            userImageTypes[imgType.type] = true;
                        }
                    }
                }
            }
            
            return userImageTypes;
        };
        
        // Check which specific user-uploaded images exist
        const userUploadedImageTypes = checkUserUploadedImages();
        
        // Determine if any user-uploaded images exist at all
        const hasAnyUserUploadedImages = Object.values(userUploadedImageTypes).some(exists => exists);
        
        DEBUG.info(`[DEBUG] User-uploaded images exist: ${JSON.stringify(userUploadedImageTypes)}`);
        
        // Array to store promises for asset fetching
        let assetPromises = [];
        
        // FIXED: Only fetch default assets for image types that don't have user uploads
        if (!hasAnyUserUploadedImages) {
            // Define default assets that should be included when no user uploads exist
            let defaultAssets = CONFIG.defaultAssets.getAssetsList(assetsFolder, iconsFolder);
            DEBUG.info('[DEBUG] No user-uploaded images found, using default assets from CONFIG');
            
            // Fetch and add all default assets to the zip
            DEBUG.info('[DEBUG] Fetching default assets...');
            assetPromises = defaultAssets.map(async (asset) => {
                try {
                    // Get asset URL using the ImageProcessing module
                    const assetUrl = imageProcessing.getAssetUrl(asset.path);
                    DEBUG.info(`[DEBUG] Fetching default asset: ${assetUrl}`);
                    const response = await fetch(assetUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${assetUrl}: ${response.status} ${response.statusText}`);
                    }
                    const blob = await response.blob();
                    const filename = asset.path.split('/').pop();
                    asset.folder.file(filename, blob);
                    addedAssets.add(assetUrl);
                    DEBUG.info(`[DEBUG] Added default asset to zip: ${asset.path}`);
                } catch (error) {
                    DEBUG.error(`[DEBUG] Failed to fetch default asset: ${asset.path}`, error);
                    throw new Error(`Failed to include asset ${asset.path}: ${error.message}`);
                }
            });
        } else {
            // Only fetch default assets for image types that don't have user uploads
            for (const imgType of imageTypes) {
                if (!userUploadedImageTypes[imgType.type]) {
                    const defaultAsset = CONFIG.defaultAssets.getAsset(imgType.type);
                    if (defaultAsset) {
                        DEBUG.info(`[DEBUG] No user-uploaded ${imgType.type} image found, using default asset`);
                        try {
                            // Assign the assets folder to the default asset
                            defaultAsset.folder = assetsFolder;
                            
                            // Get asset URL using the ImageProcessing module
                            const assetUrl = imageProcessing.getAssetUrl(defaultAsset.path);
                            DEBUG.info(`[DEBUG] Fetching default asset: ${assetUrl}`);
                            const assetPromise = fetch(assetUrl)
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error(`Failed to fetch ${assetUrl}: ${response.status} ${response.statusText}`);
                                    }
                                    return response.blob();
                                })
                                .then(blob => {
                                    const filename = defaultAsset.path.split('/').pop();
                                    assetsFolder.file(filename, blob);
                                    addedAssets.add(assetUrl);
                                    DEBUG.info(`[DEBUG] Added default asset to zip: ${defaultAsset.path}`);
                                })
                                .catch(error => {
                                    DEBUG.error(`[DEBUG] Failed to fetch default asset: ${defaultAsset.path}`, error);
                                });
                            
                            // Add the promise to the array of asset promises
                            assetPromises.push(assetPromise);
                        } catch (error) {
                            DEBUG.error(`[DEBUG] Failed to fetch default asset: ${defaultAsset.path}`, error);
                        }
                    }
                }
            }
        }

        // Step 2: Process user-uploaded images
        DEBUG.info('[DEBUG] Processing user-uploaded images for signature ZIP...');
        
        try {
            await imageProcessing.processUserUploadedImages(signatureClone, zip, assetsFolder);
            DEBUG.info('[DEBUG] Successfully processed user-uploaded images');
        } catch (error) {
            DEBUG.error('[DEBUG] Error while processing user-uploaded images:', error);
        }
        
        // Process all images in the signature
        let signatureImagePromises = imageProcessing.processSignatureImages(
            signatureClone, zip, assetsFolder, iconsFolder, addedAssets, baseUrl
        );

        DEBUG.info('[DEBUG] Processing signature images: ' + (signatureImagePromises ? signatureImagePromises.length : 0) + ' promises');
        
        // Process social icons using SocialMediaHandlers module
        const socialMediaHandlers = window.EmailSignatureApp.SocialMediaHandlers;
        let socialIconPromises = [];
        
        try {
            // processSocialIcons is async, so it returns a Promise (not the array). Without awaiting it,
            // the iterable check below failed, the icon fetch promises were dropped, and the zip generated
            // before the icons were fetched -> empty assets/icons/ (social icons missing from the export).
            const result = await socialMediaHandlers.processSocialIcons(
                zip, iconsFolder, signatureClone, addedAssets, baseUrl
            );
            
            // Make sure we have an iterable array
            if (result && typeof result[Symbol.iterator] === 'function') {
                socialIconPromises = result;
                DEBUG.info(`[DEBUG] Processing social icons: ${socialIconPromises.length} promises`);
            } else {
                DEBUG.warn('[DEBUG] processSocialIcons did not return an iterable array');
            }
        } catch (error) {
            DEBUG.error('[DEBUG] Error processing social icons:', error);
            // Continue with empty array to avoid breaking the zip creation
        }
        
        // Add social icon promises to the list
        signatureImagePromises = [...signatureImagePromises, ...socialIconPromises];
        
        // Wait for all promises to complete
        try {
            await Promise.all([...assetPromises, ...signatureImagePromises]);
            DEBUG.info('[DEBUG] All assets added to zip successfully');
        } catch (error) {
            DEBUG.error('[DEBUG] Error adding assets to zip:', error);
            throw new Error(`Failed to add assets to zip: ${error.message}`);
        }

        // Generate the HTML using the module
        const signatureHtml = window.EmailSignatureApp.ExportFileHtml.generateSignatureFileHtml(signatureClone.outerHTML);
        
        // Add the HTML file to the zip
        zip.file('index.html', signatureHtml);
        DEBUG.info('[DEBUG] Added signature HTML file to zip');
       
        // Generate the zip file
        try {
            const zipBlob = await zip.generateAsync({
                type: "blob"
            });
            
            DEBUG.info('[DEBUG] Zip file created successfully');
            return zipBlob;
        } catch (error) {
            DEBUG.error('[DEBUG] Error generating zip file:', error);
            throw new Error(`Failed to generate zip file: ${error.message}`);
        }
    },

    /** @deprecated use imageProcessing.dataUrlToBlob instead. @returns {Promise<Blob>} */
    dataUrlToBlob: function(dataUrl) {
        console.warn('downloadUtils.dataUrlToBlob is deprecated. Use imageProcessing.dataUrlToBlob instead.');
        return imageProcessing.dataUrlToBlob(dataUrl);
    },

    /** @returns {Promise} resolves once the download has been INITIATED, not once it completes. */
    downloadFile: function(blob, filename) {
        return new Promise((resolve, reject) => {
            try {
                DEBUG.info(`Initiating download for ${filename}`);
                
                // Create a URL for the blob
                const url = window.URL.createObjectURL(blob);
                
                // Create a download link
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                
                // Trigger the download
                a.click();
                
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    DEBUG.info(`Download initiated for ${filename}`);
                    resolve();
                }, 100);
            } catch (error) {
                DEBUG.error(`Error downloading file: ${error.message}`);
                reject(error);
            }
        });
    },
    
    /**
     * A 9-character base-36 suffix from Math.random. Collision-resistant enough to name files inside one
     * export, NOT unique in any stronger sense: do not use it as a durable key.
     */
    generateUniqueId: function() {
        return Math.random().toString(36).substr(2, 9);
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadUtils;
}

// For browser use
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
    window.EmailSignatureApp.DownloadUtils = downloadUtils;
}
