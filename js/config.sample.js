// Copy to js/config.js for local development.
// In CI the deploy workflow generates js/config.js from repository secrets.
window.APP_CONFIG = {
  // PocketBase on Cloud Run — the runtime source of every piece of content on
  // the site. The repo ships no content of its own, so with this unset the
  // pages render their static shell and nothing else.
  pocketbaseUrl: "",

  // Public base URL for images in Cloud Storage, e.g.
  // "https://storage.googleapis.com/<bucket>". Leave empty to use paths as-is.
  mediaBaseUrl: "",

  // Satellite raster tiles. null falls back to Esri World Imagery, which needs
  // no key. Set an array of URL templates to use MapTiler, Mapbox, etc.
  satelliteTiles: null,
  satelliteAttribution: "",
};
