/**
 * Sidebar Template Registration
 * This file handles the registration and initialization of the sidebar email signature template
 */

// Register the sidebar template
(function() {
    // Define the template information
    const sidebarTemplate = {
        name: 'sidebar',
        displayName: 'Sidebar',
        description: 'Modern layout with an accent sidebar and clean information organization',
        paths: {
            html: 'templates/sidebar/html/sidebar.html',
            css: 'templates/sidebar/css/sidebar.css'
        },
        
        /**
         * Initialize the template after it's loaded
         * @param {HTMLElement} container - The container element
         */
        initialize: function(container) {
            DEBUG.info('Initializing sidebar template');
            
            // Show sidebar-specific fields
            this.toggleSidebarFields(true);
            
            // Apply the current color settings to CSS variables
            this.applyColorVariables(container);
            
            // Handle address and quote fields
            this.updateAddressAndQuote(container);
            
            // Handle empty Calendly URLs
            const calendlyUrl = document.getElementById('input-calendly').value;
            const calendlyText = document.getElementById('input-calendly-text').value || CONFIG.defaults.calendlyText;
            
            if (!calendlyUrl || calendlyUrl.trim() === '') {
                // Find and hide all elements with the calendly class
                const calendlyElements = container.querySelectorAll('.calendly');
                calendlyElements.forEach(element => {
                    element.style.display = 'none';
                });
                
                DEBUG.info('Sidebar template: Calendly elements hidden due to empty URL');
            } else {
                // Update Calendly URLs in elements with calendly-link class
                const calendlyLinks = container.querySelectorAll('.calendly-link');
                calendlyLinks.forEach(element => {
                    element.href = calendlyUrl;
                });
                
                // Update Calendly text in elements with calendly-text class
                const calendlyTextElements = container.querySelectorAll('.calendly-text');
                calendlyTextElements.forEach(element => {
                    // Only update text content if the element has no child elements
                    if (element.childElementCount === 0) {
                        element.textContent = calendlyText;
                    }
                });
            }
            
            // Setup event listeners for color changes
            document.querySelectorAll('input[type="color"]').forEach(colorInput => {
                colorInput.addEventListener('input', () => {
                    this.applyColorVariables(container);
                });
            });
            
            // Setup event listeners for Calendly changes
            const calendlyUrlInput = document.getElementById('input-calendly');
            if (calendlyUrlInput) {
                calendlyUrlInput.addEventListener('input', () => {
                    this.handleCalendlyChange(container);
                });
            }
            
            const calendlyTextInput = document.getElementById('input-calendly-text');
            if (calendlyTextInput) {
                calendlyTextInput.addEventListener('input', () => {
                    this.handleCalendlyChange(container);
                });
            }
            
            // Setup event listeners for Address and Quote fields
            const addressInput = document.getElementById('input-address');
            if (addressInput) {
                addressInput.addEventListener('input', () => {
                    this.updateAddressAndQuote(container);
                });
            }
            
            const quoteInput = document.getElementById('input-quote');
            if (quoteInput) {
                quoteInput.addEventListener('input', () => {
                    this.updateAddressAndQuote(container);
                });
            }
            
            // Listen for profile radius change events
            document.addEventListener('profileRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Sidebar template: Applying profile radius:', radius);
                
                // Find all profile images and apply the border radius directly as inline style
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Listen for logo radius change events
            document.addEventListener('logoRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Sidebar template: Applying logo radius:', radius);
                
                // Find all logo images and apply the border radius directly as inline style
                const logoImages = container.querySelectorAll('.company-logo');
                logoImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Apply initial radius values from localStorage if available
            const savedProfileRadius = localStorage.getItem('profile-radius');
            if (savedProfileRadius) {
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = savedProfileRadius + 'px';
                });
            }
            
            const savedLogoRadius = localStorage.getItem('logo-radius');
            if (savedLogoRadius) {
                const logoImages = container.querySelectorAll('.company-logo');
                logoImages.forEach(img => {
                    img.style.borderRadius = savedLogoRadius + 'px';
                });
            }
        },
        
        toggleSidebarFields: function(show) {
            const sidebarFields = document.querySelectorAll('.sidebar-template-fields');
            sidebarFields.forEach(element => {
                element.style.display = show ? 'flex' : 'none';
            });
        },
        
        updateAddressAndQuote: function(container) {
            // Get input values
            const address = document.getElementById('input-address').value;
            const quote = document.getElementById('input-quote').value;
            
            // Update address
            const addressElements = container.querySelectorAll('.address');
            addressElements.forEach(element => {
                element.textContent = address || 'San Francisco, CA';
            });
            
            // Update quote
            const quoteElements = container.querySelectorAll('.quote');
            quoteElements.forEach(element => {
                element.textContent = quote || 'Building better digital experiences';
            });
            
            // Show/hide address row based on content
            const addressRows = container.querySelectorAll('.address-row');
            addressRows.forEach(element => {
                element.style.display = address.trim() === '' ? 'none' : '';
            });
        },
        
        /**
         * Handle Calendly link and text changes
         * @param {HTMLElement} container - The container element
         */
        handleCalendlyChange: function(container) {
            const calendlyUrl = document.getElementById('input-calendly').value;
            const calendlyText = document.getElementById('input-calendly-text').value || CONFIG.defaults.calendlyText;
            
            // Hide/show Calendly elements based on URL
            const calendlyElements = container.querySelectorAll('.calendly');
            calendlyElements.forEach(element => {
                if (!calendlyUrl || calendlyUrl.trim() === '') {
                    element.style.display = 'none';
                } else {
                    element.style.display = '';
                }
            });
            
            // Update Calendly URLs
            const calendlyLinks = container.querySelectorAll('.calendly-link');
            calendlyLinks.forEach(element => {
                element.href = calendlyUrl;
            });
            
            // Update Calendly text
            const calendlyTextElements = container.querySelectorAll('.calendly-text');
            calendlyTextElements.forEach(element => {
                if (element.childElementCount === 0) {
                    element.textContent = calendlyText;
                }
            });
        },
        
        applyColorVariables: function(container) {
            // Get current color values
            const mode = localStorage.getItem('signature-dark-mode') === 'true' ? 'dark' : 'light';
            const primaryColor = document.getElementById('color-primary')?.value || CONFIG.colors[mode].primary;
            const secondaryColor = document.getElementById('color-secondary')?.value || CONFIG.colors[mode].secondary;
            const accentColor = document.getElementById('color-accent')?.value || CONFIG.colors[mode].accent;
            
            // Apply colors to CSS variables
            container.style.setProperty('--accent-color', accentColor);
            container.style.setProperty('--primary-color', primaryColor);
            container.style.setProperty('--secondary-color', secondaryColor);
        }
    };

    // Register this template with the main application
    if (window.EmailSignatureApp && window.EmailSignatureApp.registerTemplate) {
        window.EmailSignatureApp.registerTemplate(sidebarTemplate);
    } else {
        // If the app isn't ready yet, wait for it
        document.addEventListener('EmailSignatureAppReady', function() {
            window.EmailSignatureApp.registerTemplate(sidebarTemplate);
        });
    }

    // Export the template info for direct access
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = sidebarTemplate;
    } else if (window) {
        window.SidebarTemplate = sidebarTemplate;
    }
})();
