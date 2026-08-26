/**
 * Social Media Handlers for Email Signature Generator
 * Provides functions for processing social media icons during export
 * This is the dedicated module for all social icon processing
 */

// Import the DEBUG module if we're in a module environment
if (typeof require !== 'undefined') {
    const DEBUG = require('../debug');
}

const socialMediaHandlers = {
    /**
     * @returns {string} Under WordPress, toolBaseUrl + iconPath, prepended UNCONDITIONALLY, so an
     * already-absolute iconPath comes back mangled. Otherwise resolved against baseUrl, which handles it.
     */
    getIconUrl: function(iconPath, baseUrl) {
        // In WordPress environments, prepend path with toolBaseUrl
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            return EmailSignatureGeneratorConfig.toolBaseUrl + iconPath;
        }
        
        // For non-WordPress environments, use the baseUrl
        return new URL(iconPath, baseUrl).href;
    },

    /**
     * Process social icons for zip download
     * @param {Object} zip - The JSZip instance
     * @param {Object} iconsFolder - The icons folder in the zip
     * @param {HTMLElement} signatureClone - The signature element clone
     * @param {Set} addedAssets - Set of already added assets
     * @param {String} baseUrl - Base URL for assets
     * @returns {Promise<Array>} - Array of promises for icon fetching
     */
    processSocialIcons: async function(zip, iconsFolder, signatureClone, addedAssets, baseUrl) {
        // Use the WordPress tool base URL if available
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            baseUrl = EmailSignatureGeneratorConfig.toolBaseUrl;
        }
        
        // Track promises for icon fetching
        const signatureImagePromises = [];
        
        // Get social icon filenames from CONFIG if available, otherwise use fallback
        let socialIcons = [];
        
        // Extract icon filenames from the new consolidated CONFIG.socialPlatforms structure
        socialIcons = Object.values(CONFIG.socialPlatforms).map(platform => platform.iconFile);
        
        // Create a map to track icon status
        const iconStatus = new Map();
        
        // Add social icons to the zip
        for (const iconName of socialIcons) {
            const iconUrl = this.getIconUrl(`assets/icons/${iconName}`, baseUrl);
            
            if (!addedAssets.has(iconUrl)) {
                try {
                    const iconPromise = fetch(iconUrl)
                        .then(response => {
                            if (!response.ok) {
                                DEBUG.warn(`Social icon not found: ${iconName} (this is normal if it doesn't exist in icons folder)`);
                                iconStatus.set(iconName, { regular: false });
                                return null;
                            }
                            return response.blob();
                        })
                        .then(blob => {
                            if (blob) {
                                iconsFolder.file(iconName, blob);
                                addedAssets.add(iconUrl);
                                //DEBUG.info(`Added social icon to zip: ${iconName}`);
                                iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: true });
                            }
                        })
                        .catch(error => {
                            DEBUG.warn(`Error fetching social icon ${iconName}: ${error.message}`);
                            iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: false, regularError: error.message });
                        });
                    
                    if (iconPromise) {
                        signatureImagePromises.push(iconPromise);
                    }
                } catch (error) {
                    DEBUG.error(`Error processing social icon ${iconName}:`, error);
                    iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: false, regularError: error.message });
                }
            } else {
                iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: true });
            }
        }
        
        // Scan signature elements for social icons
        this.scanSignatureForIcons(
            signatureClone, 
            iconsFolder, 
            addedAssets, 
            baseUrl, 
            socialIcons, 
            iconStatus, 
            signatureImagePromises
        );
        
        // Handle additional icon scanning for completeness
        this.scanForAdditionalIcons(
            iconsFolder, 
            addedAssets, 
            baseUrl, 
            socialIcons, 
            iconStatus, 
            signatureImagePromises
        );
        
        // Generate a summary of included icons for debugging
        setTimeout(() => {
            DEBUG.debug("Social Icon Inclusion Summary:");
            DEBUG.debug("Icon Status", Object.fromEntries([...iconStatus.entries()].map(([icon, status]) => [icon, status])));
        }, 1000);
        
        return signatureImagePromises;
    },
    
    /**
     * Scan the signature for social icons used and add them to the zip
     * @param {HTMLElement} signatureClone - The signature element clone
     * @param {Object} iconsFolder - The icons folder in the zip
     * @param {Set} addedAssets - Set of already added assets
     * @param {String} baseUrl - Base URL for assets
     * @param {Array} socialIcons - List of social icon filenames
     * @param {Map} iconStatus - Map to track icon status
     * @param {Array} signatureImagePromises - Array to collect promises
     */
    scanSignatureForIcons: async function(signatureClone, iconsFolder, addedAssets, baseUrl, socialIcons, iconStatus, signatureImagePromises) {
        // First, try to identify any social icons actually used in the signature
        // This ensures we include all icons that are in use, even if they're not in our standard list
        const usedIconClasses = new Set();
        const socialIconElements = signatureClone.querySelectorAll('.social-icon, [class*="-icon"]');
        
        socialIconElements.forEach(icon => {
            // Extract platform name from class names like 'linkedin-icon', 'es-github-icon', etc.
            Array.from(icon.classList).forEach(className => {
                if (className.endsWith('-icon') && className !== 'social-icon') {
                    const platform = className.replace('-icon', '');
                    usedIconClasses.add(platform);
                }
            });
            
            // Also check for icons through src attribute containing platform names
            if (icon.tagName === 'IMG' && icon.src) {
                const src = icon.src.toLowerCase();
                socialIcons.forEach(iconName => {
                    const platform = iconName.replace('.png', '');
                    if (src.includes(platform)) {
                        usedIconClasses.add(platform);
                    }
                });
            }
        });
        
        // Add any discovered platforms to our processing list
        DEBUG.info("Found social icons used in signature:", Array.from(usedIconClasses));
        for (const platform of usedIconClasses) {
            const iconName = `${platform}.png`;
            
            // Skip if already in our main list
            if (socialIcons.includes(iconName)) {
                continue;
            }
            
            // Add to our list for processing
            socialIcons.push(iconName);
            DEBUG.info(`Adding discovered icon to processing list: ${iconName}`);
            
            // Process regular and colored versions of the icon
            const regularIconUrl = this.getIconUrl(`assets/icons/${iconName}`, baseUrl);
            
            // Only process if not already added
            if (!addedAssets.has(regularIconUrl)) {
                try {
                    const regularIconPromise = fetch(regularIconUrl)
                        .then(response => {
                            if (!response.ok) return null;
                            return response.blob();
                        })
                        .then(blob => {
                            if (blob) {
                                iconsFolder.file(iconName, blob);
                                addedAssets.add(regularIconUrl);
                                DEBUG.info(`Added discovered regular icon to zip: ${iconName}`);
                                iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: true });
                            }
                        })
                        .catch(() => {
                            // Silently continue if regular version doesn't exist
                        });
                    
                    signatureImagePromises.push(regularIconPromise);
                } catch (error) {
                    DEBUG.error(`Error processing discovered regular icon ${iconName}:`, error);
                }
            }
        }
    },
    
    /**
     * Scan for additional icons that might be available
     * @param {Object} iconsFolder - The icons folder in the zip
     * @param {Set} addedAssets - Set of already added assets
     * @param {String} baseUrl - Base URL for assets
     * @param {Array} socialIcons - List of social icon filenames
     * @param {Map} iconStatus - Map to track icon status
     * @param {Array} signatureImagePromises - Array to collect promises
     */
    scanForAdditionalIcons: async function(iconsFolder, addedAssets, baseUrl, socialIcons, iconStatus, signatureImagePromises) {
        try {
            DEBUG.info("Scanning for all available icons...");
            
            // Create a comprehensive list to check, including all known social platforms
            const allPossibleIcons = [
                ...socialIcons
            ];
            
            // Process each potential icon
            for (const iconName of allPossibleIcons) {
                // Skip if we already included this specific icon name
                if (addedAssets.has(this.getIconUrl(`assets/icons/${iconName}`, baseUrl))) {
                    continue;
                }
                
                const iconUrl = this.getIconUrl(`assets/icons/${iconName}`, baseUrl);
                
                try {
                    const additionalIconPromise = fetch(iconUrl)
                        .then(response => {
                            if (!response.ok) {
                                return null;
                            }
                            return response.blob();
                        })
                        .then(blob => {
                            if (blob) {
                                iconsFolder.file(iconName, blob);
                                addedAssets.add(iconUrl);
                                //DEBUG.info(`Added additional icon to zip: ${iconName}`);
                                iconStatus.set(iconName, { ...(iconStatus.get(iconName) || {}), regular: true });
                            }
                        })
                        .catch(() => {
                            // Silently continue if icon doesn't exist
                        });
                        
                    if (additionalIconPromise) {
                        signatureImagePromises.push(additionalIconPromise);
                    }
                } catch (error) {
                    DEBUG.error(`Error processing additional icon ${iconName}:`, error);
                }
            }
        } catch (error) {
            DEBUG.warn("Could not scan for additional icons:", error.message);
        }
    }

};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = socialMediaHandlers;
}

// For browser use
if (typeof window !== 'undefined') {
    if (!window.EmailSignatureApp) {
        window.EmailSignatureApp = {};
    }
    
    // Initialize the DEBUG module if it exists in the browser environment
    if (window.DEBUG && typeof window.DEBUG.init === 'function') {
        // Use the global EmailSignatureGeneratorConfig if available
        if (typeof EmailSignatureGeneratorConfig !== 'undefined') {
            window.DEBUG.init(EmailSignatureGeneratorConfig);
        } else {
            window.DEBUG.init({ debug: { enabled: true, logLevel: 'info' } });
        }
    }
    
    window.EmailSignatureApp.SocialMediaHandlers = socialMediaHandlers;
}