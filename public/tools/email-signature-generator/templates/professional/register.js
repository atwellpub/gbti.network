/**
 * Professional Template Registration
 * This file handles the registration and initialization of the professional email signature template
 */

// Register the professional template
(function() {
    // Define the template information
    const professionalTemplate = {
        name: 'professional',
        displayName: 'Professional',
        description: 'Clean business layout with accent color and organized information',
        paths: {
            html: 'templates/professional/html/professional.html',
            css: 'templates/professional/css/professional.css'
        },
        
        /**
         * Initialize the template after it's loaded
         * @param {HTMLElement} container - The container element
         */
        initialize: function(container) {
            DEBUG.info('Initializing professional template');
            
            // Apply the current color settings to CSS variables
            this.applyColorVariables(container);
            
            // Handle empty Calendly URLs
            const calendlyUrl = document.getElementById('input-calendly').value;
            
            if (!calendlyUrl || calendlyUrl.trim() === '') {
                // Find and hide all elements with the calendly class
                const calendlyElements = container.querySelectorAll('.calendly');
                calendlyElements.forEach(element => {
                    element.style.display = 'none';
                });
                
                // Hide the Calendly icon in social icons section if present
                const calendlyIcon = container.querySelector('.sig-social-icons a[href*="calendly"]');
                if (calendlyIcon) {
                    calendlyIcon.style.display = 'none';
                }
                
                DEBUG.info('Professional template: Calendly elements hidden due to empty URL');
            }
            
            // Handle company logo
            const companyLogo = container.querySelector('.company-logo');
            if (companyLogo) {
                // Get company logo URL from input or use default
                const companyLogoUrl = document.getElementById('input-company-logo')?.value;
                if (companyLogoUrl && companyLogoUrl.trim() !== '') {
                    companyLogo.src = companyLogoUrl;
                }
                
                // Hide the logo container if no logo is available
                if (!companyLogoUrl || companyLogoUrl.trim() === '') {
                    const logoParent = companyLogo.parentElement;
                    if (logoParent && logoParent.tagName.toLowerCase() === 'td') {
                        logoParent.style.display = 'none';
                    }
                }
            }
            
            // Add event listeners for Calendly text updates
            const calendlyTextInput = document.getElementById('input-calendly-text');
            if (calendlyTextInput) {
                // Initial update
                updateCalendlyText(container, calendlyTextInput.value);
                
                // Update on input changes
                calendlyTextInput.addEventListener('input', function() {
                    updateCalendlyText(container, this.value);
                });
            }
            
            // Update colors when color inputs change
            document.querySelectorAll('input[type="color"]').forEach(colorInput => {
                colorInput.addEventListener('input', () => {
                    this.applyColorVariables(container);
                });
            });
            
            // Listen for profile radius change events
            document.addEventListener('profileRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Professional template: Applying profile radius:', radius);
                
                // Find all profile images and apply the border radius directly as inline style
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Listen for logo radius change events
            document.addEventListener('logoRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Professional template: Applying logo radius:', radius);
                
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
            
            // Function to update Calendly text
            function updateCalendlyText(container, text) {
                const calendlyTextElements = container.querySelectorAll('.calendly-text');
                calendlyTextElements.forEach(element => {
                    // Only update elements that don't have child elements
                    if (element.childElementCount === 0) {
                        element.textContent = text || CONFIG.defaults.calendlyText;
                    }
                });
            }
        },
        
        applyColorVariables: function(container) {
            // Get current color values
            const mode = localStorage.getItem('signature-dark-mode') === 'true' ? 'dark' : 'light';
            const primaryColor = localStorage.getItem(`signature-primary-color-${mode}`) || CONFIG.colors[mode].primary;
            const secondaryColor = localStorage.getItem(`signature-secondary-color-${mode}`) || CONFIG.colors[mode].secondary;
            const accentColor = localStorage.getItem(`signature-accent-color-${mode}`) || CONFIG.colors[mode].accent;
            
            // Apply colors to CSS variables
            container.style.setProperty('--accent-color', accentColor);
            container.style.setProperty('--primary-color', primaryColor);
            container.style.setProperty('--secondary-color', secondaryColor);
            
            // Apply accent color to SVG icons directly
            const svgIcons = container.querySelectorAll('.icon-svg');
            svgIcons.forEach(svg => {
                svg.setAttribute('fill', accentColor);
            });
            
            // Apply accent color to company name
            const companyName = container.querySelector('.company-name');
            if (companyName) {
                companyName.style.color = accentColor;
            }
            
            // Apply accent color to border
            const accentBorder = container.querySelector('.accent-border');
            if (accentBorder) {
                accentBorder.style.borderLeftColor = accentColor;
            }
        }
    };

    // Register this template with the main application
    if (window.EmailSignatureApp && window.EmailSignatureApp.registerTemplate) {
        window.EmailSignatureApp.registerTemplate(professionalTemplate);
    } else {
        // If the app isn't ready yet, wait for it
        document.addEventListener('EmailSignatureAppReady', function() {
            window.EmailSignatureApp.registerTemplate(professionalTemplate);
        });
    }

    // Export the template info for direct access
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = professionalTemplate;
    } else if (window) {
        window.ProfessionalTemplate = professionalTemplate;
    }
})();
