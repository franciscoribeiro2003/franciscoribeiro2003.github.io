// Debug config
console.log('Config object exists:', !!window.APP_CONFIG);

// Initialize PocketBase client with proper URL handling and better fallback
const pocketbaseUrl = window.APP_CONFIG?.pocketbaseUrl || 'https://pocketbase-cloudrun-761697169023.europe-southwest1.run.app';
const pb = new PocketBase(pocketbaseUrl);

// Global state
const state = {
    language: localStorage.getItem('language') || 'en', // Default language
    theme: localStorage.getItem('theme') || 'light',
    data: null,
    isLoading: true,
    sidebarExpanded: window.innerWidth > 1024
};

// DOM Elements
const loader = document.querySelector('.loader-container');
const sidebar = document.querySelector('.sidebar');
const themeToggle = document.getElementById('theme-toggle');
const languageToggle = document.getElementById('language-toggle');
const menuToggle = document.querySelector('.menu-toggle');
const currentYearEl = document.getElementById('current-year');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadData();
    setTheme(state.theme);
    setLanguage(state.language);
    currentYearEl.textContent = new Date().getFullYear();
    
    // Initially expand/collapse sidebar based on screen size
    if (state.sidebarExpanded) {
        sidebar.classList.add('expanded');
    }
});

// Setup event listeners
function setupEventListeners() {
    // Theme toggle
    themeToggle.addEventListener('click', () => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
    });

    // Language toggle
    languageToggle.addEventListener('click', () => {
        const newLang = state.language === 'en' ? 'pt' : 'en';
        setLanguage(newLang);
    });

    // Mobile menu toggle
    menuToggle?.addEventListener('click', () => {
        sidebar.classList.toggle('expanded');
        state.sidebarExpanded = sidebar.classList.contains('expanded');
        document.body.classList.toggle('menu-open');
    });

    // Navigation links
    // Close menu when clicking on links (mobile)
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('expanded');
                document.body.classList.remove('menu-open');
            }
        });
    });


    // Contact form submission
    const contactForm = document.getElementById('contact-form');
    contactForm?.addEventListener('submit', handleContactFormSubmit);
    
    // Window resize event to handle sidebar state
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            if (state.sidebarExpanded) {
                sidebar.classList.add('expanded');
            } else {
                sidebar.classList.remove('expanded');
            }
        } else if (window.innerWidth < 768) {
            sidebar.classList.remove('expanded');
        }
    });
    
    // Set active nav item based on scroll
    window.addEventListener('scroll', highlightActiveSection);
}

// Highlight active section based on scroll position
function highlightActiveSection() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let currentSection = '';
    
    sections.forEach((section) => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        
        if (window.scrollY >= sectionTop - 100) {
            currentSection = section.getAttribute('id');
        }
    });
    
    navLinks.forEach((link) => {
        link.classList.remove('active');
        if (link.getAttribute('href').substring(1) === currentSection) {
            link.classList.add('active');
        }
    });
}

// Load data from PocketBase
async function loadData() {
    try {
        // Get main webpage data (contains references to other collections)
        const webpageData = await pb.collection('webpage').getOne('1a3s93a5usxkpj7', {
            expand: 'languages,skills,projects,projects.field'
        });
        
        // Get education data
        const educationData = await pb.collection('education').getFullList();
        
        // Get experience data
        const experienceData = await pb.collection('experience').getFullList({
            expand: 'positions'
        });

        // If projects aren't expanding properly, let's fetch them directly
        let projectsData = webpageData.expand?.projects || [];
        if (!projectsData.length && webpageData.projects && webpageData.projects.length) {
            // Fetch projects directly using the IDs from the webpage record
            projectsData = await Promise.all(
                webpageData.projects.map(id => 
                    pb.collection('projects').getOne(id, { expand: 'field' })
                )
            );
            // Add projects to the expanded data
            webpageData.expand = webpageData.expand || {};
            webpageData.expand.projects = projectsData;
        }
        
        // Get volunteering data
        const volunteeringData = await pb.collection('volunteering').getFullList({
            expand: 'positions'
        });

        // Store all data in state
        state.data = {
            webpage: webpageData,
            education: educationData,
            experience: experienceData,
            volunteering: volunteeringData,
        };

        // Render all sections
        renderContent();
        
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Failed to load data. Please try again later.');
    } finally {
        state.isLoading = false;
        hideLoader();
    }
}

// Render all content sections
function renderContent() {
    if (!state.data) return;
    
    const { webpage, education, experience, volunteering } = state.data;
    const lang = state.language;
    
    // Set profile image
    if (webpage.photo) {
        const profileImage = document.getElementById('profile-image');
        profileImage.src = pb.files.getUrl(webpage, webpage.photo);
    }
    
    // Set profile title
    const profileTitle = document.getElementById('profile-title');
    profileTitle.textContent = lang === 'en' ? 'Software Developer' : 'Desenvolvedor de Software';
    
    // About section
    const aboutText = document.getElementById('about-text');
    aboutText.innerHTML = lang === 'en' ? webpage.about_en : webpage.about_pt;
    
    // Skills section
    renderSkills(webpage.expand?.skills || []);
    
    // Languages section
    renderLanguages(webpage.expand?.languages || []);
    
    // Projects section
    renderProjects(webpage.expand?.projects || []);
    
    // Experience timeline
    renderExperience(experience);
    
    // Education timeline
    renderEducation(education);
    
    // Volunteering timeline
    renderVolunteering(volunteering);
}

// Render skills section
function renderSkills(skills) {
    const skillsContainer = document.getElementById('skills-container');
    skillsContainer.innerHTML = '';
    
    skills.forEach(skill => {
        // Convert GitHub URLs to raw.githubusercontent.com URLs if needed
        let photoUrl = skill.photo;
        if (photoUrl.includes('github.com') && photoUrl.includes('/blob/')) {
            photoUrl = photoUrl.replace('github.com', 'raw.githubusercontent.com')
                               .replace('/blob/', '/');
        }
        
        // Append the image with proper attributes
        skillsContainer.innerHTML += `
            <img src="${photoUrl}" title="${skill.name}" alt="${skill.name}" width="50" height="50"/>&nbsp;
        `;
    });
}

// Render languages section
function renderLanguages(languages) {
    const languagesContainer = document.getElementById('languages-container');
    languagesContainer.innerHTML = '';
    
    languages.forEach(language => {
        const langElement = document.createElement('div');
        langElement.className = 'language-item';
        
        const langName = state.language === 'en' ? language.name_en : language.name_pt;
        const langType = state.language === 'en' ? language.type_en : language.type_pt;
        
        langElement.innerHTML = `
            <h3 class="language-name">${langName}</h3>
            <p class="language-level">${langType}</p>
        `;
        
        languagesContainer.appendChild(langElement);
    });
}

// Render projects section
function renderProjects(projects) {
    const projectsGrid = document.getElementById('projects-grid');
    projectsGrid.innerHTML = '';
    
    projects.forEach(project => {
        const projectElement = document.createElement('div');
        projectElement.className = 'project-card';
        
        const projectName = state.language === 'en' ? project.name_en : project.name_pt;
        let projectDescription = '';
        
        // Check if field exists and has markdown content
        if (project.expand?.field) {
            const field = project.expand.field;
            projectDescription = state.language === 'en' ? field.markdown_en : field.markdown_pt;
        }
        
        let imageHtml = '';
        if (project.photo) {
            const imageUrl = pb.files.getUrl(project, project.photo);
            imageHtml = `
                <div class="project-image">
                    <img src="${imageUrl}" alt="${projectName}">
                </div>
            `;
        }
        
        projectElement.innerHTML = `
            ${imageHtml}
            <div class="project-content">
                <h3>${projectName}</h3>
                <div class="project-description">${projectDescription}</div>
                ${project.github ? `
                <div class="project-links">
                    <a href="${project.github}" target="_blank" class="project-link">
                        <i class="fab fa-github"></i> GitHub
                    </a>
                </div>
                ` : ''}
            </div>
        `;
        
        projectsGrid.appendChild(projectElement);
    });
}

// Render experience timeline
function renderExperience(experiences) {
    const timelineEl = document.getElementById('experience-timeline');
    timelineEl.innerHTML = '';
    
    // Sort experiences by start date (most recent first)
    const sortedExperiences = [...experiences].sort((a, b) => {
        const aStartDate = getLatestPositionDate(a.expand?.positions || []);
        const bStartDate = getLatestPositionDate(b.expand?.positions || []);
        return bStartDate - aStartDate;
    });
    
    sortedExperiences.forEach(experience => {
        const positions = experience.expand?.positions || [];
        positions.forEach((position, index) => {
            const timelineItem = createTimelineItem(
                experience.company_name,
                state.language === 'en' ? position.title_en : position.title_pt,
                position.start,
                position.end,
                state.language === 'en' ? position.description_en : position.description_pt,
                experience.location,
                position.type
            );
            timelineEl.appendChild(timelineItem);
        });
    });
}

// Render education timeline
function renderEducation(educations) {
    const timelineEl = document.getElementById('education-timeline');
    timelineEl.innerHTML = '';
    
    // Sort educations by start date (most recent first)
    const sortedEducations = [...educations].sort((a, b) => {
        return new Date(b.start) - new Date(a.start);
    });
    
    sortedEducations.forEach(education => {
        const timelineItem = createTimelineItem(
            education.name,
            education.course,
            education.start,
            education.end
        );
        timelineEl.appendChild(timelineItem);
    });
}

// Render volunteering timeline
function renderVolunteering(volunteerings) {
    const timelineEl = document.getElementById('volunteering-timeline');
    timelineEl.innerHTML = '';
    
    // Sort volunteerings by start date (most recent first)
    const sortedVolunteerings = [...volunteerings].sort((a, b) => {
        const aStartDate = getLatestPositionDate(a.expand?.positions || []);
        const bStartDate = getLatestPositionDate(b.expand?.positions || []);
        return bStartDate - aStartDate;
    });
    
    sortedVolunteerings.forEach(volunteering => {
        const positions = volunteering.expand?.positions || [];
        positions.forEach(position => {
            const timelineItem = createTimelineItem(
                volunteering.instituition,
                state.language === 'en' ? position.title_en : position.title_pt,
                position.start,
                position.end,
                state.language === 'en' ? position.description_en : position.description_pt
            );
            timelineEl.appendChild(timelineItem);
        });
    });
}

// Create timeline item element
function createTimelineItem(title, subtitle, startDate, endDate, description = '', location = '', type = '') {
    const itemEl = document.createElement('div');
    itemEl.className = 'timeline-item';
    
    // Format dates
    const start = startDate ? new Date(startDate).toLocaleDateString(state.language === 'en' ? 'en-US' : 'pt-BR', { year: 'numeric', month: 'short' }) : '';
    const end = endDate ? new Date(endDate).toLocaleDateString(state.language === 'en' ? 'en-US' : 'pt-BR', { year: 'numeric', month: 'short' }) : state.language === 'en' ? 'Present' : 'Atual';
    
    let typeText = '';
    if (type) {
        typeText = `<span class="timeline-type">${type}</span>`;
    }
    
    let locationText = '';
    if (location) {
        locationText = `<div class="timeline-location"><i class="fas fa-map-marker-alt"></i> ${location}</div>`;
    }
    
    itemEl.innerHTML = `
        <div class="timeline-content">
            <h3>${title}</h3>
            <h4>${subtitle}</h4>
            <p class="timeline-date">${start} - ${end}</p>
            ${typeText}
            ${locationText}
            <div class="timeline-description">${description}</div>
        </div>
    `;
    
    return itemEl;
}

// Helper to find latest position start date
function getLatestPositionDate(positions) {
    if (!positions.length) return new Date(0);
    
    return Math.max(...positions.map(pos => new Date(pos.start).getTime()));
}

// Handle contact form submission
function handleContactFormSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;
    
    // Display loading state
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Sending...';
    
    // Use FormSubmit.co - replace YOUR_EMAIL with your actual email
    const formData = new FormData();
    formData.append('name', name);
    formData.append('email', email);
    formData.append('message', message);
    
    fetch('https://formsubmit.co/franciscorib2003@gmail.com', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (response.ok) {
            // Show success message
            showMessage(`Thank you ${name}! Your message has been sent.`, 'success');
            e.target.reset();
        } else {
            throw new Error('Failed to send message');
        }
    })
    .catch(error => {
        console.error('Error sending form:', error);
        showMessage('Failed to send message. Please try again later.', 'error');
    })
    .finally(() => {
        // Reset button state
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    });
}

// Show message (success or error)
function showMessage(message, type = 'success') {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}-message`;
    messageEl.textContent = message;
    
    document.body.appendChild(messageEl);
    
    setTimeout(() => {
        messageEl.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        messageEl.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(messageEl);
        }, 300);
    }, 5000);
}

// Set theme (light/dark)
function setTheme(theme) {
    document.body.classList.remove('dark-theme', 'light-theme');
    document.body.classList.add(`${theme}-theme`);
    
    // Update icon
    themeToggle.innerHTML = theme === 'dark' 
        ? '<i class="fas fa-sun"></i>' 
        : '<i class="fas fa-moon"></i>';
    
    state.theme = theme;
    localStorage.setItem('theme', theme);
}

// Set language (en/pt)
function setLanguage(lang) {
    state.language = lang;
    localStorage.setItem('language', lang);
    
    // Update language toggle button
    languageToggle.querySelector('.current-lang').textContent = lang.toUpperCase();
    
    // Use the global function from i18n.js to update translations
    if (window.setLanguageAndUpdate) {
        window.setLanguageAndUpdate(lang);
    }
    
    // Re-render content if data is loaded
    if (state.data) {
        renderContent();
    }
}

// Show error message
function showError(message) {
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    
    document.body.appendChild(errorEl);
    
    setTimeout(() => {
        errorEl.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        errorEl.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(errorEl);
        }, 300);
    }, 5000);
}

// Hide loader
function hideLoader() {
    loader.classList.add('loader-hidden');
    setTimeout(() => {
        loader.style.display = 'none';
    }, 500);
}