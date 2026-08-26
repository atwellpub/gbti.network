/**
 * Email Signature Generator Configuration
 * This file contains all configurable settings for the application
 */

// Define the CONFIG object in the global scope
const CONFIG = {
    /**
     * Application Settings
     */
    app: {
        title: "Email Signature Generator",
        version: "1.0.0",
    },

    /**
     * Debug Settings
     * Controls debug logging functionality
     */
    debug: {
        enabled: true,           // Set to false to disable all debug logging
        logLevel: 'debug',       // Possible values: 'error', 'warn', 'info', 'debug', 'trace'
        colorLogging: true,      // Enable color-specific logging for debugging color issues
        darkModeDebugging: true, // Enable specific debugging for dark mode issues
    },

    /**
     * Social Media Platforms
     * Centralized configuration for all supported social media platforms
     * Each platform includes:
     * - iconFile: The SVG icon filename
     * - placeholder: Example URL for placeholder text
     * - defaultValue: Default value to use if user doesn't provide one
     * - displayName: Human-readable name of the platform (optional)
     */
    socialPlatforms: {
        // Standard social media platforms
        linkedin: { 
            iconFile: 'linkedin.png',
            placeholder: "https://linkedin.com/in/yourusername",
            defaultValue: "",
            displayName: "LinkedIn"
        },
        x: { 
            iconFile: 'x.png',
            placeholder: "https://x.com/yourusername",
            defaultValue: "https://x.com/gbti_network",
            displayName: "X (Twitter)"
        },
        github: { 
            iconFile: 'github.png',
            placeholder: "https://github.com/yourusername",
            defaultValue: "https://github.com/gbti-network",
            displayName: "GitHub"
        },
        email: { 
            iconFile: 'email.png',
            placeholder: "your.email@example.com",
            defaultValue: "opportunities@gbti.network",
            displayName: "Mail Icon #1"
        },
        calendly: { 
            iconFile: 'calendly.png',
            placeholder: "https://calendly.com/yourusername/15min",
            defaultValue: "https://calendly.com/gbti_network/15min",
            displayName: "Calendly"
        },
        dribbble: { 
            iconFile: 'dribbble.png',
            placeholder: "https://dribbble.com/yourusername",
            defaultValue: "",
            displayName: "Dribbble"
        },
        facebook: { 
            iconFile: 'facebook.png',
            placeholder: "https://facebook.com/yourusername",
            defaultValue: "",
            displayName: "Facebook"
        },
        flickr: { 
            iconFile: 'flickr.png',
            placeholder: "https://flickr.com/photos/yourusername",
            defaultValue: "",
            displayName: "Flickr"
        },
        instagram: { 
            iconFile: 'instagram.png',
            placeholder: "https://instagram.com/yourusername",
            defaultValue: "",
            displayName: "Instagram"
        },
        mail: { 
            iconFile: 'mail.png',
            placeholder: "your.email@example.com",
            defaultValue: "opportunities@gbti.network",
            displayName: "Mail Icon #2"
        },
        pinterest: { 
            iconFile: 'pinterest.png',
            placeholder: "https://pinterest.com/yourusername",
            defaultValue: "",
            displayName: "Pinterest"
        },
        rss: { 
            iconFile: 'rss.png',
            placeholder: "https://yourblog.com/rss",
            defaultValue: "",
            displayName: "RSS"
        },
        tiktok: { 
            iconFile: 'tiktok.png',
            placeholder: "https://tiktok.com/@yourusername",
            defaultValue: "",
            displayName: "TikTok"
        },
        vimeo: { 
            iconFile: 'vimeo.png',
            placeholder: "https://vimeo.com/yourusername",
            defaultValue: "",
            displayName: "Vimeo"
        },
        wordpress: { 
            iconFile: 'wordpress.png',
            placeholder: "https://yourusername.wordpress.com",
            defaultValue: "https://profiles.wordpress.org/gbti/",
            displayName: "WordPress"
        },
        youtube: { 
            iconFile: 'youtube.png',
            placeholder: "https://www.youtube.com/channel/yourusername",
            defaultValue: "https://www.youtube.com/channel/UCh4FjB6r4oWQW-QFiwqv-UA",
            displayName: "YouTube"
        },
        // Additional platforms
        devto: { 
            iconFile: 'devto.png',
            placeholder: "https://dev.to/yourusername",
            defaultValue: "https://dev.to/gbti",
            displayName: "Dev.to"
        },
        dailydev: { 
            iconFile: 'dailydev.png',
            placeholder: "https://dly.to/yourusername",
            defaultValue: "https://app.daily.dev/gbti",
            displayName: "Daily.dev"
        },
        reddit: { 
            iconFile: 'reddit.png',
            placeholder: "https://www.reddit.com/r/yourusername",
            defaultValue: "https://www.reddit.com/r/GBTI_network",
            displayName: "Reddit"
        },
        bluesky: { 
            iconFile: 'bluesky.png',
            placeholder: "https://bsky.app/profile/yourusername",
            defaultValue: "",
            displayName: "Bluesky"
        },
        hashnode: { 
            iconFile: 'hashnode.png',
            placeholder: "https://yourusername.hashnode.dev",
            defaultValue: "",
            displayName: "Hashnode"
        },
        medium: { 
            iconFile: 'medium.png',
            placeholder: "https://medium.com/@yourusername",
            defaultValue: "",
            displayName: "Medium"
        },
        stackoverflow: { 
            iconFile: 'stackoverflow.png',
            placeholder: "https://stackoverflow.com/users/youruserid",
            defaultValue: "",
            displayName: "Stack Overflow"
        },
        discord: { 
            iconFile: 'discord.png',
            placeholder: "https://discord.gg/yourinvite",
            defaultValue: "",
            displayName: "Discord"
        },
        slack: { 
            iconFile: 'slack.png',
            placeholder: "https://yourworkspace.slack.com",
            defaultValue: "",
            displayName: "Slack"
        },
        telegram: { 
            iconFile: 'telegram.png',
            placeholder: "https://t.me/yourusername",
            defaultValue: "",
            displayName: "Telegram"
        },
        behance: { 
            iconFile: 'behance.png',
            placeholder: "https://www.behance.net/yourusername",
            defaultValue: "",
            displayName: "Behance"
        },
        codepen: { 
            iconFile: 'codepen.png',
            placeholder: "https://codepen.io/yourusername",
            defaultValue: "",
            displayName: "CodePen"
        },
        twitch: { 
            iconFile: 'twitch.png',
            placeholder: "https://www.twitch.tv/yourusername",
            defaultValue: "",
            displayName: "Twitch"
        },
        whatsapp: { 
            iconFile: 'whatsapp.png',
            placeholder: "https://wa.me/yourusername",
            defaultValue: "",
            displayName: "WhatsApp"
        },
        paypal: { 
            iconFile: 'paypal.png',
            placeholder: "https://paypal.me/yourusername",
            defaultValue: "",
            displayName: "PayPal"
        },
        buymeacoffee: { 
            iconFile: 'buymeacoffee.png',
            placeholder: "https://www.buymeacoffee.com/yourusername",
            defaultValue: "",
            displayName: "Buy Me a Coffee"
        },
        patreon: { 
            iconFile: 'patreon.png',
            placeholder: "https://www.patreon.com/yourusername",
            defaultValue: "",
            displayName: "Patreon"
        },
        spotify: { 
            iconFile: 'spotify.png',
            placeholder: "https://open.spotify.com/user/yourusername",
            defaultValue: "",
            displayName: "Spotify"
        }
    },

    /**
     * Default Values
     * These values will be used as defaults if no user input is provided
     */
    defaults: {
        // Personal Information
        name: "🤖 Email Signature Generator",
        title: "Curator @ GBTI Network", 
        email: "opportunities@gbti.network",
        calendly: "https://calendly.com/gbti_network/15min",
        calendlyText: "Schedule a 15min call",
        company: "GBTI Network",
        
        // Social Media
        linkedin: "",
        x: "https://x.com/gbti_network",
        github: "https://github.com/gbti-network",
        youtube: "https://www.youtube.com/channel/UCh4FjB6r4oWQW-QFiwqv-UA",
        devto: "https://dev.to/gbti",
        dailydev: "https://app.daily.dev/gbti",
        reddit: "https://www.reddit.com/r/GBTI_network",
        wordpress: "https://profiles.wordpress.org/gbti/",
        bluesky: "",
        pinterest: "",
        instagram: "",
        facebook: "",
        dribbble: "",
        tiktok: "",
        flickr: "",
        whatsapp: "",
        etsy: "",
        paypal: "",
        buymeacoffee: "",
        patreon: "",
        spotify: "",
        behance: "",
        
        // Colors
        primaryColor: "#0077B5",
        textColor: "#333333",
        backgroundColor: "#ffffff",
    },

    /**
     * Placeholders for form fields
     */
    placeholders: {
        name: "Your Name",
        title: "Your Job Title",
        company: "Your Company",
        email: "your.email@example.com",
        calendly: "https://calendly.com/yourusername/15min",
        calendlyText: "Schedule a meeting",
        linkedin: "https://linkedin.com/in/yourusername",
        x: "https://x.com/yourusername",
        github: "https://github.com/yourusername",
        youtube: "https://www.youtube.com/channel/yourusername",
        devto: "https://dev.to/yourusername",
        dailydev: "https://dly.to/yourusername",
        reddit: "https://www.reddit.com/r/yourusername",
        wordpress: "https://yourusername.wordpress.com",
        bluesky: "https://bsky.app/profile/yourusername",
        pinterest: "https://pinterest.com/yourusername",
        instagram: "https://instagram.com/yourusername",
        facebook: "https://facebook.com/yourusername",
        dribbble: "https://dribbble.com/yourusername",
        tiktok: "https://tiktok.com/@yourusername",
        flickr: "https://flickr.com/photos/yourusername",
        whatsapp: "https://wa.me/yourusername",
        etsy: "https://www.etsy.com/shop/yourshopname",
        paypal: "https://paypal.me/yourusername",
        buymeacoffee: "https://www.buymeacoffee.com/yourusername",
        patreon: "https://www.patreon.com/yourusername",
        spotify: "https://open.spotify.com/user/yourusername",
        behance: "https://www.behance.net/yourusername",
    },

    /**
     * Image Settings
     * Configuration for image uploads
     */
    images: {
        profile: {
            id: "profile-image-upload",
            previewId: "profile-image-preview-img",
            storageKey: "signature-profile-image",
            defaultSrc: "assets/profile-image.jpg",
            recommendedSize: "200x200px square",
        },
        logo: {
            id: "logo-image-upload",
            previewId: "logo-image-preview-img",
            storageKey: "signature-logo-image",
            defaultSrc: "assets/logo-image.png",
            recommendedSize: "100x100px square",
        },
        banner: {
            id: "banner-image-upload",
            previewId: "banner-image-preview-img",
            storageKey: "signature-banner-image",
            defaultSrc: "assets/banner-image.png",
            recommendedSize: "600x150px",
        },
    },

    /**
     * Color Settings
     * Configuration for color pickers
     */
    colors: {
        primary: {
            id: "input-primary-color",
            lightStorageKey: "signature-light-primary-color",
            darkStorageKey: "signature-dark-primary-color",
            cssVar: "--primary-color",
            description: "Used for name and main text",
        },
        secondary: {
            id: "input-secondary-color",
            lightStorageKey: "signature-light-secondary-color",
            darkStorageKey: "signature-dark-secondary-color",
            cssVar: "--secondary-color",
            description: "Used for title, contact info, and gradients",
        },
        accent: {
            id: "input-accent-color",
            lightStorageKey: "signature-light-accent-color",
            darkStorageKey: "signature-dark-accent-color",
            cssVar: "--accent-color",
            description: "Used for links and highlights",
        },
        background: {
            id: "input-background-color",
            lightStorageKey: "signature-light-background-color",
            darkStorageKey: "signature-dark-background-color",
            cssVar: "--background-color",
            description: "Background color for signatures",
        },
        light: {
            primary: "#333333",
            secondary: "#666666",
            accent: "#0077B5",
            background: "#ffffff"
        },
        dark: {
            primary: "#ffffff",
            secondary: "#cccccc",
            accent: "#1da1f2",
            background: "#2d2d2d"
        }
    },

    darkMode: {
        toggleId: "dark-mode-toggle",
        storageKey: "signature-dark-mode",
        bodyClass: "dark-mode",
        defaultLabel: "Switch to Dark Mode",
        activeLabel: "Dark Mode (Signatures Only)",
    },

    /**
     * Signature Templates
     */
    signatures: {
        classic: {
            id: "classic-signature",
            name: "Classic Signature",
        },
        modern: {
            id: "modern-signature",
            name: "Modern Signature",
        },
        animated: {
            id: "animated-signature",
            name: "Animated Signature",
        },
        minimalist: {
            id: "minimalist-signature",
            name: "Minimalist Signature",
        },
    },

    /**
     * Default Assets for ZIP Export
     * These assets will be included in every signature ZIP export
     */
    defaultAssets: {
        images: [
            'assets/profile-image.jpg',
            'assets/logo-image.png',
            'assets/banner-image.png'
        ],
        icons: [
            'assets/icons/linkedin.png',
            'assets/icons/x.png', 
            'assets/icons/github.png',
            'assets/icons/email.png',
            'assets/icons/calendly.png'
        ],
        // A function to get all default assets as an array with folder information
        getAssetsList: function(assetsFolder, iconsFolder) {
            const assets = [];
            
            // Add image assets
            this.images.forEach(path => {
                assets.push({ path: path, folder: assetsFolder });
            });
            
            // Add icon assets
            this.icons.forEach(path => {
                assets.push({ path: path, folder: iconsFolder });
            });
            
            return assets;
        },
        
        // Get a specific asset configuration based on type
        getAsset: function(type) {
            let assetPath = '';
            
            // Map type to appropriate asset path
            switch(type) {
                case 'profile':
                    assetPath = 'assets/profile-image.jpg';
                    break;
                case 'logo':
                    assetPath = 'assets/logo-image.png';
                    break;
                case 'banner':
                    assetPath = 'assets/banner-image.png';
                    break;
                default:
                    return null;
            }
            
            return { path: assetPath, folder: null }; // folder will be assigned in download-utils.js
        }
    }
};

// Initialize DEBUG module with configuration
if (typeof DEBUG !== 'undefined' && typeof DEBUG.init === 'function') {
    DEBUG.init(CONFIG);
}

// Create a global EmailSignatureApp namespace for template registration
window.EmailSignatureApp = {
    templates: [],
    
    /** @param {Object} template - { name, displayName, description, htmlPath, cssPath } */
    registerTemplate: function(template) {
        DEBUG.info(`Registering template: ${template.name}`);
        
        // Fix template paths for WordPress environment
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            if (template.paths) {
                // Fix HTML path
                if (template.paths.html && !template.paths.html.startsWith('http')) {
                    template.paths.html = EmailSignatureGeneratorConfig.toolBaseUrl + template.paths.html;
                }
                
                // Fix CSS path
                if (template.paths.css && !template.paths.css.startsWith('http')) {
                    template.paths.css = EmailSignatureGeneratorConfig.toolBaseUrl + template.paths.css;
                }
            }
        }
        
        this.templates.push(template);
    },
    
    getTemplates: function() {
        return this.templates;
    },
    
    /** @returns {Object|null} the registered template, or null when `name` is unknown. */
    getTemplate: function(name) {
        const template = this.templates.find(t => t.name === name);
        if (!template) {
            console.error(`Template ${name} not found`);
        }
        return template || null;
    },
    
    /**
     * Prefix relative html/css/asset paths with the WordPress templates root. MUTATES `paths` in place and
     * also returns it. Outside WordPress (no EmailSignatureGeneratorConfig.isWordPress) it is a no-op, so a
     * caller cannot use the return value to tell whether anything was rewritten.
     */
    fixAssetPaths: function(paths) {
        // Check if we're running in WordPress environment
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            // Handle template HTML path
            if (paths.html && !paths.html.startsWith('http')) {
                paths.html = EmailSignatureGeneratorConfig.templatesPath + paths.html;
            }
            
            // Handle template CSS path
            if (paths.css && !paths.css.startsWith('http')) {
                paths.css = EmailSignatureGeneratorConfig.templatesPath + paths.css;
            }
            
            // Handle template image paths or other assets
            if (paths.assets) {
                Object.keys(paths.assets).forEach(function(key) {
                    if (typeof paths.assets[key] === 'string' && !paths.assets[key].startsWith('http')) {
                        paths.assets[key] = EmailSignatureGeneratorConfig.templatesPath + paths.assets[key];
                    }
                });
            }
            
            return paths;
        }
        
        // Original behavior for non-WordPress environment
        // Replace all template/TEMPLATE/ paths with just TEMPLATE/
        if (paths.html && paths.html.indexOf('templates/') !== -1) {
            const templateName = paths.html.split('/')[1];
            paths.html = paths.html.replace(`xxtemplates/${templateName}/`, `${templateName}/`);
        }
        
        if (paths.css && paths.css.indexOf('templates/') !== -1) {
            const templateName = paths.css.split('/')[1];
            paths.css = paths.css.replace(`xxtemplates/${templateName}/`, `${templateName}/`);
        }
        
        return paths;
    },
    
    /**
     * Process template HTML to fix asset paths for WordPress environment
     * @param {string} html The template HTML content
     * @param {string} templateName The name of the template
     * @returns {string} The processed HTML with fixed asset paths
     */
    processTemplateHtml: function(html, templateName) {
        try {
            DEBUG.info(`Processing template HTML for: ${templateName}`);
            
            // Check if we're running in WordPress environment
            if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                // Create temporary element to parse HTML
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                
                // Process all elements with URLs
                var processElement = function(element) {
                    // Process src attributes
                    if (element.hasAttribute('src')) {
                        var src = element.getAttribute('src');
                        if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
                            // Handle assets path
                            if (src.startsWith('assets/')) {
                                element.setAttribute('src', EmailSignatureGeneratorConfig.toolBaseUrl + src);
                            }
                        }
                    }
                    
                    // Process background images in style attributes
                    if (element.hasAttribute('style')) {
                        var style = element.getAttribute('style');
                        var newStyle = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, function(match, url) {
                            if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('/')) {
                                if (url.startsWith('assets/')) {
                                    return "url('" + EmailSignatureGeneratorConfig.toolBaseUrl + url + "')";
                                }
                            }
                            return match;
                        });
                        element.setAttribute('style', newStyle);
                    }
                    
                    // Process all children recursively
                    Array.from(element.children).forEach(processElement);
                };
                
                // Process the root element
                processElement(tempDiv);
                
                return tempDiv.innerHTML;
            }
            
            // For non-WordPress environment, return the original HTML
            return html;
        } catch (error) {
            console.error('Error processing template HTML:', error);
            return html;
        }
    },
    
    /**
     * Load a template into a container element
     * @param {string} templateName - Name of the template to load
     * @param {string} containerId - ID of the container element
     * @returns {Promise} - Promise that resolves when the template is loaded
     */
    loadTemplate: function(templateName, containerId) {
        return new Promise((resolve, reject) => {
            try {
                // Get the template
                const template = this.getTemplate(templateName);
                if (!template) {
                    console.error(`Template ${templateName} not found`);
                    document.getElementById(containerId).textContent = `Failed to load ${templateName} signature template`;
                    reject(`Template ${templateName} not found`);
                    return;
                }
                
                // Get the container
                const container = document.getElementById(containerId);
                if (!container) {
                    console.error(`Container ${containerId} not found`);
                    reject(`Container ${containerId} not found`);
                    return;
                }
                
                // Load the HTML template
                fetch(template.paths.html)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Failed to load ${templateName} HTML template: ${response.status} ${response.statusText}`);
                        }
                        return response.text();
                    })
                    .then(html => {
                        // Fix asset paths
                        html = this.processTemplateHtml(html, templateName);
                        
                        // Set the HTML content
                        container.innerHTML = html;
                        
                        // Initialize the template
                        if (typeof template.initialize === 'function') {
                            template.initialize(container);
                        }
                        
                        // Update the signature with current form values (only if updateSignatures exists)
                        if (typeof window.updateSignatures === 'function') {
                            try {
                                window.updateSignatures();
                            } catch (e) {
                                console.error(`Error updating signatures: ${e.message}`);
                            }
                        }
                        
                        resolve(container);
                    })
                    .catch(error => {
                        console.error(`Error loading ${templateName} template:`, error);
                        container.textContent = `Failed to load ${templateName} signature template`;
                        reject(error);
                    });
            } catch (error) {
                console.error(`Error in loadTemplate:`, error);
                document.getElementById(containerId).textContent = `Failed to load ${templateName} signature template`;
                reject(error);
            }
        });
    },
    
    /**
     * Read and JSON.parse a stored value. Returns the PARSED value, not the raw string, and null both when
     * the key is absent and when the stored text fails to parse, so a corrupt entry is indistinguishable
     * from a missing one.
     */
    loadFromLocalStorage: function(key) {
        try {
            const data = localStorage.getItem(key);
            if (data) {
                return JSON.parse(data);
            }
            return null;
        } catch (error) {
            console.error(`Error loading data from localStorage: ${error.message}`);
            return null;
        }
    },
    
    /**
     * JSON.stringify a value into localStorage. Returns nothing and swallows a failed write (a quota
     * error is logged, not thrown), so a caller never learns the save did not happen.
     */
    saveToLocalStorage: function(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            console.error(`Error saving data to localStorage: ${error.message}`);
        }
    },
};

// Dispatch an event when the app is ready
document.addEventListener('DOMContentLoaded', function() {
    const event = new CustomEvent('EmailSignatureAppReady');
    document.dispatchEvent(event);
});
