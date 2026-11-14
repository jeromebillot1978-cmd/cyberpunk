/* =========================================================
   CLASSEMENT MONDIAL FIREBASE — Sun Pilot · Neon Skies
   ---------------------------------------------------------
   • 1 document par joueur ET par mode : scores/{uid}_{mode}
     → aucun doublon possible, seul le meilleur score est gardé
   • Le pseudo affiché est celui du profil (users/{uid}),
     vérifié par les règles Firestore
   • Top 10 en temps réel par difficulté (écoute active
     uniquement quand la fenêtre est ouverte)
   • Rang mondial via une requête d'agrégation count()
   • Optimisé coûts : cache local persistant, aucune lecture
     avant écriture (record en ligne mémorisé), écriture
     uniquement si le record est battu.
   ========================================================= */
import { getFirebase, CONFIGURED, errorMessage } from "./firebase.js";
import { getPseudo, onPseudoChange, openIdentity } from "./identity.js";
import { openModal, closeModal, isModalOpen } from "./modal.js";

const COLL = "scores";
const TOP_N = 10;
const RANK_LIMIT = 1000;              // au-delà : « #1000+ » (coût max : 1 lecture)
const RANK_TTL = 5 * 60 * 1000;       // rang mis en cache 5 min
const MIN_WRITE_GAP = 11000;          // les règles imposent 10 s entre deux records

const SP = window.SunPilot;

/* ---------- Stockage local (protégé contre les navigateurs restrictifs) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const session = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

/* ---------- État ---------- */
let onlineBests = store.get("sp_online_best", {});   // meilleur score EN LIGNE par mode
let myUid = null;
let unsub = null, currentTab = null;
const lastRows = {};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modeInfo = (id) => SP.DIFFICULTIES[id] || SP.DIFF_LIST[0];
const isOpen = () => isModalOpen($("lb"));

async function fb() {
  const f = await getFirebase();
  myUid = f.user.uid;
  return f;
}

/* =========================================================
   ENREGISTREMENT DU SCORE (fin de partie)
   ========================================================= */
async function submitScore({ score, mode, bitcoins, distance, level }) {
  if (!CONFIGURED) return { status: "disabled" };
  score = Math.floor(score); if (!(score > 0)) return { status: "zero" };
  if (!SP.DIFFICULTIES[mode]) return { status: "error" };
  const pseudo = getPseudo();
  if (!pseudo) return { status: "noPseudo" };
  const { user, db, fs } = await fb();
  const ref = fs.doc(db, COLL, `${user.uid}_${mode}`);

  // Record en ligne inconnu (1re fois sur ce mode) → 1 seule lecture, ensuite tout est en cache
  if (onlineBests[mode] === undefined) {
    try { const snap = await fs.getDoc(ref); onlineBests[mode] = snap.exists() ? snap.data().score : 0; }
    catch (e) { onlineBests[mode] = 0; }
    store.set("sp_online_best", onlineBests);
  }
  if (score <= onlineBests[mode]) return { status: "notBetter", best: onlineBests[mode] };

  // Anti-spam des règles : 10 s minimum entre deux records sur le même mode
  const lastW = store.get("sp_last_write", {});
  const wait = (lastW[mode] || 0) + MIN_WRITE_GAP - Date.now();
  if (wait > 0) await sleep(wait);

  const payload = {
    uid: user.uid, pseudo, score, mode,
    bitcoins: Math.max(0, Math.floor(bitcoins)),
    distance: Math.max(0, Math.floor(distance)),
    level: Math.max(1, Math.floor(level)),
    createdAt: fs.serverTimestamp(),
  };
  try {
    const write = fs.setDoc(ref, payload);
    const res = await Promise.race([write.then(() => "ok"), sleep(8000).then(() => "pending")]);
    lastW[mode] = Date.now(); store.set("sp_last_write", lastW);
    onlineBests[mode] = score; store.set("sp_online_best", onlineBests);
    const written = store.get("sp_scores_pseudo", {}); written[mode] = pseudo; store.set("sp_scores_pseudo", written);
    session.set("sp_rank_" + mode, null);
    if (res === "pending") return { status: "pending" };
    let rank = null;   // un échec du calcul du rang ne doit pas masquer l'enregistrement
    try { rank = await getRank(mode, score, true); } catch (e) { console.warn("[Classement] rang indisponible :", e); }
    return { status: "ok", best: score, rank };
  } catch (e) {
    console.warn("[Classement] écriture refusée :", e);
    if (e && e.code === "permission-denied") {
      try { const snap = await fs.getDoc(ref); if (snap.exists()) { onlineBests[mode] = snap.data().score; store.set("sp_online_best", onlineBests); } } catch (_) {}
    }
    return { status: "error", message: errorMessage(e) };
  }
}

/* =========================================================
   RANG MONDIAL : count() des scores strictement supérieurs
   ========================================================= */
async function getRank(mode, score, force = false) {
  if (!score) return null;
  const key = "sp_rank_" + mode;
  const c = session.get(key, null);
  if (!force && c && c.score === score && Date.now() - c.t < RANK_TTL) return c.rank;
  const { db, fs } = await fb();
  const q = fs.query(fs.collection(db, COLL), fs.where("mode", "==", mode), fs.where("score", ">", score), fs.orderBy("score", "desc"), fs.limit(RANK_LIMIT));
  const n = (await fs.getCountFromServer(q)).data().count;
  const rank = { pos: n + 1, capped: n >= RANK_LIMIT };
  session.set(key, { score, rank, t: Date.now() });
  return rank;
}
const rankText = (r) => (r ? (r.capped ? `#${RANK_LIMIT}+` : `#${fmt(r.pos)}`) : "—");

/* =========================================================
   PSEUDO : propagation automatique vers les records existants
   ========================================================= */
// Le pseudo écrit dans chaque score est mémorisé par mode : aucune lecture ni écriture inutile au chargement
async function syncPseudoToScores(pseudo) {
  if (!CONFIGURED || !pseudo) return;
  const written = store.get("sp_scores_pseudo", {});
  const modes = Object.keys(onlineBests).filter((m) => onlineBests[m] > 0 && written[m] !== pseudo);
  if (!modes.length) return;
  try {
    const { user, db, fs } = await fb();
    await Promise.all(modes.map((m) =>
      fs.updateDoc(fs.doc(db, COLL, `${user.uid}_${m}`), { pseudo, createdAt: fs.serverTimestamp() })
        .then(() => { written[m] = pseudo; })
        .catch((e) => {
          // déjà à jour (refus "pseudo identique") ou record absent : rien à refaire au prochain chargement
          if (e.code === "permission-denied" || e.code === "not-found") written[m] = pseudo;
          else console.warn("[Classement] pseudo non propagé sur", m, e.code || e);
        })));
    store.set("sp_scores_pseudo", written);
  } catch (e) { console.warn("[Classement] propagation du pseudo impossible :", e); }
}
onPseudoChange((p) => {
  syncPseudoToScores(p);
  if (isOpen()) renderMe(currentTab);
});

/* =========================================================
   INTERFACE : fenêtre du classement
   ========================================================= */
function setLive(text, cls) {
  const el = $("lbLive"); if (!el) return;
  el.classList.remove("on", "off"); if (cls) el.classList.add(cls);
  $("lbLiveTxt").textContent = text;
}
function buildTabs() {
  const box = $("lbTabs"); box.innerHTML = "";
  for (const d of SP.DIFF_LIST) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lb-tab"; b.dataset.mode = d.id; b.setAttribute("role", "tab");
    b.style.setProperty("--c", d.color);
    b.textContent = `${d.emoji} ${d.short || d.label}`;
    b.addEventListener("click", () => selectTab(d.id));
    box.appendChild(b);
  }
}
function skeleton() {
  const ol = $("lbList"); ol.innerHTML = "";
  for (let i = 0; i < 5; i++) { const li = document.createElement("li"); li.className = "lb-row skel"; ol.appendChild(li); }
}
// Construction en DOM (textContent) : aucune injection HTML possible via les pseudos
function renderRows(mode, rows) {
  const ol = $("lbList"); ol.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li"); li.className = "lb-empty";
    li.textContent = `Aucun score pour l'instant en ${modeInfo(mode).label}. Sois le premier pilote du classement ! 🚀`;
    ol.appendChild(li); return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  rows.forEach((r, i) => {
    const me = myUid && r.uid === myUid;
    const li = document.createElement("li");
    li.className = "lb-row" + (i < 3 ? ` r${i + 1}` : "") + (me ? " me" : "");
    li.style.animationDelay = `${i * 35}ms`;
    const rk = document.createElement("span"); rk.className = "lb-rank"; rk.textContent = i < 3 ? medals[i] : `#${i + 1}`;
    const who = document.createElement("span"); who.className = "lb-who";
    const nm = document.createElement("span"); nm.className = "lb-name"; nm.textContent = `👤 ${r.pseudo || "Pilote"}`;
    if (me) { const em = document.createElement("em"); em.textContent = "TOI"; nm.appendChild(em); }
    const st = document.createElement("span"); st.className = "lb-stats";
    st.textContent = `₿ ${fmt(r.bitcoins)} · ${fmt(r.distance)} m · niv. ${fmt(r.level)}`;
    who.append(nm, st);
    const sc = document.createElement("span"); sc.className = "lb-score"; sc.textContent = fmt(r.score);
    li.append(rk, who, sc);
    ol.appendChild(li);
  });
}
async function renderMe(mode) {
  const box = $("lbMe");
  const d = modeInfo(mode);
  const local = SP.getLocalBests()[mode] || 0;
  const online = onlineBests[mode] || 0;
  const line = (label, value) => { box.append(label); const b = document.createElement("b"); b.textContent = value; box.append(b); };
  box.innerHTML = "";
  if (!CONFIGURED) { line(`🌍 Classement non configuré. Ton record local en ${d.label} : `, fmt(local)); return; }
  if (!online) {
    box.textContent = local
      ? `🌍 Bats ton record local en ${d.label} (${fmt(local)}) pour entrer dans le classement mondial !`
      : `🌍 Joue une partie en ${d.label} pour entrer dans le classement mondial.`;
    return;
  }
  const rows = lastRows[mode] || [];
  const idx = myUid ? rows.findIndex((r) => r.uid === myUid) : -1;
  let rank = idx >= 0 ? { pos: idx + 1, capped: false } : null;
  const paint = () => { box.innerHTML = ""; line("🏆 TON RANG MONDIAL : ", rankText(rank)); box.append(` · RECORD EN LIGNE ${fmt(online)}`); };
  paint();
  if (!rank) { try { rank = await getRank(mode, online); if (currentTab === mode) paint(); } catch (e) {} }
}

function selectTab(mode) {
  currentTab = mode;
  document.querySelectorAll(".lb-tab").forEach((t) => {
    const on = t.dataset.mode === mode; t.classList.toggle("on", on); t.setAttribute("aria-selected", on);
  });
  $("lbTitle").textContent = `🏆 TOP ${TOP_N} ${modeInfo(mode).label}`;
  const cached = session.get("sp_top_" + mode, null);   // affichage instantané, puis temps réel
  if (cached) { lastRows[mode] = cached; renderRows(mode, cached); } else skeleton();
  renderMe(mode);
  listen(mode);
}

// Une seule écoute active à la fois (celle de l'onglet affiché) → lectures minimales
function stopListening() { if (unsub) { unsub(); unsub = null; } }
async function listen(mode) {
  stopListening();
  if (!CONFIGURED) { renderRows(mode, []); setLive("NON CONFIGURÉ", "off"); return; }
  setLive("CONNEXION…", "");
  let f;
  try { f = await fb(); } catch (e) { setLive("HORS LIGNE", "off"); if (!lastRows[mode]) renderRows(mode, []); return; }
  if (!isOpen() || currentTab !== mode) return;
  const { db, fs } = f;
  const q = fs.query(fs.collection(db, COLL), fs.where("mode", "==", mode), fs.orderBy("score", "desc"), fs.limit(TOP_N));
  unsub = fs.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const rows = snap.docs.map((d) => d.data());
    lastRows[mode] = rows; session.set("sp_top_" + mode, rows);
    if (currentTab !== mode) return;
    renderRows(mode, rows);
    setLive(snap.metadata.fromCache ? "CACHE · SYNCHRONISATION…" : "EN DIRECT", snap.metadata.fromCache ? "" : "on");
    renderMe(mode);
  }, (err) => { console.warn("[Classement] écoute impossible :", err); setLive("HORS LIGNE", "off"); });
}

function open(mode) {
  if (isOpen()) return;
  $("lbMsg").textContent = CONFIGURED ? "" : "Ajoute ta configuration dans js/firebase-config.js pour activer le classement.";
  buildTabs();
  openModal($("lb"));
  selectTab(mode || SP.getDiff());
  setTimeout(() => $("lb").querySelector(".modal-x").focus({ preventScroll: true }), 50);
}
async function close() {
  if (!isOpen()) return;
  stopListening();
  await closeModal($("lb"));
}

/* ---------- Événements de l'interface ---------- */
$("lb").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
$("lbEditPseudo").addEventListener("click", async () => { await close(); openIdentity("edit"); });
window.addEventListener("keydown", (e) => {
  if (!isOpen()) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const ids = SP.DIFF_LIST.map((d) => d.id);
    const i = (ids.indexOf(currentTab) + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length;
    selectTab(ids[i]);
  }
});
// Onglet en arrière-plan : on coupe l'écoute temps réel (aucune lecture inutile)
document.addEventListener("visibilitychange", () => {
  if (!isOpen()) return;
  if (document.hidden) stopListening(); else listen(currentTab);
});

/* ---------- Fin de partie : envoi automatique ---------- */
window.addEventListener("sunpilot:gameover", async (e) => {
  const el = $("goOnline"); const d = e.detail; const info = modeInfo(d.mode);
  if (!CONFIGURED || !(d.score > 0)) { el.textContent = ""; return; }
  el.textContent = "🌍 Envoi au classement mondial…";
  try {
    const r = await submitScore(d);
    el.innerHTML = "";
    const b = document.createElement("b");
    if (r.status === "ok" && r.rank) { el.append("🌍 Nouveau record en ligne ! Rang mondial "); b.textContent = rankText(r.rank); el.append(b, ` en ${info.label}`); }
    else if (r.status === "ok") { el.append("🌍 Nouveau record en ligne enregistré : "); b.textContent = fmt(r.best); el.append(b); }
    else if (r.status === "notBetter") { el.append(`🌍 Ton record mondial en ${info.label} : `); b.textContent = fmt(r.best); el.append(b); }
    else if (r.status === "pending") el.textContent = "🌍 Hors ligne : ton record sera envoyé dès le retour du réseau.";
    else if (r.status === "noPseudo") el.textContent = "🌍 Crée ton pseudo pour apparaître au classement.";
    else el.textContent = `🌍 ${r.message || "Classement indisponible pour le moment"} (score gardé en local).`;
  } catch (err) {
    el.textContent = `🌍 ${errorMessage(err)} (score gardé en local).`;
  }
});

export const Leaderboard = { open, close, submitScore, getRank };
// Getter réel (Object.assign figerait la valeur au chargement)
Object.defineProperty(Leaderboard, "uid", { get: () => myUid, enumerable: true });
window.SunPilotLB = Leaderboard;

// Récupère l'UID dès que la connexion partagée est prête (aucune lecture Firestore)
if (CONFIGURED) fb().catch(() => {});
