/**
 * Reset Handler Module
 * Handles resetting all form inputs, images, and colors to their default values
 */
(function() {
    'use strict';

    // Create namespace if it doesn't exist
    window.EmailSignatureApp = window.EmailSignatureApp || {};

    const ResetHandler = {
        /**
         * Initialize reset button functionality
         */
        initialize: function() {
            DEBUG.info('Initializing reset button...');
            const resetButton = document.querySelector('.refresh-container');
            DEBUG.info('Reset button element:', resetButton);
            
            if (resetButton) {
                // Remove any existing click listeners to prevent duplicates
                resetButton.removeEventListener('click', this.handleResetClick);
                
                // Add click listener for reset functionality
                resetButton.addEventListener('click', this.handleResetClick.bind(this));
                DEBUG.info('Reset button event listener attached');
            } else {
                console.error('Reset button not found');
            }
        },

        handleResetClick: function() {
            DEBUG.info('Reset button clicked');
            
            if (confirm('Are you sure you want to reset all values to defaults?')) {
                DEBUG.info('Reset confirmed');
                
                // Clear all localStorage items related to the signature
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('signature-')) {
                        DEBUG.info(`Removing localStorage item: ${key}`);
                        localStorage.removeItem(key);
                    }
                });
                
                // Reset all values to defaults
                this.resetAllValues();
            }
        },

        resetAllValues: function() {
            // Debug info
            DEBUG.info('Resetting all values to defaults');
            
            // Get default values from the new CONFIG structure if available
            const defaults = {
                name: CONFIG.defaults?.name || 'Email Signature Generator',
                title: CONFIG.defaults?.title || 'Success Manager',
                company: CONFIG.defaults?.company || 'GBTI Network',
                email: CONFIG.defaults?.email || 'opportunities@gbti.network',
                calendly: CONFIG.defaults?.calendly || 'https://calendly.com/gbti_network/15min',
            };
            
            // Get social media defaults from the new consolidated structure if available
            if (CONFIG.socialPlatforms) {
                defaults.linkedin = CONFIG.socialPlatforms.linkedin?.defaultValue || 'https://www.linkedin.com/in/gbti_network/';
                defaults.x = CONFIG.socialPlatforms.x?.defaultValue || 'https://x.com/gbti_network';
                defaults.github = CONFIG.socialPlatforms.github?.defaultValue || 'https://github.com/gbti_network';
            } else {
                // Fallback to old structure if new one is not available
                defaults.linkedin = CONFIG.defaults?.linkedin || 'https://www.linkedin.com/in/gbti_network/';
                defaults.x = CONFIG.defaults?.x || 'https://x.com/gbti_network';
                defaults.github = CONFIG.defaults?.github || 'https://github.com/gbti_network';
            }
            
            // Reset personal information
            DEBUG.info('Resetting personal information fields...');
            this.resetInputToDefault('input-name', defaults.name);
            this.resetInputToDefault('input-title', defaults.title);
            this.resetInputToDefault('input-email', defaults.email);
            this.resetInputToDefault('input-calendly', defaults.calendly);
            this.resetInputToDefault('input-company', defaults.company);
            
            // Reset social media
            DEBUG.info('Resetting social media fields...');
            this.resetInputToDefault('input-linkedin', defaults.linkedin);
            this.resetInputToDefault('input-x', defaults.x);
            this.resetInputToDefault('input-github', defaults.github);
            
            // Reset colors - Force Light Mode
            DEBUG.info('Resetting colors to light mode defaults...');
            this.resetColorToDefault('input-primary-color', CONFIG.colors.light.primary);
            this.resetColorToDefault('input-secondary-color', CONFIG.colors.light.secondary);
            this.resetColorToDefault('input-accent-color', CONFIG.colors.light.accent);
            this.resetColorToDefault('input-background-color', CONFIG.colors.light.background);
            
            // Update color previews for all color inputs
            document.querySelectorAll('input[type="color"]').forEach(input => {
                this.updateColorPreview(input);
            });
            
            // Reset dark mode colors in localStorage for future use
            DEBUG.info('Resetting dark mode colors in localStorage...');
            localStorage.setItem('signature-primary-color-dark', CONFIG.colors.dark.primary);
            localStorage.setItem('signature-secondary-color-dark', CONFIG.colors.dark.secondary);
            localStorage.setItem('signature-accent-color-dark', CONFIG.colors.dark.accent);
            localStorage.setItem('signature-background-color-dark', CONFIG.colors.dark.background);
            
            // Reset light mode colors in localStorage
            localStorage.setItem('signature-primary-color-light', CONFIG.colors.light.primary);
            localStorage.setItem('signature-secondary-color-light', CONFIG.colors.light.secondary);
            localStorage.setItem('signature-accent-color-light', CONFIG.colors.light.accent);
            localStorage.setItem('signature-background-color-light', CONFIG.colors.light.background);
            
            // Reset dark mode toggle to default (light mode)
            DEBUG.info('Resetting dark mode toggle...');
            if (window.EmailSignatureApp && window.EmailSignatureApp.DarkMode) {
                window.EmailSignatureApp.DarkMode.resetDarkMode();
            }
            
            // Update social icons for dark mode state
            if (window.EmailSignatureApp && window.EmailSignatureApp.SocialIcons && 
                typeof window.EmailSignatureApp.SocialIcons.updateSocialIconsForDarkMode === 'function') {
                window.EmailSignatureApp.SocialIcons.updateSocialIconsForDarkMode(false);
            }
            
            // Reset images to defaults
            DEBUG.info('Resetting images to defaults...');
            if (typeof EmailSignatureApp.ImageHandlers !== 'undefined') {
                EmailSignatureApp.ImageHandlers.resetImages();
            }
            
            // Reset social media repeater if available
            this.resetSocialMedia();
            
            // Apply colors after reset
            DEBUG.info('Applying default colors...');
            if (typeof window.applyColors === 'function') {
                window.applyColors();
            } else if (window.EmailSignatureApp && window.EmailSignatureApp.ColorManager && 
                       typeof window.EmailSignatureApp.ColorManager.applyColors === 'function') {
                window.EmailSignatureApp.ColorManager.applyColors();
            }
            
            // Also apply default dark mode colors to CSS variables
            document.documentElement.style.setProperty('--dark-primary-color', CONFIG.colors.dark.primary);
            document.documentElement.style.setProperty('--dark-secondary-color', CONFIG.colors.dark.secondary);
            document.documentElement.style.setProperty('--dark-accent-color', CONFIG.colors.dark.accent);
            document.documentElement.style.setProperty('--dark-background-color', CONFIG.colors.dark.background);
            
            // Directly update DOM elements for essential elements
            document.querySelectorAll('.name').forEach(el => {
                el.textContent = defaults.name;
            });
            
            document.querySelectorAll('.title:not(.with-company)').forEach(el => {
                el.textContent = defaults.title;
            });
            
            document.querySelectorAll('.company-name').forEach(el => {
                el.textContent = defaults.company;
            });
            
            document.querySelectorAll('.email, .email-value').forEach(el => {
                el.textContent = defaults.email;
            });
            
            // Update combined elements
            document.querySelectorAll('.title-company, .title.with-company').forEach(el => {
                el.textContent = `${defaults.title} at ${defaults.company}`;
            });
            
            // Update all links
            document.querySelectorAll('a[href^="mailto:"]').forEach(anchor => {
                anchor.href = `mailto:${defaults.email}`;
            });
            
            document.querySelectorAll('a[href*="calendly.com"]').forEach(anchor => {
                anchor.href = defaults.calendly;
            });
            
            document.querySelectorAll('a[href*="linkedin.com"]').forEach(anchor => {
                anchor.href = defaults.linkedin;
            });
            
            document.querySelectorAll('a[href*="x.com"], a[href*="x.com"]').forEach(anchor => {
                anchor.href = defaults.x;
            });
            
            document.querySelectorAll('a[href*="github.com"]').forEach(anchor => {
                anchor.href = defaults.github;
            });
            
            // Update signature colors
            if (typeof window.updateSignatureColors === 'function') {
                window.updateSignatureColors();
            }
            
            // Update all signatures with default values
            DEBUG.info('Updating signatures with default values...');
            if (typeof window.updateSignatures === 'function') {
                window.updateSignatures();
            } else if (window.EmailSignatureApp && window.EmailSignatureApp.SignatureUpdater && 
                      typeof window.EmailSignatureApp.SignatureUpdater.updateSignatures === 'function') {
                window.EmailSignatureApp.SignatureUpdater.updateSignatures();
            }
            
            // Make sure social icons are updated
            setTimeout(() => {
                if (window.EmailSignatureApp && window.EmailSignatureApp.SocialIcons && 
                    typeof window.EmailSignatureApp.SocialIcons.updateSocialIcons === 'function') {
                    window.EmailSignatureApp.SocialIcons.updateSocialIcons();
                }
            }, 300);
            
            DEBUG.info('Reset complete!');
            
            // Report values for debugging
            DEBUG.info('After resetAllValues:');
            DEBUG.info(`- input-name: "${document.getElementById('input-name').value}"`);
            DEBUG.info(`- input-title: "${document.getElementById('input-title').value}"`);
            const signatureName = document.querySelector('.name');
            const signatureTitle = document.querySelector('.title:not(.with-company)');
            DEBUG.info(`- signature name: "${signatureName ? signatureName.textContent : 'not found'}"`);
            DEBUG.info(`- signature title: "${signatureTitle ? signatureTitle.textContent : 'not found'}"`);
        },

        /** Resets the input and writes the default to the MODE-SCOPED key (signature-<type>-color-<light|dark>). */
        resetColorToDefault: function(id, defaultValue) {
            const input = document.getElementById(id);
            if (input) {
                // Set input value
                input.value = defaultValue;
                
                // Also save to localStorage (for current mode)
                const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
                const mode = isDarkMode ? 'dark' : 'light';
                const colorType = id.replace('input-', '').replace('-color', '');
                localStorage.setItem(`signature-${colorType}-color-${mode}`, defaultValue);
                
                DEBUG.info(`Reset ${id} to ${defaultValue} and saved to localStorage`);
            }
        },

        /** Resets the input, saves to localStorage, and fires input+change so listeners re-render. */
        resetInputToDefault: function(inputId, defaultValue) {
            const input = document.getElementById(inputId);
            if (input) {
                DEBUG.info(`Resetting ${inputId} to "${defaultValue}"`);
                
                // Clear the input value first
                input.value = '';
                
                // Set input value to default
                input.value = defaultValue;
                
                // Save to localStorage
                localStorage.setItem(`signature-${inputId}`, defaultValue);
                
                // Trigger both input and change events to ensure all listeners are notified
                const inputEvent = new Event('input', { bubbles: true, cancelable: true });
                input.dispatchEvent(inputEvent);
                
                const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                input.dispatchEvent(changeEvent);
            }
        },

        updateColorPreview: function(input) {
            // Get the preview element
            const preview = input.parentElement.querySelector('.color-preview');
            if (preview) {
                preview.style.backgroundColor = input.value;
            }
        },

        resetSocialMedia: function() {
            DEBUG.info('Resetting social media icons...');
            if (window.socialMediaRepeater) {
                // Clear existing social icons from the repeater
                const container = document.getElementById('social-media-repeater');
                if (container) {
                    const items = container.querySelectorAll('.social-media-item:not(.template)');
                    items.forEach(item => item.remove());
                }
                
                // Add default icons
                window.socialMediaRepeater.addDefaultIcons();
            }
        }
    };

    // Expose module to the app namespace
    EmailSignatureApp.ResetHandler = ResetHandler;

    // Also expose key functions globally for backward compatibility
    window.resetAllValues = function() {
        EmailSignatureApp.ResetHandler.resetAllValues();
    };

    window.resetColorToDefault = function(id, defaultValue) {
        EmailSignatureApp.ResetHandler.resetColorToDefault(id, defaultValue);
    };

    window.resetInputToDefault = function(inputId, defaultValue) {
        EmailSignatureApp.ResetHandler.resetInputToDefault(inputId, defaultValue);
    };

    window.resetSocialMedia = function() {
        EmailSignatureApp.ResetHandler.resetSocialMedia();
    };

    // For CommonJS environments
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ResetHandler;
    }

    // Initialize on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function() {
        // Wait for all other modules to load
        setTimeout(function() {
            EmailSignatureApp.ResetHandler.initialize();
        }, 500);
    });
})();
