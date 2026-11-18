/* =========================================================
   FILTRE DU CANAL DES PILOTES — partagé par le jeu (js/chat.js)
   et par le serveur d'ORION (api/orion.js)
   ---------------------------------------------------------
   Les règles Firestore appliquent la même liste de mots et
   de liens : un message refusé ici le serait aussi par le
   serveur. Le filtre local va plus loin (accents, chiffres
   à la place des lettres, lettres répétées) pour bloquer
   les contournements avant l'envoi.
   ========================================================= */
export const TEXT_MAX = 280;

// Liste identique à validText() dans firestore.rules
export const BANNED = [
  "connard", "connards", "connasse", "salope", "salopes", "pute", "putes", "encule", "enculé", "enculer",
  "ntm", "nique ta", "niquer ta", "fdp", "fils de pute", "batard", "bâtard", "pédé", "pd", "tapette",
  "negro", "négro", "bougnoul", "youpin", "bicot", "sale noir", "sale arabe", "sale juif", "heil hitler",
  "suce ma", "suce moi",
];

const LINK_RE = /(https?:\/\/|www\.|discord\.gg|bit\.ly|t\.me\/|\.(com|net|org|io|gg|xyz|ru|tk|ly)\/)/i;
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BANNED_RE = new RegExp(`(^|[^a-z0-9_])(${BANNED.map(esc).join("|")})(?=$|[^a-z0-9_])`, "i");

// Version « sans accents, sans chiffres déguisés, sans lettres répétées » pour les contournements
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "€": "e" };
const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const BANNED_PLAIN_RE = new RegExp(
  `(^|[^a-z])(${[...new Set(BANNED.map((w) => plain(w)))].map(esc).join("|")})(?=$|[^a-z])`, "i");
function unmask(s) {
  return plain(s.toLowerCase())
    .replace(/[013457@$€]/g, (c) => LEET[c] || c)
    .replace(/([a-z])\1{2,}/g, "$1$1")        // « connnnard » → « connard »
    .replace(/(?<=\b[a-z])[\s.\-_*]+(?=[a-z]\b)/g, ""); // « f.d.p », « f d p » → « fdp »
}

/** Nettoie la saisie : espaces superflus retirés, retours à la ligne et caractères de contrôle supprimés. */
export function cleanText(raw) {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[​-‏‪-‮⁦-⁩]/g, "")   // caractères invisibles et inversions de sens
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Vérifie un message avant l'envoi.
 * Renvoie { ok: true, text } ou { ok: false, reason: "empty" | "long" | "link" | "banned" | "flood", message }.
 */
export function checkMessage(raw) {
  const text = cleanText(raw);
  if (!text) return { ok: false, reason: "empty", message: "Écris un message avant d'envoyer." };
  if ([...text].length > TEXT_MAX || text.length > TEXT_MAX) return { ok: false, reason: "long", message: `${TEXT_MAX} caractères maximum.` };
  if (LINK_RE.test(text)) return { ok: false, reason: "link", message: "Les liens ne sont pas autorisés dans le canal." };
  if (BANNED_RE.test(text) || BANNED_PLAIN_RE.test(unmask(text)))
    return { ok: false, reason: "banned", message: "Message bloqué : langage interdit dans le canal." };
  const letters = text.replace(/[^\p{L}]/gu, "");
  const caps = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (/(.)\1{9,}/u.test(text) || (letters.length >= 15 && caps / letters.length > 0.8))
    return { ok: false, reason: "flood", message: "Message bloqué : évite les majuscules et les répétitions." };
  return { ok: true, text };
}

/** Le texte respecte-t-il les règles du serveur ? (utilisé pour les réponses d'ORION) */
export function isAllowed(text) {
  return checkMessage(text).ok;
}
