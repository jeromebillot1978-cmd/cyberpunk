/* =========================================================
   Accès administrateur Firebase (serveur uniquement)
   Variable d'environnement Vercel : FIREBASE_SERVICE_ACCOUNT
   = contenu complet du fichier JSON du compte de service
   (Console Firebase → ⚙ Paramètres → Comptes de service →
   Générer une nouvelle clé privée). Jamais côté navigateur.
   ========================================================= */
// firebase-admin est chargé au premier appel : une erreur de chargement devient un message clair
let mods = null;
async function load() {
  if (mods) return mods;
  const [app, auth, fs] = await Promise.all([import("firebase-admin/app"), import("firebase-admin/auth"), import("firebase-admin/firestore")]);
  mods = { ...app, ...auth, ...fs };
  return mods;
}

let cached = null;

export async function admin() {
  if (cached) return cached;
  let m;
  try { m = await load(); } catch (e) { lastError = "firebase-admin introuvable : " + (e.message || e); console.error("[ORION]", e); return null; }
  const { initializeApp, cert, getApps, getAuth, getFirestore, FieldValue, Timestamp } = m;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  // Tests locaux : émulateurs Firebase, aucun compte de service nécessaire
  if (!raw && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const app = getApps()[0] || initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-sunpilot" });
    cached = { auth: getAuth(app), db: getFirestore(app), FieldValue, Timestamp };
    return cached;
  }
  if (!raw) return null;
  let sa;
  try {
    const text = raw.trim().replace(/^['"]|['"]$/g, "");          // guillemets ajoutés par erreur autour du JSON
    sa = JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  } catch (e) {
    lastError = "FIREBASE_SERVICE_ACCOUNT illisible : il faut coller tout le contenu du fichier JSON, de { à }";
    console.error("[ORION]", lastError);
    return null;
  }
  if (!sa.private_key || !sa.client_email || !sa.project_id) {
    lastError = "FIREBASE_SERVICE_ACCOUNT incomplet : private_key, client_email ou project_id manquant";
    console.error("[ORION]", lastError);
    return null;
  }
  try {
    const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.project_id });
    cached = { auth: getAuth(app), db: getFirestore(app), FieldValue, Timestamp };
    return cached;
  } catch (e) {
    lastError = "Compte de service refusé : " + (e.message || e);
    console.error("[ORION]", lastError);
    return null;
  }
}

let lastError = "FIREBASE_SERVICE_ACCOUNT manquant";
/** Raison pour laquelle ORION n'est pas configuré (sans aucune donnée secrète). */
export function adminError() {
  return lastError.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[clé masquée]").slice(0, 200);
}
