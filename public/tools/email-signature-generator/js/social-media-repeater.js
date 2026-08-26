/**
 * Social Media Repeater
 * Handles adding, removing, and reordering social media icons
 */

class SocialMediaRepeater {
    constructor() {
        // Define properties
        this.container = null;
        this.template = null;
        this.addButton = null;
        this.iconCount = 0;
        this.icons = [];
        
        // Icon path
        this.iconPath = 'assets/icons/';

        // Update icon path for WordPress environment
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            this.iconPath = EmailSignatureGeneratorConfig.toolBaseUrl + 'assets/icons/';
        }
        
        // Use the centralized social platforms configuration if available
        if (typeof CONFIG !== 'undefined' && CONFIG.socialPlatforms) {
            this.socialPlatforms = CONFIG.socialPlatforms;
        } else {
            // Fallback for backward compatibility
            console.warn('CONFIG.socialPlatforms not available, using fallback social platform data');
            this.socialPlatforms = {
                linkedin: { iconFile: 'linkedin.png', placeholder: "https://linkedin.com/in/yourusername" },
                x: { iconFile: 'x.png', placeholder: "https://x.com/yourusername" },
                github: { iconFile: 'github.png', placeholder: "https://github.com/yourusername" },
                email: { iconFile: 'email.png', placeholder: "your.email@example.com", displayName: "Mail Icon #1" },
                mail: { iconFile: 'mail.png', placeholder: "your.email@example.com", displayName: "Mail Icon #2" },
                calendly: { iconFile: 'calendly.png', placeholder: "https://calendly.com/yourusername/15min" },
                facebook: { iconFile: 'facebook.png', placeholder: "https://facebook.com/yourusername" },
                instagram: { iconFile: 'instagram.png', placeholder: "https://instagram.com/yourusername" },
                dribbble: { iconFile: 'dribbble.png', placeholder: "https://dribbble.com/yourusername" },
                tiktok: { iconFile: 'tiktok.png', placeholder: "https://tiktok.com/@yourusername" },
                youtube: { iconFile: 'youtube.png', placeholder: "https://youtube.com/@yourusername" },
                pinterest: { iconFile: 'pinterest.png', placeholder: "https://pinterest.com/yourusername" },
                wordpress: { iconFile: 'wordpress.png', placeholder: "https://wordpress.com/yourusername" },
                reddit: { iconFile: 'reddit.png', placeholder: "https://reddit.com/u/yourusername" },
                bluesky: { iconFile: 'bluesky.png', placeholder: "https://bsky.app/profile/yourusername" },
                devto: { iconFile: 'devto.png', placeholder: "https://dev.to/yourusername" },
                dailydev: { iconFile: 'dailydev.png', placeholder: "https://daily.dev/yourusername" },
                flickr: { iconFile: 'flickr.png', placeholder: "https://flickr.com/yourusername" },
                whatsapp: { iconFile: 'whatsapp.png', placeholder: "https://wa.me/yourphonenumber" },
                etsy: { iconFile: 'etsy.png', placeholder: "https://etsy.com/shop/yourusername" },
                paypal: { iconFile: 'paypal.png', placeholder: "https://paypal.me/yourusername" },
                buymeacoffee: { iconFile: 'buymeacoffee.png', placeholder: "https://buymeacoffee.com/yourusername" },
                patreon: { iconFile: 'patreon.png', placeholder: "https://patreon.com/yourusername" },
                spotify: { iconFile: 'spotify.png', placeholder: "https://open.spotify.com/user/yourusername" },
                behance: { iconFile: 'behance.png', placeholder: "https://behance.net/yourusername" },
            };
        }
        
        // Keep track of used platforms
        this.usedPlatforms = new Set();
        
        // Debouncing timeout for saveIcons
        this._saveIconsTimeout = null;
    }
    
    /**
     * Initialize the social media repeater
     * @returns {boolean} - True if initialization successful, false otherwise
     */
    init() {
        try {
            // Get elements
            this.container = document.getElementById('social-media-repeater');
            if (!this.container) {
                console.error('Social media repeater container not found');
                return false;
            }
            
            // Get template element
            this.template = document.getElementById('social-media-item-template');
            if (!this.template) {
                console.error('Social media item template not found');
                return false;
            }
            
            // Get add button
            this.addButton = document.getElementById('add-social-media');
            if (!this.addButton) {
                console.error('Add social media button not found');
                return false;
            }
            
            // Reset used platforms set
            this.usedPlatforms = new Set();
            
            // Add event listener to the add button
            this.addButton.addEventListener('click', () => this.addSocialIcon());
            
            // Load saved social icons
            this.loadSavedIcons();
            
            // Enable drag and drop functionality
            this.enableDragAndDrop();
            
            // If no icons are loaded, add default ones
            if (this.icons.length === 0) {
                this.addDefaultIcons();
            }
            
            return true;
        } catch (error) {
            console.error('Error initializing social media repeater');
            return false;
        }
    }
    
    addDefaultIcons() {
        // Add default icons
        const defaultIcons = [
            { platform: 'github', url: 'https://github.com/gbti-network' },
            { platform: 'x', url: 'https://x.com/gbti_network' },
            { platform: 'youtube', url: 'https://www.youtube.com/channel/UCh4FjB6r4oWQW-QFiwqv-UA' },
            { platform: 'dailydev', url: 'https://dly.to/zfCriM6JfRF' },
            { platform: 'reddit', url: 'https://www.reddit.com/r/GBTI_network' },
            { platform: 'linkedin', url: 'https://www.linkedin.com/in/gbti_network/' },
        ];
        
        defaultIcons.forEach(icon => {
            this.addSocialIcon(icon.platform, icon.url);
        });
    }
    
    /**
     * Create icon elements for a specific social media platform
     * @param {string} platform - Social media platform
     * @param {string} link - URL for the social media link
     * @returns {HTMLElement} - Created social media item
     */
    createSocialIcon(platform, link) {
        try {
            // Clone the template
            if (!this.template) {
                console.error('Template element not found');
                return null;
            }
            
            const itemElement = this.template.content.cloneNode(true).firstElementChild;
            itemElement.classList.add('social-media-item');
            itemElement.setAttribute('data-platform', platform);
            
            // Get references to elements
            const platformSelect = itemElement.querySelector('.social-media-platform');
            const linkInput = itemElement.querySelector('.social-media-url');
            const removeButton = itemElement.querySelector('.remove-social-media');
            
            // Set values
            if (platformSelect) {
                // Populate select with available platforms
                this.populatePlatformOptions(platformSelect, platform);
                
                // Set selected value
                platformSelect.value = platform;
                
                // Update the link placeholder based on selected platform
                if (linkInput && this.socialPlatforms[platform]) {
                    linkInput.placeholder = this.socialPlatforms[platform].placeholder;
                }
            }
            
            if (linkInput) {
                linkInput.value = link || '';
            }
            
            // Set up event listeners
            if (platformSelect) {
                platformSelect.addEventListener('change', (e) => {
                    const oldPlatform = itemElement.getAttribute('data-platform');
                    const newPlatform = e.target.value;
                    
                    // Update data attribute
                    itemElement.setAttribute('data-platform', newPlatform);
                    
                    // Update usedPlatforms set
                    this.usedPlatforms.delete(oldPlatform);
                    this.usedPlatforms.add(newPlatform);
                    
                    // Update all dropdown options for all items
                    this.updateAllPlatformDropdowns();
                    
                    // Update link placeholder
                    if (linkInput && this.socialPlatforms[newPlatform]) {
                        linkInput.placeholder = this.socialPlatforms[newPlatform].placeholder;
                    }
                    
                    this.saveIcons();
                });
            }
            
            if (linkInput) {
                linkInput.addEventListener('input', () => {
                    this.saveIcons();
                });
            }
            
            if (removeButton) {
                removeButton.addEventListener('click', () => {
                    this.removeSocialIcon(itemElement);
                });
            }
            
            // Set up drag-and-drop
            itemElement.setAttribute('draggable', 'true');
            itemElement.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', itemElement.getAttribute('data-platform'));
                itemElement.classList.add('dragging');
            });
            
            itemElement.addEventListener('dragend', () => {
                itemElement.classList.remove('dragging');
            });
            
            // Show the item
            itemElement.style.display = 'flex';
            
            return itemElement;
        } catch (error) {
            console.error('Error creating social icon');
            return null;
        }
    }

    /** @returns {HTMLElement|null} the created row, or null when the row could not be built. */
    addSocialIcon(platform = '', link = '') {
        try {
            const itemElement = this.createSocialIcon(platform, link);
            if (!itemElement) {
                return null;
            }
            
            this.container.appendChild(itemElement);
            this.icons.push({ platform, link });
            this.saveIcons();
            this.iconCount++;
            
            // Add platform to used platforms set
            this.usedPlatforms.add(platform);
            
            // Scroll to the newly added element with smooth animation
            setTimeout(() => {
                itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
            
            return itemElement;
        } catch (error) {
            console.error('Error adding social icon:', error);
            return null;
        }
    }

    removeSocialIcon(itemElement) {
        try {
            // Get platform before removing from DOM
            const platform = itemElement.getAttribute('data-platform');

            // First remove from DOM
            itemElement.remove();
            this.iconCount--;
            
            // Then update the icons array from the current DOM state
            this.icons = Array.from(this.container.children)
                .filter(item => !item.classList.contains('template'))
                .map(item => {
                    const platform = item.querySelector('.social-media-platform').value;
                    const link = item.querySelector('.social-media-url').value;
                    return { platform, link };
                });
            
            // First, save to localStorage - this is crucial to ensure data consistency
            localStorage.setItem('socialIcons', JSON.stringify(this.icons));
            
            // Remove platform from used platforms set
            this.usedPlatforms.delete(platform);
            
            // Update all platform dropdowns to reflect changes
            this.updateAllPlatformDropdowns();
            
            // IMPORTANT: Use staggered timings to ensure proper DOM updates
            // 1. First, directly update template icons with a small delay
            setTimeout(() => {
                this.directUpdateTemplateIcons();
                DEBUG.info('Direct template icon update complete');
            }, 10);
            
            // 2. Then, trigger the application-wide update mechanisms
            setTimeout(() => {
                // Try multiple ways to update the signatures
                if (typeof window.updateSignatures === 'function') {
                    window.updateSignatures();
                    DEBUG.info('Window updateSignatures called');
                }
                
                // Also directly update social icons
                if (typeof window.EmailSignatureApp?.SocialIcons?.updateSocialIcons === 'function') {
                    window.EmailSignatureApp.SocialIcons.updateSocialIcons();
                    DEBUG.info('EmailSignatureApp.SocialIcons.updateSocialIcons called');
                } else if (typeof window.updateSocialIcons === 'function') {
                    window.updateSocialIcons();
                    DEBUG.info('Window updateSocialIcons called');
                }
                
                // Dispatch event as a fallback
                const event = new CustomEvent('socialIconsUpdated', { 
                    detail: { icons: this.icons } 
                });
                document.dispatchEvent(event);
                DEBUG.info('socialIconsUpdated event dispatched');
            }, 50);
        } catch (error) {
            console.error('Error removing social icon:', error);
        }
    }
    
    /**
     * Directly update all social icon containers in templates
     */
    directUpdateTemplateIcons() {
        try {
            // Find all social icons containers in all templates
            const containers = document.querySelectorAll('.sig-social-icons');
            
            if (containers.length === 0) {
                console.warn('No social icon containers found');
                return;
            }
            
            // Get icons with consistent property names
            const icons = this.getIcons();
            
            if (!icons || !Array.isArray(icons) || icons.length === 0) {
                console.warn('No icons found to update');
                // Don't return here - still need to update empty containers
            }
            
            DEBUG.info(`Updating ${icons?.length || 0} icons in ${containers.length} containers`);
            
            // Update each container
            containers.forEach(container => {
                // Store the existing container's parent and next sibling for later reference
                const parent = container.parentNode;
                const nextSibling = container.nextSibling;
                
                // Create a new container to replace the old one
                const newContainer = container.cloneNode(false);
                
                // Add icons to the new container
                if (icons && Array.isArray(icons) && icons.length > 0) {
                    icons.forEach(icon => {
                        if (icon && icon.platform && icon.url) {
                            // Create link element
                            const link = document.createElement('a');
                            
                            // Set href based on platform
                            if (icon.platform === 'email') {
                                link.href = `mailto:${icon.url}`;
                            } else {
                                // Ensure URL has protocol
                                if (!icon.url.startsWith('http://') && !icon.url.startsWith('https://')) {
                                    link.href = `https://${icon.url}`;
                                } else {
                                    link.href = icon.url;
                                }
                            }
                            
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            
                            // Important: Add platform as class to link for proper icon handling
                            link.classList.add(`social-icon-link-${icon.platform}`);
                            
                            // Special handling for Calendly links
                            if (icon.platform === 'calendly') {
                                link.classList.add('calendly');
                            }
                            
                            // Create icon image
                            const img = document.createElement('img');
                            
                            // Get the icon file from the socialPlatforms configuration
                            const iconFile = this.socialPlatforms[icon.platform]?.iconFile || `${icon.platform}.png`;
                            img.src = `${this.iconPath}${iconFile}`;
                            img.alt = `${icon.platform} icon`;
                            img.className = `social-icon ${icon.platform}-icon`;
                            
                            // Handle image load errors
                            img.onerror = function() {
                                DEBUG.info(`Trying fallback for ${icon.platform} icon`);
                                this.src = `assets/icons/${iconFile}`;
                                
                                this.onerror = function() {
                                    DEBUG.info(`Using generic fallback for ${icon.platform} icon`);
                                    this.src = 'assets/icons/email.png';
                                };
                            };
                            
                            // Add image to link and link to container
                            link.appendChild(img);
                            newContainer.appendChild(link);
                        }
                    });
                }
                
                // Replace old container with new container
                if (parent) {
                    parent.replaceChild(newContainer, container);
                }
            });
            
            DEBUG.info('Direct template icon update complete');
        } catch (error) {
            console.error('Error updating template icons:', error);
        }
    }
    
    /**
     * Save icons to local storage
     */
    saveIcons() {
        try {
            // Get current icons from the DOM
            const icons = Array.from(this.container.children)
                .filter(item => !item.classList.contains('template'))
                .map(item => {
                    const platform = item.querySelector('.social-media-platform').value;
                    const link = item.querySelector('.social-media-url').value;
                    return { platform, link };
                });
            
            // Save to localStorage immediately for data persistence
            localStorage.setItem('socialIcons', JSON.stringify(icons));
            this.icons = icons;
            
            // Use a debounce approach to avoid multiple rapid updates
            clearTimeout(this._saveIconsTimeout);
            this._saveIconsTimeout = setTimeout(() => {
                DEBUG.info('Executing delayed icon update after save');
                
                // Directly update template icons first
                this.directUpdateTemplateIcons();
                
                // Then trigger application-wide updates with slight delays between
                setTimeout(() => {
                    // Try to update signatures through window.updateSignatures
                    if (typeof window.updateSignatures === 'function') {
                        window.updateSignatures();
                        DEBUG.info('window.updateSignatures called after save');
                    } else if (typeof updateSignatures === 'function') {
                        updateSignatures();
                        DEBUG.info('updateSignatures called after save');
                    }
                    
                    // Dispatch event as a secondary update mechanism
                    setTimeout(() => {
                        const event = new CustomEvent('socialIconsUpdated', { 
                            detail: { icons: this.icons } 
                        });
                        document.dispatchEvent(event);
                        DEBUG.info('socialIconsUpdated event dispatched after save');
                    }, 20);
                }, 20);
            }, 100); // Wait 100ms before updating to avoid rapid successive updates
        } catch (error) {
            console.error('Error saving icons:', error);
        }
    }
    
    /** @returns {Array<{platform: string, url: string}>} */
    getIcons() {
        try {
            // If we have icons already loaded, return them
            if (this.icons && this.icons.length > 0) {
                // Map to consistent property names (platform, url)
                return this.icons.map(icon => ({
                    platform: icon.platform,
                    url: icon.link
                }));
            }
            
            // Otherwise, try to get them from the DOM
            const icons = [];
            if (this.container) {
                const items = this.container.querySelectorAll('.social-media-item');
                items.forEach(item => {
                    const platformSelect = item.querySelector('.social-media-platform');
                    const linkInput = item.querySelector('.social-media-url');
                    
                    if (platformSelect && linkInput && platformSelect.value) {
                        icons.push({
                            platform: platformSelect.value,
                            url: linkInput.value
                        });
                    }
                });
            }
            
            return icons;
        } catch (error) {
            console.error('Error getting icons');
            return [];
        }
    }
    
    enableDragAndDrop() {
        if (!this.container) return;
        
        try {
            // Use a drag handle to initiate drag
            this.container.addEventListener('mousedown', (e) => {
                const dragHandle = e.target.closest('.drag-handle');
                if (!dragHandle) return;
                
                const item = dragHandle.closest('.social-media-item');
                if (!item) return;
                
                item.setAttribute('draggable', 'true');
                
                // Reset draggable attribute on mouseup
                document.addEventListener('mouseup', function resetDraggable() {
                    item.setAttribute('draggable', 'false');
                    document.removeEventListener('mouseup', resetDraggable);
                });
            });
            
            // Add drag events
            this.container.addEventListener('dragstart', (e) => {
                const item = e.target.closest('.social-media-item');
                if (!item) return;
                
                e.dataTransfer.setData('text/plain', Array.from(this.container.children).indexOf(item));
                item.classList.add('dragging');
            });
            
            this.container.addEventListener('dragend', (e) => {
                const item = e.target.closest('.social-media-item');
                if (!item) return;
                
                item.classList.remove('dragging');
                
                // Save icons and ensure UI updates
                this.saveIcons();
                
                // Force an additional update to ensure social icons are properly updated
                setTimeout(() => {
                    // Trigger a custom event to ensure all listeners are notified
                    const event = new CustomEvent('socialIconsUpdated', { 
                        detail: { icons: this.getIcons() } 
                    });
                    document.dispatchEvent(event);
                    
                    DEBUG.info('Social icons reordering complete');
                }, 100);
            });
            
            this.container.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = this.container.querySelector('.dragging');
                if (!dragging) return;
                
                const currentPos = e.clientY;
                const siblings = Array.from(this.container.querySelectorAll('.social-media-item:not(.dragging)'));
                
                const nextSibling = siblings.find(sibling => {
                    const box = sibling.getBoundingClientRect();
                    return currentPos <= box.top + box.height / 2;
                });
                
                if (nextSibling) {
                    this.container.insertBefore(dragging, nextSibling);
                } else {
                    this.container.appendChild(dragging);
                }
            });
        } catch (e) {
            console.error('Error initializing drag and drop');
        }
    }
    
    loadSavedIcons() {
        try {
            // First try to load from 'social-media-icons' (new format)
            let savedIcons = localStorage.getItem('socialIcons');
            
            // If not found, try the legacy format
            if (!savedIcons) {
                savedIcons = localStorage.getItem('signature-social-icons');
            }
            
            if (savedIcons) {
                const icons = JSON.parse(savedIcons);
                
                if (Array.isArray(icons)) {
                    icons.forEach(icon => {
                        if (icon && icon.platform && icon.link) {
                            this.addSocialIcon(icon.platform, icon.link);
                            
                            // Add to used platforms set
                            this.usedPlatforms.add(icon.platform);
                        }
                    });
                    
                    // Update all dropdowns to reflect used platforms
                    this.updateAllPlatformDropdowns();
                }
            }
        } catch (e) {
            console.error('Error loading saved social icons');
        }
    }
    
    populatePlatformOptions(select, selectedPlatform) {
        try {
            // Clear existing options
            select.innerHTML = '';
            
            // Add options for each platform - sort alphabetically
            Object.keys(this.socialPlatforms).sort().forEach(platform => {
                const option = document.createElement('option');
                option.value = platform;
                option.textContent = platform.charAt(0).toUpperCase() + platform.slice(1);
                
                // If platform is used and not the selected one, disable it
                if (this.usedPlatforms.has(platform) && platform !== selectedPlatform) {
                    option.disabled = true;
                }
                
                // Select the current platform
                if (platform === selectedPlatform) {
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Error populating platform options');
        }
    }
    
    updateAllPlatformDropdowns() {
        try {
            // Get all platform selects
            const selects = this.container.querySelectorAll('.social-media-platform');
            
            // Update each select
            selects.forEach(select => {
                this.populatePlatformOptions(select, select.value);
            });
        } catch (error) {
            console.error('Error updating all platform dropdowns');
        }
    }
}

// Initialize the repeater
let socialMediaRepeater = null;

// Make getSocialIcons available globally for backward compatibility
window.getSocialIcons = function() {
    if (window.socialMediaRepeater) {
        return window.socialMediaRepeater.getIcons();
    }
    return [];
};

// Function to initialize the repeater - will be called from controls.js
function initSocialMediaRepeater() {
    DEBUG.info('Creating social media repeater');
    
    if (!window.socialMediaRepeater) {
        window.socialMediaRepeater = new SocialMediaRepeater();
        window.socialMediaRepeater.init();
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Wait a short time to ensure other scripts are loaded
    setTimeout(() => {
        initSocialMediaRepeater();
    }, 300);
});
