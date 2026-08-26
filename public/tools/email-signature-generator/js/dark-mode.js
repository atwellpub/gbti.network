/**
 * Dark Mode Module
 * Handles all dark mode related functionality for the Email Signature Generator
 * 
 * This module is part of the EmailSignatureApp namespace
 */

// Create a new module using the revealing module pattern
(function(app) {
    'use strict';

    // Create a module object
    const _module = {};
    
    // Private variables
    let _isDarkMode = false;
    let _initialized = false;
    
    /**
     * Initialize the dark mode module
     */
    _module.initialize = function() {
        if (_initialized) {
            DEBUG.info('Dark mode module already initialized');
            return;
        }
        
        DEBUG.info('Initializing dark mode module');
        
        // Get dark mode toggle element
        const darkModeToggle = document.getElementById(CONFIG.darkMode.toggleId);
        if (!darkModeToggle) {
            console.error('Dark mode toggle not found with ID:', CONFIG.darkMode.toggleId);
            return;
        }
        
        // Check if dark mode is enabled in localStorage
        _isDarkMode = localStorage.getItem(CONFIG.darkMode.storageKey) === 'true';
        DEBUG.info('Initial dark mode state:', { isDarkMode: _isDarkMode });
        
        // Set initial state
        darkModeToggle.checked = _isDarkMode;
        document.body.classList.toggle(CONFIG.darkMode.bodyClass, _isDarkMode);
        
        // Update toggle label
        _updateDarkModeToggleLabel(_isDarkMode);
        
        // Apply dark mode to social icons
        _updateSocialIconsForDarkMode(_isDarkMode);
        
        // Apply the appropriate colors based on mode
        _applyColorsForMode(_isDarkMode);
        
        // Add event listener for dark mode toggle
        darkModeToggle.addEventListener('change', function() {
            const isDarkMode = this.checked;
            _module.setDarkMode(isDarkMode);
        });
        
        _initialized = true;
    };
    
    /**
     * Set dark mode state
     * @param {boolean} isDarkMode - Whether dark mode is enabled
     */
    _module.setDarkMode = function(isDarkMode) {
        DEBUG.info('Setting dark mode:', { isDarkMode });
        
        // Update private variable
        _isDarkMode = isDarkMode;
        
        // Save preference to localStorage
        localStorage.setItem(CONFIG.darkMode.storageKey, isDarkMode);
        
        // Toggle dark mode class on body
        document.body.classList.toggle(CONFIG.darkMode.bodyClass, isDarkMode);
        
        // Update toggle label
        _updateDarkModeToggleLabel(isDarkMode);
        
        // Update social icons for dark mode
        _updateSocialIconsForDarkMode(isDarkMode);
        
        // Apply the appropriate colors based on mode
        _applyColorsForMode(isDarkMode);
        
        // Dispatch an event to notify other components
        document.dispatchEvent(new CustomEvent('darkModeChanged', {
            detail: { isDarkMode }
        }));
        
        DEBUG.info(`Dark mode transition complete to ${isDarkMode ? 'dark' : 'light'} mode`);
    };
    
    /**
     * Get current dark mode state
     * @returns {boolean} - Whether dark mode is enabled
     */
    _module.isDarkMode = function() {
        return _isDarkMode;
    };
    
    /**
     * Reset dark mode to default (light mode)
     */
    _module.resetDarkMode = function() {
        const darkModeToggle = document.getElementById(CONFIG.darkMode.toggleId);
        if (darkModeToggle) {
            darkModeToggle.checked = false;
            _module.setDarkMode(false);
        }
    };
    
    function _updateDarkModeToggleLabel(isDarkMode) {
        const label = document.querySelector(`label[for="${CONFIG.darkMode.toggleId}"]`);
        if (label) {
            label.textContent = isDarkMode ? 'Dark Mode: On' : 'Dark Mode: Off';
        }
    }
    
    function _updateSocialIconsForDarkMode(isDarkMode) {
        if (window.EmailSignatureApp && 
            window.EmailSignatureApp.SocialIcons && 
            typeof window.EmailSignatureApp.SocialIcons.updateSocialIconsForDarkMode === 'function') {
            window.EmailSignatureApp.SocialIcons.updateSocialIconsForDarkMode(isDarkMode);
        } else if (typeof window.updateSocialIconsForDarkMode === 'function') {
            window.updateSocialIconsForDarkMode(isDarkMode);
        } else {
            // Fallback implementation if the function isn't available elsewhere
            const socialIcons = document.querySelectorAll('.social-icon');
            socialIcons.forEach(icon => {
                if (isDarkMode) {
                    icon.classList.add('dark-mode');
                } else {
                    icon.classList.remove('dark-mode');
                }
            });
            
            // Ensure animated social icons are properly styled in dark mode
            if (isDarkMode) {
                document.querySelectorAll('.animated-social .social-icon').forEach(icon => {
                    icon.style.opacity = '0.8';
                });
            } else {
                document.querySelectorAll('.animated-social .social-icon').forEach(icon => {
                    icon.style.opacity = '';
                });
            }
        }
    }
    
    function _applyColorsForMode(isDarkMode) {
        const colorMode = isDarkMode ? 'dark' : 'light';
        const colorSettings = CONFIG.colors[colorMode];
        
        DEBUG.info(`Applying ${colorMode} mode colors:`, colorSettings);
        
        try {
            // Update color inputs with values from CONFIG or localStorage
            const primaryInput = document.getElementById(CONFIG.colors.primary.id);
            const secondaryInput = document.getElementById(CONFIG.colors.secondary.id);
            const accentInput = document.getElementById(CONFIG.colors.accent.id);
            const backgroundInput = document.getElementById(CONFIG.colors.background.id);
            
            if (primaryInput) {
                const storageKey = isDarkMode ? CONFIG.colors.primary.darkStorageKey : CONFIG.colors.primary.lightStorageKey;
                const savedColor = localStorage.getItem(storageKey);
                primaryInput.value = savedColor || colorSettings.primary;
                if (!savedColor) {
                    localStorage.setItem(storageKey, colorSettings.primary);
                }
            } else {
                console.warn('Primary color input not found:', CONFIG.colors.primary.id);
            }
            
            if (secondaryInput) {
                const storageKey = isDarkMode ? CONFIG.colors.secondary.darkStorageKey : CONFIG.colors.secondary.lightStorageKey;
                const savedColor = localStorage.getItem(storageKey);
                secondaryInput.value = savedColor || colorSettings.secondary;
                if (!savedColor) {
                    localStorage.setItem(storageKey, colorSettings.secondary);
                }
            } else {
                console.warn('Secondary color input not found:', CONFIG.colors.secondary.id);
            }
            
            if (accentInput) {
                const storageKey = isDarkMode ? CONFIG.colors.accent.darkStorageKey : CONFIG.colors.accent.lightStorageKey;
                const savedColor = localStorage.getItem(storageKey);
                accentInput.value = savedColor || colorSettings.accent;
                if (!savedColor) {
                    localStorage.setItem(storageKey, colorSettings.accent);
                }
            } else {
                console.warn('Accent color input not found:', CONFIG.colors.accent.id);
            }
            
            if (backgroundInput) {
                const storageKey = isDarkMode ? CONFIG.colors.background.darkStorageKey : CONFIG.colors.background.lightStorageKey;
                const savedColor = localStorage.getItem(storageKey);
                backgroundInput.value = savedColor || colorSettings.background;
                if (!savedColor) {
                    localStorage.setItem(storageKey, colorSettings.background);
                }
            } else {
                console.warn('Background color input not found:', CONFIG.colors.background.id);
            }
            
            // Update color previews
            document.querySelectorAll('input[type="color"]').forEach(input => {
                if (typeof window.updateColorPreview === 'function') {
                    try {
                        window.updateColorPreview(input);
                    } catch (err) {
                        console.error('Error updating color preview:', err);
                    }
                }
            });
            
            // Apply colors to signatures
            if (typeof window.applyColors === 'function') {
                try {
                    window.applyColors();
                } catch (err) {
                    console.error('Error applying colors:', err);
                }
            }
            
            if (typeof window.updateSignatureColors === 'function') {
                try {
                    window.updateSignatureColors();
                } catch (err) {
                    console.error('Error updating signature colors:', err);
                }
            }
            
            if (typeof window.updateSignatures === 'function') {
                try {
                    window.updateSignatures();
                } catch (err) {
                    console.error('Error updating signatures:', err);
                }
            }
        } catch (error) {
            console.error('Error applying colors for mode:', colorMode, error);
        }
    }
    
    // Export the module to the EmailSignatureApp namespace
    app.DarkMode = _module;
    
    // Export functions to the global namespace for backward compatibility
    window.initializeDarkMode = _module.initialize;
    window.setDarkMode = _module.setDarkMode;
    window.isDarkMode = _module.isDarkMode;
    window.resetDarkMode = _module.resetDarkMode;
    window.checkDarkMode = function() {
        return _module.initialize();
    };
    
    window.updateSocialIconsForDarkMode = function(isDarkMode) {
        return _updateSocialIconsForDarkMode(isDarkMode);
    };
    
    // Make sure we're in the right namespace
    if (typeof app !== 'undefined') {
        // Add these functions to the module
        
        /**
         * Legacy function for checking dark mode
         * Moved from controls.js
         */
        _module.legacyCheckDarkMode = function() {
            try {
                DEBUG.info('Checking for dark mode preference (legacy method)');
                
                // Check localStorage for dark mode preference
                const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
                DEBUG.info('Dark mode preference:', isDarkMode);
                
                // Get the dark mode toggle
                const darkModeToggle = document.getElementById('dark-mode-toggle');
                
                if (darkModeToggle) {
                    // Set the toggle to match the preference
                    darkModeToggle.checked = isDarkMode;
                    
                    // Update the toggle label
                    _legacyUpdateDarkModeToggleLabel(isDarkMode);
                    
                    // Add event listener to the toggle
                    darkModeToggle.addEventListener('change', function() {
                        const newDarkMode = this.checked;
                        DEBUG.info('Dark mode toggle changed to:', newDarkMode);
                        
                        // Save preference to localStorage
                        localStorage.setItem('signature-dark-mode', newDarkMode);
                        
                        // Update the toggle label
                        _legacyUpdateDarkModeToggleLabel(newDarkMode);
                        
                        // Apply dark mode colors
                        if (typeof applyColors === 'function') {
                            applyColors();
                        }
                        
                        // Update social icons for dark mode using the new module if available
                        _updateSocialIconsForDarkMode(newDarkMode);
                    });
                    
                    // Apply dark mode immediately if needed
                    if (isDarkMode) {
                        DEBUG.info('Applying dark mode');
                        if (typeof applyColors === 'function') {
                            applyColors();
                        }
                        
                        // Update social icons for dark mode
                        _updateSocialIconsForDarkMode(true);
                    }
                } else {
                    console.warn('Dark mode toggle not found');
                }
            } catch (error) {
                console.error('Error checking for dark mode:', error);
            }
        };
        
        /** Legacy copy of the toggle-label updater, moved here from controls.js. */
        function _legacyUpdateDarkModeToggleLabel(isDarkMode) {
            const label = document.querySelector('label[for="dark-mode-toggle"]');
            if (label) {
                label.textContent = isDarkMode ? 'Dark Mode: On' : 'Dark Mode: Off';
            }
        }
    }
})(window.EmailSignatureApp = window.EmailSignatureApp || {});

// Initialize if document is already loaded
if (document.readyState === 'complete') {
    if (window.EmailSignatureApp && window.EmailSignatureApp.DarkMode) {
        window.EmailSignatureApp.DarkMode.initialize();
    }
}

// Initialize the dark mode module when the EmailSignatureApp is ready
document.addEventListener('EmailSignatureAppReady', function() {
    if (window.EmailSignatureApp && window.EmailSignatureApp.DarkMode) {
        window.EmailSignatureApp.DarkMode.initialize();
    }
});