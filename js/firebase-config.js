/* =========================================================
   CONFIGURATION FIREBASE — Sun Pilot · Neon Skies
   ---------------------------------------------------------
   1. Console Firebase → ⚙ Paramètres du projet → "Vos applications"
      → application Web (</>) → copiez l'objet firebaseConfig ici.
   2. Ces valeurs ne sont PAS secrètes : la sécurité repose sur
      les règles Firestore (firestore.rules), App Check et la
      restriction de la clé API à vos domaines.
   ========================================================= */
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBice5Nf03MQGyIxLW5R6UzGQfifvsUPmY",
  authDomain:        "sun-pilot-jercat.firebaseapp.com",
  projectId:         "sun-pilot-jercat",
  storageBucket:     "sun-pilot-jercat.firebasestorage.app",
  messagingSenderId: "9721842956",
  appId:             "1:9721842956:web:8f418c8fd52ac58e920d29",
};

export const LB_OPTIONS = {
  // Facultatif mais recommandé : clé de site reCAPTCHA v3 pour Firebase App Check.
  // Laissez vide pour désactiver App Check.
  appCheckSiteKey: "",

  // Émulateurs locaux (tests) : activés automatiquement avec ?emulator dans l'URL.
  useEmulators: typeof location !== "undefined" && new URLSearchParams(location.search).has("emulator"),
  emulatorHost: "127.0.0.1",

  // Version du SDK Firebase chargé depuis le CDN officiel (gstatic).
  sdkVersion: "13.3.0",
};
