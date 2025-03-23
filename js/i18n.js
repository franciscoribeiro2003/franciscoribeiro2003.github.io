// Translations
const translations = {
    en: {
        nav: {
            about: "About",
            experience: "Experience",
            education: "Education",
            skills: "Skills",
            projects: "Projects",
            contact: "Contact",
            cv: "Resume / CV"
        },
        hero: {
            title: "Software Developer",
            description: "Building innovative web and mobile solutions",
            viewProjects: "View Projects",
            contact: "Contact Me"
        },
        about: {
            title: "About Me",
            downloadCV: "Download CV"
        },
        experience: {
            title: "Experience"
        },
        education: {
            title: "Education"
        },
        skills: {
            title: "Skills"
        },
        languages: {
            title: "Languages"
        },
        projects: {
            title: "Projects"
        },
        volunteering: {
            title: "Volunteering"
        },
        contact: {
            title: "Contact Me",
            name: "Name",
            email: "Email",
            message: "Message",
            send: "Send Message"
        },
        footer: {
            rights: "All rights reserved."
        }
    },
    pt: {
        nav: {
            about: "Sobre",
            experience: "Experiência",
            education: "Educação",
            skills: "Skills",
            projects: "Projetos",
            contact: "Contacto",
            cv: "Currículo"
        },
        hero: {
            title: "Desenvolvedor de Software",
            description: "Construindo soluções inovadoras para web e mobile",
            viewProjects: "Ver Projetos",
            contact: "Contate-me"
        },
        about: {
            title: "Sobre Mim",
            downloadCV: "Descarregar Currículo"
        },
        experience: {
            title: "Experiência"
        },
        education: {
            title: "Educação"
        },
        skills: {
            title: "Skills"
        },
        languages: {
            title: "Idiomas"
        },
        projects: {
            title: "Projetos"
        },
        volunteering: {
            title: "Voluntariado"
        },
        contact: {
            title: "Contacto",
            name: "Nome",
            email: "Email",
            message: "Mensagem",
            send: "Enviar Mensagem"
        },
        footer: {
            rights: "Todos os direitos reservados."
        }
    }
};

// Get language from localStorage or default to 'en'
let currentLanguage = localStorage.getItem('language') || 'en';

// Function to update all i18n elements based on current language
function updateI18nElements() {
    const elements = document.querySelectorAll('[data-i18n]');
    
    elements.forEach(element => {
        const key = element.dataset.i18n;
        
        // Get the nested translation using the key (e.g., "nav.about")
        const value = key.split('.').reduce((obj, k) => {
            return obj && obj[k] !== undefined ? obj[k] : null;
        }, translations[currentLanguage]);
        
        if (value !== null) {
            // Check if the element is an input with placeholder
            if (element.tagName === 'INPUT' && element.hasAttribute('placeholder')) {
                element.placeholder = value;
            } 
            // Check if it's a button with type="submit"
            else if (element.tagName === 'BUTTON' && element.type === 'submit') {
                element.textContent = value;
            } 
            // For all other elements
            else {
                element.textContent = value;
            }
        }
    });
}

// Export function for main.js to call when language changes
window.setLanguageAndUpdate = function(lang) {
    currentLanguage = lang;
    updateI18nElements();
};

// Initialize translations when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    updateI18nElements();
});