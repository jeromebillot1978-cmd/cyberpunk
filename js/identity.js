/* =========================================================
   IDENTITÉ DU PILOTE — pseudo obligatoire (Firebase)
   ---------------------------------------------------------
   • users/{uid}       : { uid, pseudo, createdAt, updatedAt }
   • pseudos/{pseudo}  : { uid }  (pseudo en minuscules → unicité garantie)
   Création et modification se font dans UNE transaction :
   si deux joueurs visent le même pseudo, un seul l'obtient.
   Tant qu'aucun pseudo valide n'existe, le jeu reste bloqué.
   ========================================================= */
import { getFirebase, errorMessage } from "./firebase.js";
import { openModal, closeModal, isModalOpen } from "./modal.js";

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 15;
export const PSEUDO_RE = /^[A-Za-z0-9_-]{3,15}$/;      // identique aux règles Firestore
const CACHE_KEY = "sp_identity";

/** Retire tout caractère interdit (espaces, accents, emoji, HTML…) et coupe à 15. */
export function cleanPseudo(raw) {
  return String(raw || "").normalize("NFKC").replace(/[^A-Za-z0-9_-]/g, "").slice(0, PSEUDO_MAX);
}

/* ---------- État ---------- */
let pseudo = null;
let mode = "create";            // "create" (obligatoire) | "edit" (depuis les paramètres)
let busy = false;
const listeners = new Set();

const $ = (id) => document.getElementById(id);
const cache = {
  get() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (e) {} },
};

export const getPseudo = () => pseudo;
/** Abonnement aux changements de pseudo (appelé tout de suite si un pseudo existe déjà). */
export function onPseudoChange(fn) { listeners.add(fn); if (pseudo) fn(pseudo); return () => listeners.delete(fn); }

/* ---------- Affichage du pseudo partout dans l'interface ---------- */
function setPseudo(p, uid) {
  pseudo = p;
  if (uid) cache.set({ uid, pseudo: p });
  document.querySelectorAll(".js-pseudo").forEach((el) => { el.textContent = p; });
  document.querySelectorAll(".js-pilot").forEach((el) => el.classList.toggle("hidden", !p));
  setPlayEnabled(!!p);
  listeners.forEach((fn) => { try { fn(p); } catch (e) { console.warn(e); } });
  window.dispatchEvent(new CustomEvent("sunpilot:identity", { detail: { pseudo: p } }));
}
function setPlayEnabled(on, label) {
  const b = $("btnPlay"); if (!b) return;
  b.disabled = !on;
  b.textContent = on ? "▶ JOUER" : (label || "👤 PSEUDO REQUIS");
}

/* ---------- Fenêtre ---------- */
function status(text, kind = "") {
  const s = $("idmStatus"); s.textContent = text; s.className = "idm-status" + (kind ? " " + kind : "");
}
function validate() {
  const input = $("idmInput");
  const cleaned = cleanPseudo(input.value);
  if (cleaned !== input.value) {                   // nettoyage automatique de la saisie
    const pos = Math.max(0, (input.selectionStart || cleaned.length) - (input.value.length - cleaned.length));
    input.value = cleaned;
    try { input.setSelectionRange(pos, pos); } catch (e) {}
  }
  const v = input.value;
  const lenOk = v.length >= PSEUDO_MIN && v.length <= PSEUDO_MAX;
  $("idmCount").textContent = `${v.length}/${PSEUDO_MAX}`;
  $("idmRuleLen").classList.toggle("ok", lenOk);
  $("idmRuleChars").classList.toggle("ok", v.length > 0 && PSEUDO_RE.test(v.padEnd(PSEUDO_MIN, "a")));
  const same = mode === "edit" && v === pseudo;
  $("idmSubmit").disabled = busy || !PSEUDO_RE.test(v) || same;
  return PSEUDO_RE.test(v);
}

export function openIdentity(m = "create", message = "") {
  mode = m;
  const win = $("idm");
  const mandatory = mode === "create";
  win.classList.toggle("mandatory", mandatory);
  $("idmClose").classList.toggle("hidden", mandatory);
  $("idmKicker").textContent = mandatory ? "BIENVENUE, PILOTE" : "PARAMÈTRES DU PILOTE";
  $("idmTitle").textContent = mandatory ? "👤 CHOISIS TON IDENTITÉ" : "✏ MODIFIER MON PSEUDO";
  $("idmText").textContent = mandatory
    ? "Crée ton pseudo pour décoller. Il apparaîtra dans le jeu et dans les classements mondiaux."
    : "Ton nouveau pseudo remplacera l'ancien partout, classements mondiaux compris.";
  $("idmInput").value = mandatory ? "" : (pseudo || "");
  status(message, message ? "err" : "");
  validate();
  openModal(win);
  setTimeout(() => $("idmInput").focus({ preventScroll: true }), 120);
}
export async function closeIdentity() {
  if (mode === "create" && !pseudo) return;     // fenêtre obligatoire : impossible de la fermer
  await closeModal($("idm"));
}
/** Appelé par le jeu quand on tente de jouer sans pseudo. */
export function requirePseudo() { if (!pseudo) openIdentity("create"); return !!pseudo; }

/* ---------- Enregistrement (transaction Firestore) ---------- */
class Taken extends Error { constructor() { super("taken"); this.code = "pseudo-taken"; } }

async function claimPseudo(p) {
  const { user, db, fs } = await getFirebase();
  const uid = user.uid;
  const lower = p.toLowerCase();
  const userRef = fs.doc(db, "users", uid);
  const nameRef = fs.doc(db, "pseudos", lower);
  return fs.runTransaction(db, async (tx) => {
    const [us, ns] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
    if (ns.exists() && ns.data().uid !== uid) throw new Taken();
    const old = us.exists() ? us.data().pseudo : null;
    if (old === p) return { uid, changed: false };
    const now = fs.serverTimestamp();
    if (us.exists()) {
      if (old && old.toLowerCase() !== lower) tx.delete(fs.doc(db, "pseudos", old.toLowerCase()));
      tx.update(userRef, { pseudo: p, updatedAt: now });
    } else {
      tx.set(userRef, { uid, pseudo: p, createdAt: now, updatedAt: now });
    }
    if (!ns.exists()) tx.set(nameRef, { uid });
    return { uid, changed: true };
  });
}

async function submit(e) {
  e.preventDefault();
  if (busy || !validate()) return;
  const p = $("idmInput").value;
  busy = true; validate(); status("⏳ Vérification de la disponibilité…");
  try {
    const r = await claimPseudo(p);
    setPseudo(p, r.uid);
    status("✅ Pseudo enregistré", "ok");
    busy = false; validate();
    setTimeout(() => closeModal($("idm")), 900);
  } catch (err) {
    busy = false;
    if (err.code === "pseudo-taken") status("❌ Ce pseudo est déjà utilisé", "err");
    else if (err.code === "permission-denied" && mode === "edit") status("⏳ Tu as changé de pseudo il y a moins de 10 secondes. Réessaie dans un instant.", "err");
    else if (err.code === "permission-denied") status("❌ Ce pseudo est déjà utilisé ou refusé. Essaie-en un autre.", "err");
    else status("❌ " + errorMessage(err), "err");
    console.warn("[Identité] enregistrement impossible :", err);
    validate();
  }
}

/* ---------- Chargement : le joueur a-t-il déjà un pseudo ? ---------- */
async function load() {
  setPlayEnabled(false, "⏳ CONNEXION…");
  const cached = cache.get();
  try {
    const { user, db, fs } = await getFirebase();
    const snap = await fs.getDoc(fs.doc(db, "users", user.uid));
    const p = snap.exists() ? snap.data().pseudo : null;
    if (p && PSEUDO_RE.test(p)) setPseudo(p, user.uid);
    else { cache.set(null); setPlayEnabled(false); openIdentity("create"); }
  } catch (err) {
    console.warn("[Identité] lecture du profil impossible :", err);
    // Hors ligne : on accepte uniquement un pseudo déjà validé par le serveur sur cet appareil
    if (cached && cached.pseudo && PSEUDO_RE.test(cached.pseudo)) setPseudo(cached.pseudo);
    else { setPlayEnabled(false); openIdentity("create", errorMessage(err)); }
  }
}

/* ---------- Événements ---------- */
$("idmForm").addEventListener("submit", submit);
$("idmInput").addEventListener("input", () => { validate(); if (!busy) status(""); });
$("idmClose").addEventListener("click", closeIdentity);
$("idm").addEventListener("click", (e) => { if (e.target.closest("[data-close]") && mode === "edit") closeIdentity(); });
window.addEventListener("keydown", (e) => {
  if (!isModalOpen($("idm"))) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeIdentity(); }
}, true);
// Mode obligatoire : aucun geste ne doit atteindre le jeu (tactile et clavier)
["pointerdown", "touchstart"].forEach((t) => window.addEventListener(t, (e) => {
  if (isModalOpen($("idm")) && !e.target.closest("#idm .modal-win")) e.stopImmediatePropagation();
}, { capture: true, passive: true }));
const editBtn = $("btnEditPseudo");
if (editBtn) editBtn.addEventListener("click", () => openIdentity("edit"));

export const Identity = { getPseudo, onPseudoChange, openIdentity, closeIdentity, requirePseudo, cleanPseudo };
window.SunPilotIdentity = Identity;
load();
