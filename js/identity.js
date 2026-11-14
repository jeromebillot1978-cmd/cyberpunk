/* =========================================================
   IDENTITÉ DES PILOTES — pseudo obligatoire (Firebase)
   ---------------------------------------------------------
   • users/{uid}       : { uid, pseudo, createdAt, updatedAt }
   • pseudos/{pseudo}  : { uid }  (pseudo en minuscules → unicité garantie)
   Création et modification se font dans UNE transaction :
   si deux joueurs visent le même pseudo, un seul l'obtient.
   Plusieurs pilotes peuvent se partager l'appareil (js/profiles.js) :
   chacun a son propre compte Firebase et son propre pseudo.
   Tant que le pilote actif n'a pas de pseudo valide, le jeu reste bloqué.
   ========================================================= */
import { getFirebase, errorMessage } from "./firebase.js";
import { openModal, closeModal, isModalOpen } from "./modal.js";
import { getActiveId, setActiveId, getProfile, updateProfile, addProfile, removeProfile, profileKey, listProfiles, MAX_PROFILES } from "./profiles.js";

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 15;
export const PSEUDO_RE = /^[A-Za-z0-9_-]{3,15}$/;      // identique aux règles Firestore

/** Retire tout caractère interdit (espaces, accents, emoji, HTML…) et coupe à 15. */
export function cleanPseudo(raw) {
  return String(raw || "").normalize("NFKC").replace(/[^A-Za-z0-9_-]/g, "").slice(0, PSEUDO_MAX);
}

/* ---------- État ---------- */
let pseudo = null;              // pseudo du pilote actif
let mode = "create";            // "create" (obligatoire) | "new" (pilote supplémentaire) | "edit"
let busy = false;
let pending = null;             // { onDone, onCancel, previousId } pour l'ajout d'un pilote
const listeners = new Set();

const $ = (id) => document.getElementById(id);
const cache = {
  get(id) { try { return JSON.parse(localStorage.getItem(profileKey("sp_identity", id))) || null; } catch (e) { return null; } },
  set(id, v) { try { localStorage.setItem(profileKey("sp_identity", id), JSON.stringify(v)); } catch (e) {} },
};

export const getPseudo = () => pseudo;
export const getActiveProfileId = getActiveId;
/** Abonnement aux changements de pilote ou de pseudo : fn(pseudo, profileId). */
export function onPseudoChange(fn) { listeners.add(fn); if (pseudo) fn(pseudo, getActiveId()); return () => listeners.delete(fn); }

/* ---------- Affichage du pseudo partout dans l'interface ---------- */
function setPseudo(p, uid, profileId = getActiveId()) {
  if (profileId !== getActiveId()) { updateProfile(profileId, { pseudo: p, ...(uid ? { uid } : {}) }); return; }
  pseudo = p;
  updateProfile(profileId, { pseudo: p, ...(uid ? { uid } : {}) });
  if (uid) cache.set(profileId, { uid, pseudo: p });
  document.querySelectorAll(".js-pseudo").forEach((el) => { el.textContent = p || ""; });
  document.querySelectorAll(".js-pilot").forEach((el) => el.classList.toggle("hidden", !p));
  setPlayEnabled(!!p);
  listeners.forEach((fn) => { try { fn(p, profileId); } catch (e) { console.warn(e); } });
  window.dispatchEvent(new CustomEvent("sunpilot:identity", { detail: { pseudo: p, profileId, uid: uid || getProfile(profileId)?.uid || null } }));
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
  $("idmCount").textContent = `${v.length}/${PSEUDO_MAX}`;
  $("idmRuleLen").classList.toggle("ok", v.length >= PSEUDO_MIN && v.length <= PSEUDO_MAX);
  $("idmRuleChars").classList.toggle("ok", v.length > 0 && PSEUDO_RE.test(v.padEnd(PSEUDO_MIN, "a")));
  const same = mode === "edit" && v === pseudo;
  $("idmSubmit").disabled = busy || !PSEUDO_RE.test(v) || same;
  return PSEUDO_RE.test(v);
}

const TEXTS = {
  create: { kicker: "BIENVENUE, PILOTE", title: "👤 CHOISIS TON IDENTITÉ",
    text: "Crée ton pseudo pour décoller. Il apparaîtra dans le jeu et dans les classements mondiaux." },
  new: { kicker: "NOUVEAU JOUEUR SUR CET APPAREIL", title: "👤 CHOISIS TON IDENTITÉ",
    text: "Chaque joueur a son propre pseudo, ses records et son rang mondial." },
  edit: { kicker: "PARAMÈTRES DU PILOTE", title: "✏ MODIFIER MON PSEUDO",
    text: "Ton nouveau pseudo remplacera l'ancien partout, classements mondiaux compris." },
};

export function openIdentity(m = "create", message = "") {
  mode = m;
  const win = $("idm");
  const mandatory = mode === "create";
  win.classList.toggle("mandatory", mandatory);
  $("idmClose").classList.toggle("hidden", mandatory);
  $("idmKicker").textContent = TEXTS[mode].kicker;
  $("idmTitle").textContent = TEXTS[mode].title;
  $("idmText").textContent = TEXTS[mode].text;
  $("idmInput").value = mode === "edit" ? (pseudo || "") : "";
  status(message, message ? "err" : "");
  busy = false;
  validate();
  openModal(win);
  setTimeout(() => $("idmInput").focus({ preventScroll: true }), 120);
}
export async function closeIdentity() {
  if (mode === "create") return;                 // fenêtre obligatoire : impossible de la fermer
  await closeModal($("idm"));
  if (mode === "new" && pending) {               // ajout annulé : on retire le profil vide
    const { previousId, onCancel, id } = pending; pending = null;
    removeProfile(id);
    await switchProfile(previousId);
    if (onCancel) onCancel();
  }
}
/** Appelé par le jeu quand on tente de jouer sans pseudo. */
export function requirePseudo() { if (!pseudo) openIdentity("create"); return !!pseudo; }

/* ---------- Enregistrement (transaction Firestore) ---------- */
class Taken extends Error { constructor() { super("taken"); this.code = "pseudo-taken"; } }

async function claimPseudo(p, profileId) {
  const { user, db, fs } = await getFirebase(profileId);
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
  const profileId = getActiveId();
  busy = true; validate(); status("⏳ Vérification de la disponibilité…");
  try {
    const r = await claimPseudo(p, profileId);
    setPseudo(p, r.uid, profileId);
    status("✅ Pseudo enregistré", "ok");
    busy = false; validate();
    const done = pending && pending.onDone; pending = null;
    setTimeout(async () => { await closeModal($("idm")); if (done) done(); }, 900);
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

/* ---------- Chargement / changement de pilote ---------- */
async function verify(profileId) {
  const cached = cache.get(profileId) || (getProfile(profileId)?.pseudo ? { pseudo: getProfile(profileId).pseudo } : null);
  try {
    const { user, db, fs } = await getFirebase(profileId);
    const snap = await fs.getDoc(fs.doc(db, "users", user.uid));
    if (profileId !== getActiveId()) return;
    const p = snap.exists() ? snap.data().pseudo : null;
    if (p && PSEUDO_RE.test(p)) setPseudo(p, user.uid, profileId);
    else { cache.set(profileId, null); updateProfile(profileId, { pseudo: null, uid: user.uid }); pseudo = null; setPlayEnabled(false); openIdentity("create"); }
  } catch (err) {
    console.warn("[Identité] lecture du profil impossible :", err);
    if (profileId !== getActiveId()) return;
    // Hors ligne : on accepte uniquement un pseudo déjà validé par le serveur sur cet appareil
    if (cached && cached.pseudo && PSEUDO_RE.test(cached.pseudo)) setPseudo(cached.pseudo, null, profileId);
    else { setPlayEnabled(false); openIdentity("create", errorMessage(err)); }
  }
}

/** Active un pilote : son pseudo s'affiche tout de suite, puis il est vérifié auprès de Firebase. */
export async function switchProfile(id) {
  setActiveId(id);
  const prof = getProfile(id);
  if (prof && prof.pseudo) setPseudo(prof.pseudo, null, id);
  else { pseudo = null; setPlayEnabled(false, "⏳ CONNEXION…"); }
  await verify(id);
}

/** Ajoute un pilote sur cet appareil : nouveau compte Firebase + choix du pseudo. */
export async function addPlayer({ onDone, onCancel } = {}) {
  const previousId = getActiveId();
  const id = addProfile();
  if (!id) return { ok: false, msg: `Maximum ${MAX_PROFILES} joueurs sur cet appareil.` };
  pending = { id, previousId, onDone, onCancel };
  setActiveId(id);
  pseudo = null;
  setPlayEnabled(false);
  openIdentity("new");
  getFirebase(id).then(({ user }) => updateProfile(id, { uid: user.uid })).catch((e) => status("❌ " + errorMessage(e), "err"));
  return { ok: true };
}

/** Retire un pilote de cet appareil (son pseudo et ses scores en ligne sont conservés). */
export async function removePlayer(id) {
  const wasActive = id === getActiveId();
  if (!removeProfile(id)) return false;
  if (wasActive) await switchProfile(getActiveId());
  return true;
}

/* ---------- Événements ---------- */
$("idmForm").addEventListener("submit", submit);
$("idmInput").addEventListener("input", () => { validate(); if (!busy) status(""); });
$("idmClose").addEventListener("click", closeIdentity);
$("idm").addEventListener("click", (e) => { if (e.target.closest("[data-close]") && mode !== "create") closeIdentity(); });
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

export const Identity = { getPseudo, getActiveProfileId, onPseudoChange, openIdentity, closeIdentity, requirePseudo, cleanPseudo, switchProfile, addPlayer, removePlayer, listProfiles };
window.SunPilotIdentity = Identity;

// Nettoyage : un pilote ajouté puis abandonné avant d'avoir choisi son pseudo est retiré
for (const p of listProfiles()) if (!p.pseudo && p.id !== "p0" && listProfiles().length > 1) removeProfile(p.id);
switchProfile(getActiveId());
