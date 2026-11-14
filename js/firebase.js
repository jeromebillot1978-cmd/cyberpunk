/* =========================================================
   NOYAU FIREBASE PARTAGÉ — Sun Pilot · Neon Skies
   ---------------------------------------------------------
   Une seule initialisation pour tout le jeu (identité +
   classement) : App, App Check, Auth anonyme, Firestore.
   ========================================================= */
import { FIREBASE_CONFIG, LB_OPTIONS } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${LB_OPTIONS.sdkVersion}`;
export const EMU = !!LB_OPTIONS.useEmulators;
const CONFIG = EMU ? { apiKey: "demo-key", projectId: "demo-sunpilot", appId: "demo" } : FIREBASE_CONFIG;
export const CONFIGURED = EMU || (!!CONFIG.apiKey && !/^VOTRE/.test(CONFIG.apiKey));

let readyP = null;

/**
 * Initialise Firebase une seule fois et renvoie { app, auth, user, db, fs }.
 * L'UID anonyme est conservé par le navigateur : le joueur garde son identité
 * d'une visite à l'autre.
 */
export function getFirebase() {
  if (!CONFIGURED) return Promise.reject(Object.assign(new Error("Firebase non configuré"), { code: "not-configured" }));
  if (readyP) return readyP;
  readyP = (async () => {
    const [appMod, authMod, fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(CONFIG);

    // App Check (reCAPTCHA Fraud Defense) : prouve que les requêtes viennent du site officiel
    if (LB_OPTIONS.appCheckSiteKey && !EMU) {
      const ac = await import(`${CDN}/firebase-app-check.js`);
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(LB_OPTIONS.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }

    const auth = authMod.getAuth(app);
    if (EMU) authMod.connectAuthEmulator(auth, `http://${LB_OPTIONS.emulatorHost}:9099`, { disableWarnings: true });
    const user = await new Promise((resolve, reject) => {
      const off = authMod.onAuthStateChanged(auth, (u) => {
        if (u) { off(); resolve(u); }
        else authMod.signInAnonymously(auth).catch((e) => { off(); reject(e); });
      });
    });

    // Cache local persistant : lectures réduites, affichage instantané, tolérance hors ligne
    let db;
    try {
      db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) {
      db = fs.getFirestore(app);
    }
    if (EMU) fs.connectFirestoreEmulator(db, LB_OPTIONS.emulatorHost, 8080);
    return { app, auth, user, db, fs };
  })();
  readyP.catch((e) => { console.warn("[Firebase] initialisation impossible :", e); readyP = null; });
  return readyP;
}

/** Traduit une erreur Firebase en message clair pour le joueur. */
export function errorMessage(e) {
  const code = (e && e.code) || "";
  if (code === "not-configured") return "Classement en ligne non configuré.";
  if (/network|unavailable|deadline-exceeded|failed-precondition/.test(code) || (e && /Failed to fetch|import/i.test(e.message || "")))
    return "Connexion au serveur impossible. Vérifie ta connexion Internet puis réessaie.";
  if (code === "permission-denied") return "Action refusée par le serveur. Réessaie dans quelques secondes.";
  if (code === "resource-exhausted") return "Serveur très sollicité, réessaie dans un instant.";
  if (code === "auth/admin-restricted-operation" || code === "auth/operation-not-allowed") return "La connexion des joueurs est désactivée sur le serveur.";
  if (code.startsWith("auth/")) return "Connexion du joueur impossible pour le moment. Réessaie.";
  return "Une erreur est survenue. Réessaie dans un instant.";
}
