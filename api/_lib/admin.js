/* =========================================================
   Accès administrateur Firebase (serveur uniquement)
   Variable d'environnement Vercel : FIREBASE_SERVICE_ACCOUNT
   = contenu complet du fichier JSON du compte de service
   (Console Firebase → ⚙ Paramètres → Comptes de service →
   Générer une nouvelle clé privée). Jamais côté navigateur.
   ========================================================= */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

let cached = null;

export function admin() {
  if (cached) return cached;
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
    sa = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  } catch (e) {
    console.error("[ORION] FIREBASE_SERVICE_ACCOUNT illisible");
    return null;
  }
  const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.project_id });
  cached = { auth: getAuth(app), db: getFirestore(app), FieldValue, Timestamp };
  return cached;
}
