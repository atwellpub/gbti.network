/**
 * Export File HTML Template Module for Email Signature Generator
 * Contains the HTML template used for the exported signature HTML file
 */

const exportFileHtml = {
    /** @returns {string} a complete standalone HTML document wrapping `signatureHtml`. */
    generateSignatureFileHtml: function(signatureHtml) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Signature</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; line-height: 1.6; color: #333; }
        h1 { color: #333; margin-bottom: 20px; }
        h2 { color: #0077B5; margin-top: 30px; }
        .container { max-width: 800px; margin: 0 auto; }
        .signature-container { margin: 20px 0; border: 2px dashed #0038b5; padding: 20px; font-size: 14px; }
        .instructions { background-color: #f9f9f9; padding: 18px 20px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 30px; }
        .html-container { margin-top: 20px; }
        textarea { width: 100%; height: 200px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; margin-top: 10px; resize: vertical; font-size: 11px; }
        .copy-btn { width: 100%; background-color: #656565; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; }
        .copy-btn:hover { background-color: #005e8b; }
        .copy-btn:active { transform: scale(0.98); }
        
        .support-section {
            margin-top: 40px;
            background-color: #f9f9f9;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
        }
        .support-section h3 {
            color: #333;
            margin: 25px 0 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }
        .support-option {
            margin-bottom: 30px;
            background-color: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid #eaeaea;
        }
        .support-option:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .support-option h4 {
            margin-top: 0;
            color: #0077B5;
            font-size: 1.3em;
            border-bottom: 2px solid #f1f1f1;
            padding-bottom: 10px;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        .support-option h4 img {
            margin-right: 10px;
            width: 30px;
            height: 30px;
            object-fit: contain;
        }
        .support-option a {
            text-decoration: none;
            color: #0077B5;
            display: inline-block;
            padding: 5px 0;
            transition: color 0.2s;
        }
        .support-option a:hover {
            text-decoration: underline;
            color: #005e8b;
        }
        .support-option .cta-button {
            display: inline-block;
            background-color: #0077B5;
            color: white;
            text-decoration: none;
            padding: 10px 20px;
            border-radius: 4px;
            font-weight: bold;
            margin-top: 10px;
            transition: background-color 0.2s;
        }
        .support-option .cta-button:hover {
            background-color: #4eb34f;
            text-decoration: none;
            color:#fff;
        }
        .support-option ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .support-option li {
            margin-bottom: 10px;
        }
        .thank-you {
            font-size: 16px;
            color: #666;
            margin-top: 30px;
            text-align: center;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="instructions">
            <h1>Your Email Signature</h1>
            <p>This file displays your signature with paths that can be used when hosting on a web server. To use your signature:</p>
            <ol>
                <li>Click the "Copy HTML" button below to copy the signature HTML</li>
                <li>Paste it into your email client's signature settings</li>
                <li>If your signature contains images, you'll need to host them online or attach them to your email client's signature settings</li>
            </ol>
            <p><strong>Gmail users:</strong> You can simply select and copy the signature preview below directly and paste it into the signature box in Google settings.</p>
        </div>

        <h2>Signature Preview</h2>
        <div class="signature-container" id="signature-preview">
            ${signatureHtml}
        </div>

        <h2>Signature HTML</h2>
        <div class="html-container">
            <textarea id="html-content" readonly></textarea>  
            <button class="copy-btn" id="copy-button">Copy HTML</button>
        </div>
        <h2>Support Our Work</h2>
        <div class="support-section">
            <p style="font-size: 14px;">Thanks for using the <a href="https://gbti.network/utilities/email-signature-generator/" target="_blank"><b>Email Signature Generator</b></a>. We hope this tool has helped you create an email signature that you enjoy. Please consider supporting us by reading about the following offers. </p>
            
            <div class="support-option">
                <h4><img src="https://gbti.network/tools/email-signature-generator/assets/gbti-logo.png" alt="GBTI Network Logo"> Join the GBTI Network!!! 🙏🙏🙏</h4>
                <p style="font-size: 11px;">The GBTI Network is a community of developers who are passionate about open source and community-driven development. Members enjoy access to exclusive tools, resources, a listing in our members directory, co-op opportunities and more.</p>
                <a href="https://gbti.network/membership/" target="_blank" class="cta-button">Become a GBTI Network member</a>
            </div>

            <div class="support-option">
                <h4>📡 Stay Connected</h4>
                <p style="font-size: 11px;">Follow us on your favorite platforms for updates, news, and community discussions:</p>
                <ul>
                <li><a href="https://www.reddit.com/r/GBTI_network" target="_blank">Reddit Community</a></li>
                    <li><a href="https://x.com/gbti_network" target="_blank">Twitter/X</a></li>
                    <li><a href="https://github.com/gbti-network" target="_blank">GitHub</a></li>
                    <li><a href="https://www.youtube.com/channel/UCh4FjB6r4oWQW-QFiwqv-UA" target="_blank">YouTube</a></li>
                    <li><a href="https://dev.to/gbti" target="_blank">Dev.to</a></li>
                    <li><a href="https://dly.to/zfCriM6JfRF" target="_blank">Daily.dev</a></li>
                    <li><a href="https://gbti.hashnode.dev/" target="_blank">Hashnode</a></li>
                    <li><a href="https://gbti.network" target="_blank">Discord Community</a></li>
                </ul>
            </div>
            
            <p class="thank-you">Thank you for supporting the GBTI Network 🙏</p>
        </div>
    </div>

    

    <script>
        // Function to convert relative paths to absolute URLs
        function convertToAbsolutePaths() {
            // Get base URL dynamically
            const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            
            // Get the signature container
            const signatureElement = document.getElementById('signature-preview').firstElementChild;
            
            // Get all images
            const images = signatureElement.querySelectorAll('img');
            
            // Replace relative paths with absolute URLs
            images.forEach(img => {
                const src = img.getAttribute('src');
                if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
                    img.setAttribute('src', baseUrl + src);
                }
            });
            
            // Get all links
            const links = signatureElement.querySelectorAll('a');
            
            // Replace relative paths with absolute URLs
            links.forEach(link => {
                const href = link.getAttribute('href');
                if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                    link.setAttribute('href', baseUrl + href);
                }
            });
            
            // Update the textarea with the signature HTML
            const htmlContent = document.getElementById('html-content');
            htmlContent.value = signatureElement.outerHTML;
        }
        
        // Function to copy the HTML to clipboard
        function copyHTML() {
            const htmlContent = document.getElementById('html-content');
            htmlContent.select();
            document.execCommand('copy');
            
            const copyButton = document.getElementById('copy-button');
            copyButton.textContent = 'Copied!';
            copyButton.style.backgroundColor = '#4eb34f';
            
            setTimeout(() => {
                copyButton.textContent = 'Copy HTML';
                copyButton.style.backgroundColor = '#656565';
            }, 2000);
        }
        
        // Initialize when the page loads
        window.addEventListener('DOMContentLoaded', () => {
            convertToAbsolutePaths();
            
            // Add copy button functionality
            const copyButton = document.getElementById('copy-button');
            copyButton.addEventListener('click', copyHTML);
        });
    </script>
</body>
</html>`;
    },
    
    /**
     * Cleans up HTML for email compatibility
     * @param {HTMLElement} element - The element to process
     */
    cleanupHtmlForEmail: function(element) {
        DEBUG.info('Cleaning up HTML for email compatibility...');
        
        // Make container elements responsive
        if (element.classList.contains('signature')) {
            DEBUG.info('Updating signature container styles for email clients...');
            
            // Set width to auto instead of 100% for email clients
            element.style.width = 'auto';
            element.style.maxWidth = '800px'; // Common email-safe width
            
            
            // Ensure styles are applied with !important to override any CSS
            element.setAttribute('style', element.getAttribute('style') + '; position: static; width: auto;');
            
            // Remove any inset or opacity properties
            element.style.removeProperty('inset');
            element.style.removeProperty('opacity');
            element.style.removeProperty('filter'); // Remove filter property from all elements
            element.style.removeProperty('mask-image'); // Remove mask-image property
            element.style.removeProperty('-webkit-mask-image'); // Remove webkit mask-image property
            element.style.removeProperty('mask'); // Remove mask property
            element.style.removeProperty('-webkit-mask'); // Remove webkit mask property
            
            // Special handling for banner-top template
            if (element.classList.contains('signature-banner-top')) {
                DEBUG.info('Special handling for banner-top template');
            }
        }
        
        // Process all elements to clean up attributes and styles
        const allElements = element.querySelectorAll('*');
        allElements.forEach(el => {
            
            // Remove inset and opacity properties from all elements
            el.style.removeProperty('inset');
            el.style.removeProperty('opacity');
            el.style.removeProperty('filter'); // Remove filter property from all elements
            el.style.removeProperty('mask-image'); // Remove mask-image property
            el.style.removeProperty('-webkit-mask-image'); // Remove webkit mask-image property
            el.style.removeProperty('mask'); // Remove mask property
            el.style.removeProperty('-webkit-mask'); // Remove webkit mask property
        
            // Ensure IMG elements have proper width and height
            if (el.tagName === 'IMG') {
                
                if (!el.hasAttribute('height') || el.getAttribute('height') === '0') {
                    // Get computed height
                    const computedStyle = window.getComputedStyle(el);
                    const computedHeight = parseInt(computedStyle.height);
                    
                    if (computedHeight && computedHeight > 0) {
                        el.setAttribute('height', computedHeight);
                    } else {
                        el.setAttribute('height', 'auto');
                    }
                }
            
            }
        });
        
        // Remove duplicate style elements with the same content
        const styleElements = element.querySelectorAll('style');
        const styleContents = new Set();
        
        styleElements.forEach(styleEl => {
            const content = styleEl.textContent.trim();
            
            if (styleContents.has(content)) {
                // This is a duplicate style, remove it
                DEBUG.info('Removing duplicate style element');
                styleEl.parentNode.removeChild(styleEl);
            } else {
                // Add this style content to our set
                styleContents.add(content);
            }
        });
        
        DEBUG.info('HTML cleanup for email compatibility complete.');
        return element;
    },
    
    /**
     * Clean up excessive inline styles that aren't needed for email
     * @param {HTMLElement} element - The element to process
     */
    cleanupInlineStyles: function(element) {
        DEBUG.info('Cleaning up excessive inline styles...');
        
        // Process all elements
        const allElements = element.querySelectorAll('*');
        
        allElements.forEach(el => {
            const style = el.getAttribute('style');
            
            if (style) {
                // Remove unnecessary styles
                let newStyle = style
                    .replace(/transition:[^;]+;/g, '')
                    .replace(/animation:[^;]+;/g, '')
                    .replace(/transform:[^;]+;/g, '')
                    .replace(/box-shadow:[^;]+;/g, '')
                    .replace(/text-shadow:[^;]+;/g, '')
                    .replace(/backdrop-filter:[^;]+;/g, '')
                    .replace(/-webkit-backdrop-filter:[^;]+;/g, '')
                    .replace(/filter:[^;]+;/g, '')
                    .replace(/-webkit-filter:[^;]+;/g, '')
                    .replace(/mask:[^;]+;/g, '')
                    .replace(/-webkit-mask:[^;]+;/g, '')
                    .replace(/mask-image:[^;]+;/g, '')
                    .replace(/-webkit-mask-image:[^;]+;/g, '');
                
                // Update the style attribute if changed
                if (newStyle !== style) {
                    if (newStyle.trim() === '') {
                        el.removeAttribute('style');
                    } else {
                        el.setAttribute('style', newStyle);
                    }
                }
            }
        });
    },
    
    /** Strips every class attribute in the subtree, in place (export HTML carries inline styles only). */
    stripClassNamesFromElements: function(element) {
        DEBUG.info('Stripping class names from elements...');
        
        // Remove class from the element itself
        if (element.classList && element.classList.length) {
            element.removeAttribute('class');
        }
        
        // Process all children recursively
        const children = element.querySelectorAll('*');
        for (let i = 0; i < children.length; i++) {
            if (children[i].classList && children[i].classList.length) {
                children[i].removeAttribute('class');
            }
        }
    },
    
    /**
     * Prepares a signature element for export (preview or download)
     * @param {HTMLElement} signatureElement - The signature element to process
     * @param {Object} options - Processing options
     * @param {boolean} [options.stripClasses=false] - Whether to strip all class names
     * @param {boolean} [options.convertImagesToBase64=false] - Whether to convert images to base64
     * @returns {Promise<HTMLElement>} - The processed HTML element
     */
    prepareSignatureForExport: async function(signatureElement, options = {}) {
        const { 
            stripClasses = false,
            convertImagesToBase64 = false
        } = options;
        
        // Create wrapper div for processing
        const wrapper = document.createElement('div');
        wrapper.appendChild(signatureElement.cloneNode(true));
        
        // Process styles using our local inlineStyles function
        await this.inlineStyles(wrapper);
        
        // Convert images to base64 if requested
        if (convertImagesToBase64) {
            const imageProcessing = window.EmailSignatureApp?.ImageProcessing;
            if (imageProcessing && typeof imageProcessing.convertImageToBase64 === 'function') {
                const images = wrapper.querySelectorAll('img');
                const imagePromises = Array.from(images).map(img => {
                    return imageProcessing.convertImageToBase64(img);
                });
                await Promise.all(imagePromises);
            } else {
                DEBUG.warn('ImageProcessing.convertImageToBase64 not found, skipping image conversion');
            }
        }
        
        // Clean up HTML for email
        this.cleanupHtmlForEmail(wrapper);
        
        // Strip all class names if requested
        if (stripClasses) {
            this.stripClassNamesFromElements(wrapper);
        }
        
        // Clean up excessive inline styles
        this.cleanupInlineStyles(wrapper);
        
        return wrapper;
    },
    
    /**
     * Inlines all CSS styles for email compatibility
     * @param {HTMLElement} element - The element to process
     */
    inlineStyles: async function(element) {
        DEBUG.info('Starting inlineStyles process...');
        
        // Create a clone of the element to avoid modifying the original during processing
        const clone = element.cloneNode(true);
        document.body.appendChild(clone);
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        
        try {
            // Get all stylesheets from the document
            const styleSheets = Array.from(document.styleSheets);
            let combinedCssText = '';
            
            // Extract CSS rules from all stylesheets
            for (const sheet of styleSheets) {
                try {
                    // Skip external stylesheets from different origins due to CORS
                    if (sheet.href && new URL(sheet.href).origin !== window.location.origin) {
                        DEBUG.warn(`Skipping external stylesheet: ${sheet.href} due to CORS restrictions`);
                        continue;
                    }
                    
                    const rules = Array.from(sheet.cssRules || sheet.rules || []);
                    for (const rule of rules) {
                        // Handle regular style rules
                        if (rule.type === 1) { // CSSRule.STYLE_RULE
                            combinedCssText += `${rule.selectorText} { ${rule.style.cssText} } `;
                        }
                        // Handle media queries
                        else if (rule.type === 4) { // CSSRule.MEDIA_RULE
                            // For email clients, we'll extract the rules inside media queries
                            // but ignore the media query itself since most email clients don't support them
                            const mediaRules = Array.from(rule.cssRules || []);
                            for (const mediaRule of mediaRules) {
                                if (mediaRule.type === 1) { // CSSRule.STYLE_RULE
                                    combinedCssText += `${mediaRule.selectorText} { ${mediaRule.style.cssText} } `;
                                }
                            }
                        }
                    }
                } catch (e) {
                    DEBUG.warn(`Error accessing rules in stylesheet: ${e.message}`);
                }
            }
            
            // Process all elements in the clone to extract computed styles
            this.processElementStyles(clone, combinedCssText);
            
            // Replace the original element's HTML with the processed clone's HTML
            element.innerHTML = clone.innerHTML;
            
            // Copy the cleaned inline styles from the clone to the original element
            if (clone.hasAttribute('style')) {
                let cloneStyle = clone.getAttribute('style') || '';
                
                // Remove any existing style attribute to avoid duplicates
                let currentStyle = element.getAttribute('style') || '';
                
                // Remove any conflicting width styles
                currentStyle = currentStyle.replace(/width\s*:\s*auto.*?;/g, '');
                
            }
            // Add email-specific attributes to the container
            element.setAttribute('cellspacing', '0');
            element.setAttribute('cellpadding', '0');
            element.setAttribute('border', '0');
            
            DEBUG.info('Completed inlineStyles process successfully');
        } catch (err) {
            DEBUG.error('Error in inlineStyles:', err);
        } finally {
            // Clean up the clone
            if (clone && clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
        }
    },
    
    /** Inline the rules in `cssText` onto matching elements in `container`, in place. */
    processElementStyles: function(container, cssText) {
        // Apply CSS rules to the container and all child elements
        this.applyCssRules(container, cssText);
        
        // Clean up all elements for email compatibility
        if (typeof this.cleanupHtmlForEmail === 'function') {
            this.cleanupHtmlForEmail(container);
        } else {
            DEBUG.warn('cleanupHtmlForEmail function not found, skipping HTML cleanup');
        }
    },
    
    /**
     * Applies CSS rules from text to elements
     * @param {HTMLElement} container - The container element with all signature elements
     * @param {string} cssText - The CSS text to parse and apply
     */
    applyCssRules: function(container, cssText) {
        // Helper function to convert CSS text to rules
        const parseCssText = (cssText) => {
            const rules = {};
            // Simple CSS parser - split by selectors
            const sections = cssText.split('}');
            
            sections.forEach(section => {
                const parts = section.split('{');
                if (parts.length === 2) {
                    const selectors = parts[0].trim();
                    const stylesText = parts[1].trim();
                    
                    // Handle each selector independently
                    selectors.split(',').forEach(selector => {
                        selector = selector.trim();
                        if (!selector) return;
                        
                        // Clean up the selector
                        selector = selector.replace(/\s+/g, ' ');
                        
                        // Process CSS variables directly
                        let processedStyles = stylesText;
                        
                        // Replace common CSS variables with their values
                        const cssVarReplacements = {
                            'var(--primary-color)': '#333333',
                            'var(--secondary-color)': '#666666',
                            'var(--accent-color)': '#0077B5',
                            'var(--background-color)': '#ffffff',
                            'var(--text-color)': '#333333',
                            'var(--light-color)': '#ffffff',
                            'var(--dark-color)': '#000000'
                        };
                        
                        // Replace CSS variables with their values
                        Object.keys(cssVarReplacements).forEach(varName => {
                            processedStyles = processedStyles.replace(
                                new RegExp(varName.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1"), 'g'), 
                                cssVarReplacements[varName]
                            );
                        });
                        
                        if (!rules[selector]) {
                            rules[selector] = [];
                        }
                        rules[selector].push(processedStyles);
                    });
                }
            });
            
            return rules;
        };
        
        // Parse the CSS rules
        const rules = parseCssText(cssText);
        
        // Apply each rule to matching elements
        Object.keys(rules).forEach(selector => {
            try {
                // Skip CSS variables, media queries, etc.
                if (selector.includes('@') || selector.includes(':root')) return;
                
                // Filter selector to only include class-based and tag-based selectors
                if (selector.includes('#') || 
                    selector.includes('[') || 
                    selector.includes('::') || 
                    selector.includes(':not')) {
                    return;
                }
                
                // Convert the selector for querySelector
                const processedSelector = this.processSelector(selector, container);
                
                // Find all elements matching the selector
                let elements;
                try {
                    if (processedSelector === '') return;
                    
                    if (processedSelector === 'container') {
                        elements = [container];
                    } else {
                        elements = container.querySelectorAll(processedSelector);
                    }
                    
                    if (!elements || elements.length === 0) return;
                    
                    // Apply styles to each matching element
                    Array.from(elements).forEach(el => {
                        rules[selector].forEach(styles => {
                            // Skip border-radius styles for profile and logo images
                            if ((el.classList.contains('profile-img') || el.classList.contains('company-logo')) && 
                                styles.includes('border-radius')) {
                                // Skip applying border-radius style to these elements
                                // Instead, apply all other styles that may exist in this rule
                                const styleProps = styles.split(';');
                                const filteredStyles = styleProps
                                    .filter(prop => !prop.includes('border-radius'))
                                    .join(';');
                                
                                if (filteredStyles.trim()) {
                                    const existingStyle = el.getAttribute('style') || '';
                                    el.setAttribute('style', existingStyle + filteredStyles);
                                }
                            } else {
                                // Apply styles normally for other elements
                                const existingStyle = el.getAttribute('style') || '';
                                el.setAttribute('style', existingStyle + styles);
                            }
                        });
                    });
                } catch (selectorError) {
                    DEBUG.warn(`Selector error for ${processedSelector}:`, selectorError);
                }
            } catch (ruleError) {
                DEBUG.warn(`Error applying rule for ${selector}:`, ruleError);
            }
        });
    },
    
    /** @returns {string} `selector` rewritten so querySelector can run it against `container`. */
    processSelector: function(selector, container) {
        // Handle special cases
        if (selector === '.signature') {
            return 'container';
        }
        
        // Handle .signature-classic selector
        if (selector === '.signature-classic') {
            return '.signature-classic';
        }
        
        // Skip pseudo-selectors
        if (selector.includes(':hover') || 
            selector.includes(':active') || 
            selector.includes(':focus')) {
            return '';
        }
        
        return selector;
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
    
    window.EmailSignatureApp.ExportFileHtml = exportFileHtml;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportFileHtml;
}