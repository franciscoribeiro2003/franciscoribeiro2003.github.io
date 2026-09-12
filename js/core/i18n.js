/**
 * Translations. Keys are dotted paths used by `data-i18n` attributes and by
 * the `t()` helper. English is the default and the fallback.
 */

export const translations = {
  en: {
    nav: {
      projects: "Projects",
      photography: "Photography",
      map: "Map",
      blog: "Blog",
      cv: "CV",
      menu: "Menu",
      theme: "Toggle theme",
      language: "Language",
    },
    home: {
      aside:
        "Beyond the computer: photography, or on a bike.",
      projects: "projects/",
      experience: "experience/",
      education: "education/",
      contact: "contact/",
      map: "map/",
      repositories: "repositories",
      contactLead:
        "Happy to talk about stuff :)",
      guestbook: "Open the guestbook",
      guestbookCue: "Write or draw something on my guestbook",
    },
    projects: {
      intro:
        "Software engineering work — mostly backends, spatial data and, lately, language models that have to be right about numbers.",
      empty: "Nothing published yet.",
    },
    photography: {
      intro:
        "Photographs, kept where they were taken. Mostly light, water and empty roads.",
      places: "Places",
      albums: "Albums",
      timeline: "Timeline",
      openMap: "open full map",
      photographs: "photographs",
      counted: "{n} photographs · {p} places",
    },
    map: {
      intro: "A record of the routes I have ridden.",
      trips: "Trips",
      selected: "Selected trip",
      stages: "Stages",
      fromTheRoad: "From the road",
      allRoutes: "all routes",
      summary: "{trips} trips · {stages} stages · {km} km",
      hint: "drag to rotate · scroll to zoom",
      modes: {
        all: "All",
        cycling: "Cycling",
        hiking: "Hiking",
        boat: "Boat",
        train: "Train",
      },
      stats: { km: "km", climb: "m climbed", days: "days" },
      clouds: "Clouds cover the places I have not ridden yet.",
      noDescription: "Not written up yet.",
    },
    blog: {
      intro:
        "Notes on things I worked out the hard way — some technical, some not.",
      all: "All",
      empty: "Nothing published yet.",
    },
    guestbook: {
      title: "guestbook",
      close: "Close the guestbook",
      prev: "Previous page",
      next: "Next page",
      lastPage: "Go to the blank page",
      toolPen: "Pen — draw anywhere",
      toolText: "Text — click the page to write",
      undo: "Undo the last stroke",
      discard: "Start this page again",
      move: "Move this text",
      remove: "Delete this text",
      sign: "sign your name",
      namePlaceholder: "your name",
      submit: "leave it in the book",
      sending: "signing…",
      pending: "Thank you — your page will appear once it is approved.",
      failed: "Could not save right now. Your page is still here.",
      readonly: "The guestbook is read-only at the moment.",
      aDrawing: "A page drawn by a visitor",
    },
    footer: {
      source: "Source",
      updated: "Updated {date}",
    },
    post: {
      readOn: "Read on",
      visit: "Open link",
      allPosts: "← all posts",
      allProjects: "← all projects",
      missing: {
        title: "Not found",
        body: "There is no entry at this address. It may have been renamed, or never published.",
      },
    },
    common: {
      loading: "Loading…",
      offline: "Showing the last saved copy of this content.",
    },
  },

  pt: {
    nav: {
      projects: "Projetos",
      photography: "Fotografia",
      map: "Mapa",
      blog: "Blog",
      cv: "CV",
      menu: "Menu",
      theme: "Alternar tema",
      language: "Idioma",
    },
    home: {
      aside:
        "Longe do teclado: fotografia e voltas longas de bicicleta carregada.",
      projects: "projetos/",
      experience: "experiencia/",
      education: "educacao/",
      contact: "contacto/",
      map: "mapa/",
      repositories: "repositórios",
      contactLead:
        "Se quiser falar sobre alguma coisa :)",
      guestbook: "Abrir o livro de visitas",
      guestbookCue: "Escreve ou desenha algo no meu livro de visitas",
    },
    projects: {
      intro:
        "Trabalho de engenharia de software — sobretudo backends, dados espaciais e, ultimamente, modelos de linguagem que têm de acertar nos números.",
      empty: "Ainda nada publicado.",
    },
    photography: {
      intro:
        "Fotografias, guardadas onde foram tiradas. Sobretudo luz, água e estradas vazias.",
      places: "Lugares",
      albums: "Álbuns",
      timeline: "Cronologia",
      openMap: "abrir mapa completo",
      photographs: "fotografias",
      counted: "{n} fotografias · {p} lugares",
    },
    map: {
      intro: "Um registo das rotas que já pedalei.",
      trips: "Viagens",
      selected: "Viagem selecionada",
      stages: "Etapas",
      fromTheRoad: "Da estrada",
      allRoutes: "todas as rotas",
      summary: "{trips} viagens · {stages} etapas · {km} km",
      hint: "arrastar para rodar · scroll para ampliar",
      modes: {
        all: "Todas",
        cycling: "Bicicleta",
        hiking: "A pé",
        boat: "Barco",
        train: "Comboio",
      },
      stats: { km: "km", climb: "m subidos", days: "dias" },
      clouds: "As nuvens cobrem os sítios onde ainda não pedalei.",
      noDescription: "Ainda sem descrição.",
    },
    blog: {
      intro:
        "Notas sobre coisas que percebi à força — umas técnicas, outras nem por isso.",
      all: "Tudo",
      empty: "Ainda nada publicado.",
    },
    guestbook: {
      title: "livro de visitas",
      close: "Fechar o livro de visitas",
      prev: "Página anterior",
      next: "Página seguinte",
      lastPage: "Ir para a página em branco",
      toolPen: "Caneta — desenha onde quiseres",
      toolText: "Texto — clica na página para escrever",
      undo: "Anular o último traço",
      discard: "Recomeçar esta página",
      move: "Mover este texto",
      remove: "Apagar este texto",
      sign: "assina o teu nome",
      namePlaceholder: "o teu nome",
      submit: "deixar no livro",
      sending: "a assinar…",
      pending: "Obrigado — a tua página aparece assim que for aprovada.",
      failed: "Não consegui guardar agora. A tua página continua aqui.",
      readonly: "O livro de visitas está apenas para leitura de momento.",
      aDrawing: "Uma página desenhada por um visitante",
    },
    footer: {
      source: "Código",
      updated: "Atualizado {date}",
    },
    post: {
      readOn: "Ler no",
      visit: "Abrir ligação",
      allPosts: "← todos os artigos",
      allProjects: "← todos os projetos",
      missing: {
        title: "Não encontrado",
        body: "Não existe nada neste endereço. Pode ter mudado de nome ou nunca ter sido publicado.",
      },
    },
    common: {
      loading: "A carregar…",
      offline: "A mostrar a última cópia guardada deste conteúdo.",
    },
  },
};

/** Resolve a dotted key against a language, falling back to English. */
export function lookup(lang, key) {
  const walk = (obj) =>
    key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
  const hit = walk(translations[lang]);
  return hit !== null ? hit : walk(translations.en);
}
