/* =========================================================
   NOYAU FIREBASE PARTAGÉ — Sun Pilot · Neon Skies
   ---------------------------------------------------------
   Une initialisation par pilote local (identité + classement) :
   App, App Check, Auth anonyme, Firestore.
   ========================================================= */
import { FIREBASE_CONFIG, LB_OPTIONS } from "./firebase-config.js";
import { getActiveId } from "./profiles.js";

const CDN = `https://www.gstatic.com/firebasejs/${LB_OPTIONS.sdkVersion}`;
export const EMU = !!LB_OPTIONS.useEmulators;
const CONFIG = EMU ? { apiKey: "demo-key", projectId: "demo-sunpilot", appId: "demo" } : FIREBASE_CONFIG;
export const CONFIGURED = EMU || (!!CONFIG.apiKey && !/^VOTRE/.test(CONFIG.apiKey));

const ready = new Map();   // une connexion par pilote local

/**
 * Initialise (une seule fois par pilote) et renvoie { app, auth, user, db, fs }.
 * Pilote "p0" = application Firebase par défaut ; les autres pilotes du même
 * appareil ont chacun leur application nommée, donc leur propre compte anonyme
 * (UID distinct, conservé par le navigateur d'une visite à l'autre).
 */
export function getFirebase(profileId = getActiveId()) {
  if (!CONFIGURED) return Promise.reject(Object.assign(new Error("Firebase non configuré"), { code: "not-configured" }));
  if (ready.has(profileId)) return ready.get(profileId);
  const p = (async () => {
    const [appMod, authMod, fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    const isMain = profileId === "p0";
    const name = isMain ? "[DEFAULT]" : `pilot-${profileId}`;
    const existing = appMod.getApps().find((a) => a.name === name);
    const app = existing || (isMain ? appMod.initializeApp(CONFIG) : appMod.initializeApp(CONFIG, name));

    // App Check (reCAPTCHA Fraud Defense) : prouve que les requêtes viennent du site officiel
    if (LB_OPTIONS.appCheckSiteKey && !EMU && !existing) {
      try {
        const ac = await import(`${CDN}/firebase-app-check.js`);
        ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(LB_OPTIONS.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      } catch (e) { console.warn("[Firebase] App Check :", e); }
    }

    const auth = authMod.getAuth(app);
    if (EMU && !existing) authMod.connectAuthEmulator(auth, `http://${LB_OPTIONS.emulatorHost}:9099`, { disableWarnings: true });
    const user = await new Promise((resolve, reject) => {
      const off = authMod.onAuthStateChanged(auth, (u) => {
        if (u) { off(); resolve(u); }
        else authMod.signInAnonymously(auth).catch((e) => { off(); reject(e); });
      });
    });

    // Pilote principal : cache local persistant (lectures réduites, hors ligne).
    // Pilotes supplémentaires : cache mémoire, plus léger.
    let db;
    try {
      db = fs.initializeFirestore(app, {
        localCache: isMain ? fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) : fs.memoryLocalCache(),
      });
      if (EMU) fs.connectFirestoreEmulator(db, LB_OPTIONS.emulatorHost, 8080);
    } catch (e) {
      db = fs.getFirestore(app);
    }
    return { app, auth, user, db, fs };
  })();
  ready.set(profileId, p);
  p.catch((e) => { console.warn("[Firebase] initialisation impossible :", e); ready.delete(profileId); });
  return p;
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
