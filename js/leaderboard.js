/* =========================================================
   CLASSEMENT MONDIAL FIREBASE — Sun Pilot · Neon Skies
   ---------------------------------------------------------
   • Connexion anonyme automatique (un uid unique par appareil)
   • 1 document par joueur ET par mode : scores/{uid}_{mode}
     → aucun doublon possible, seul le meilleur score est gardé
   • Top 10 en temps réel par difficulté (écoute active
     uniquement quand la fenêtre est ouverte)
   • Rang mondial via une requête d'agrégation count()
   • Optimisé coûts : cache local persistant, aucune lecture
     avant écriture (record en ligne mémorisé), écriture
     uniquement si le record est battu, Firestore chargé à la
     demande pour ne pas ralentir le démarrage du jeu.
   ========================================================= */
import { FIREBASE_CONFIG, LB_OPTIONS } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${LB_OPTIONS.sdkVersion}`;
const COLL = "scores";
const TOP_N = 10;
const RANK_LIMIT = 1000;              // au-delà : « #1000+ » (coût max : 1 lecture)
const RANK_TTL = 5 * 60 * 1000;       // rang mis en cache 5 min
const MIN_WRITE_GAP = 11000;          // les règles imposent 10 s entre deux écritures
const PSEUDO_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]{2,16}$/;   // identique aux règles Firestore

const SP = window.SunPilot;
const EMU = !!LB_OPTIONS.useEmulators;
const CONFIG = EMU ? { apiKey: "demo-key", projectId: "demo-sunpilot", appId: "demo" } : FIREBASE_CONFIG;
const CONFIGURED = EMU || (!!CONFIG.apiKey && !/^VOTRE/.test(CONFIG.apiKey));

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
let fb = null;          // modules Firebase chargés { app, auth, fs }
let db = null, user = null;
let readyP = null;
let onlineBests = store.get("sp_online_best", {});   // meilleur score EN LIGNE par mode (évite toute lecture avant écriture)
let pseudo = store.get("sp_pseudo", null);
let unsub = null, currentTab = null, isOpen = false;
let lastRows = {};                                   // dernier top 10 reçu par mode

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modeInfo = (id) => SP.DIFFICULTIES[id] || SP.DIFF_LIST[0];
const docId = (mode) => `${user.uid}_${mode}`;

/* =========================================================
   INITIALISATION (lazy) : App + Auth d'abord, Firestore ensuite
   ========================================================= */
function ready() {
  if (!CONFIGURED) return Promise.reject(new Error("not-configured"));
  if (readyP) return readyP;
  readyP = (async () => {
    setLive("CONNEXION…", "");
    const [appMod, authMod] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
    ]);
    const app = appMod.initializeApp(CONFIG);

    // App Check (reCAPTCHA v3) : bloque les écritures qui ne viennent pas de votre site
    if (LB_OPTIONS.appCheckSiteKey && !EMU) {
      const ac = await import(`${CDN}/firebase-app-check.js`);
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(LB_OPTIONS.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }

    const auth = authMod.getAuth(app);
    if (EMU) authMod.connectAuthEmulator(auth, `http://${LB_OPTIONS.emulatorHost}:9099`, { disableWarnings: true });

    // Connexion anonyme : l'uid est conservé par le navigateur → identifiant unique et stable du joueur
    user = await new Promise((resolve, reject) => {
      const off = authMod.onAuthStateChanged(auth, (u) => {
        if (u) { off(); resolve(u); }
        else authMod.signInAnonymously(auth).catch((e) => { off(); reject(e); });
      });
    });
    if (!pseudo) { pseudo = `Pilote-${user.uid.slice(0, 4).toUpperCase()}`; store.set("sp_pseudo", pseudo); }

    // Firestore (le plus gros module) avec cache local persistant :
    // les écoutes repartent du cache → moins de lectures facturées et affichage instantané
    const fs = await import(`${CDN}/firebase-firestore.js`);
    try {
      db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) {
      db = fs.getFirestore(app);
    }
    if (EMU) fs.connectFirestoreEmulator(db, LB_OPTIONS.emulatorHost, 8080);
    fb = { app, auth, fs };
    setLive(isOpen ? "SYNCHRONISATION…" : "CONNECTÉ", "");
    return fb;
  })();
  readyP.catch((e) => { console.warn("[Classement] initialisation impossible :", e); readyP = null; setLive("HORS LIGNE", "off"); });
  return readyP;
}

/* =========================================================
   ENREGISTREMENT DU SCORE (fin de partie)
   ========================================================= */
async function submitScore({ score, mode, bitcoins, distance, level }) {
  if (!CONFIGURED) return { status: "disabled" };
  score = Math.floor(score); if (!(score > 0)) return { status: "zero" };
  if (!SP.DIFFICULTIES[mode]) return { status: "error" };
  await ready();
  const { fs } = fb;
  const ref = fs.doc(db, COLL, docId(mode));

  // Record en ligne inconnu (1re fois sur ce mode) → 1 seule lecture, ensuite tout est en cache
  if (onlineBests[mode] === undefined) {
    try {
      const snap = await fs.getDoc(ref);
      onlineBests[mode] = snap.exists() ? snap.data().score : 0;
    } catch (e) { onlineBests[mode] = 0; }
    store.set("sp_online_best", onlineBests);
  }
  // Seul un record battu déclenche une écriture
  if (score <= onlineBests[mode]) return { status: "notBetter", best: onlineBests[mode] };

  // Respect de l'anti-spam des règles (10 s entre deux écritures du même document)
  const lastW = store.get("sp_last_write", {});
  const wait = (lastW[mode] || 0) + MIN_WRITE_GAP - Date.now();
  if (wait > 0) await sleep(wait);

  const payload = {
    uid: user.uid,
    pseudo,
    score,
    mode,
    bitcoins: Math.max(0, Math.floor(bitcoins)),
    distance: Math.max(0, Math.floor(distance)),
    level: Math.max(1, Math.floor(level)),
    createdAt: fs.serverTimestamp(),
  };
  try {
    // Écrit dans le cache local immédiatement ; la promesse se résout à la confirmation du serveur
    const write = fs.setDoc(ref, payload);
    const res = await Promise.race([write.then(() => "ok"), sleep(8000).then(() => "pending")]);
    lastW[mode] = Date.now(); store.set("sp_last_write", lastW);
    onlineBests[mode] = score; store.set("sp_online_best", onlineBests);
    session.set("sp_rank_" + mode, null);
    if (res === "pending") return { status: "pending" };
    // Le score est enregistré : un échec du calcul du rang ne doit pas le masquer
    let rank = null;
    try { rank = await getRank(mode, score, true); } catch (e) { console.warn("[Classement] rang indisponible :", e); }
    return { status: "ok", best: score, rank };
  } catch (e) {
    console.warn("[Classement] écriture refusée :", e);
    // Refus des règles (ex. record déjà plus haut sur le serveur) → on resynchronise une fois
    if (e && e.code === "permission-denied") {
      try { const snap = await fs.getDoc(ref); if (snap.exists()) { onlineBests[mode] = snap.data().score; store.set("sp_online_best", onlineBests); } } catch (_) {}
    }
    return { status: "error" };
  }
}

/* =========================================================
   RANG MONDIAL : count() des scores strictement supérieurs
   (agrégation : 1 lecture facturée par tranche de 1000 entrées)
   ========================================================= */
async function getRank(mode, score, force = false) {
  if (!score) return null;
  const key = "sp_rank_" + mode;
  const c = session.get(key, null);
  if (!force && c && c.score === score && Date.now() - c.t < RANK_TTL) return c.rank;
  await ready();
  const { fs } = fb;
  const q = fs.query(
    fs.collection(db, COLL),
    fs.where("mode", "==", mode),
    fs.where("score", ">", score),
    fs.orderBy("score", "desc"),
    fs.limit(RANK_LIMIT)
  );
  const snap = await fs.getCountFromServer(q);
  const n = snap.data().count;
  const rank = { pos: n + 1, capped: n >= RANK_LIMIT };
  session.set(key, { score, rank, t: Date.now() });
  return rank;
}
const rankText = (r) => (r ? (r.capped ? `#${RANK_LIMIT}+` : `#${fmt(r.pos)}`) : "—");

/* =========================================================
   CHANGEMENT DE PSEUDO (met à jour uniquement les records existants)
   ========================================================= */
async function savePseudo(name) {
  name = String(name || "").trim().replace(/\s+/g, " ");
  if (!PSEUDO_RE.test(name)) return { ok: false, msg: "2 à 16 caractères : lettres, chiffres, espace, . _ -" };
  if (name === pseudo) return { ok: true, msg: "Pseudo inchangé." };
  pseudo = name; store.set("sp_pseudo", pseudo);
  if (!CONFIGURED) return { ok: true, msg: "Pseudo enregistré sur cet appareil." };
  await ready();
  const { fs } = fb;
  const modes = Object.keys(onlineBests).filter((m) => onlineBests[m] > 0);
  let maxWait = 0, failed = false;
  await Promise.all(modes.map(async (m) => {
    const lastW = store.get("sp_last_write", {});
    const wait = (lastW[m] || 0) + MIN_WRITE_GAP - Date.now();
    if (wait > 0) { maxWait = Math.max(maxWait, wait); setTimeout(() => pushPseudo(m), wait); return; }   // anti-spam : envoi différé
    if (!(await pushPseudo(m))) failed = true;
  }));
  if (failed) return { ok: true, msg: "Pseudo enregistré sur cet appareil (mise à jour en ligne au prochain record)." };
  return { ok: true, msg: maxWait ? `Pseudo enregistré ✔ (mise en ligne dans ${Math.ceil(maxWait / 1000)} s)` : "Pseudo mis à jour ✔" };
}
async function pushPseudo(mode) {
  const { fs } = fb;
  try {
    const ref = fs.doc(db, COLL, docId(mode));
    await fs.updateDoc(ref, { pseudo, createdAt: fs.serverTimestamp() });
    const lastW = store.get("sp_last_write", {}); lastW[mode] = Date.now(); store.set("sp_last_write", lastW);
    return true;
  } catch (e) { console.warn("[Classement] pseudo non mis à jour :", e); return false; }
}

/* =========================================================
   INTERFACE : fenêtre du classement
   ========================================================= */
function setLive(text, cls) {
  const el = $("lbLive"); if (!el) return;
  el.classList.remove("on", "off"); if (cls) el.classList.add(cls);
  $("lbLiveTxt").textContent = text;
}
function setTitle(mode) {
  const d = modeInfo(mode);
  $("lbTitle").textContent = `🏆 TOP ${TOP_N} ${d.label}`;
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
// Construction en DOM (textContent) : aucun risque d'injection HTML via les pseudos
function renderRows(mode, rows) {
  const ol = $("lbList"); ol.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li"); li.className = "lb-empty";
    li.textContent = `Aucun score pour l'instant en ${modeInfo(mode).label}. Sois le premier pilote du classement ! 🚀`;
    ol.appendChild(li); return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "lb-row" + (i < 3 ? ` r${i + 1}` : "") + (user && r.uid === user.uid ? " me" : "");
    li.style.animationDelay = `${i * 35}ms`;
    const rk = document.createElement("span"); rk.className = "lb-rank"; rk.textContent = i < 3 ? medals[i] : `#${i + 1}`;
    const who = document.createElement("span"); who.className = "lb-who";
    const nm = document.createElement("span"); nm.className = "lb-name"; nm.textContent = r.pseudo || "Pilote";
    if (user && r.uid === user.uid) { const em = document.createElement("em"); em.textContent = "TOI"; nm.appendChild(em); }
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
  const local = (SP.getLocalBests()[mode]) || 0;
  const online = onlineBests[mode] || 0;
  if (!CONFIGURED) {
    box.innerHTML = "";
    box.append(`🌍 Classement mondial non configuré. Ton record local en ${d.label} : `);
    const b = document.createElement("b"); b.textContent = fmt(local); box.append(b);
    return;
  }
  if (!online) {
    box.textContent = local
      ? `🌍 Ton record local en ${d.label} (${fmt(local)}) sera envoyé à ta prochaine partie qui le bat… ou bats-le maintenant !`
      : `🌍 Joue une partie en ${d.label} pour entrer dans le classement mondial.`;
    return;
  }
  // Si le joueur est dans le top 10 affiché, pas besoin de requête de rang
  const rows = lastRows[mode] || [];
  const idx = user ? rows.findIndex((r) => r.uid === user.uid) : -1;
  let rank = idx >= 0 ? { pos: idx + 1, capped: false } : null;
  const paint = () => {
    box.innerHTML = "";
    box.append("🏆 TON RANG MONDIAL : ");
    const b = document.createElement("b"); b.textContent = rankText(rank); box.append(b);
    box.append(` · RECORD EN LIGNE ${fmt(online)}`);
  };
  paint();
  if (!rank) { try { rank = await getRank(mode, online); if (currentTab === mode) paint(); } catch (e) {} }
}

function selectTab(mode) {
  currentTab = mode;
  document.querySelectorAll(".lb-tab").forEach((t) => {
    const on = t.dataset.mode === mode; t.classList.toggle("on", on); t.setAttribute("aria-selected", on);
  });
  setTitle(mode);
  // Affichage instantané depuis le cache de session, puis temps réel
  const cached = session.get("sp_top_" + mode, null);
  if (cached) { lastRows[mode] = cached; renderRows(mode, cached); } else skeleton();
  renderMe(mode);
  listen(mode);
}

// Une seule écoute active à la fois (celle de l'onglet affiché) → lectures minimales
function stopListening() { if (unsub) { unsub(); unsub = null; } }
async function listen(mode) {
  stopListening();
  if (!CONFIGURED) { renderRows(mode, []); setLive("NON CONFIGURÉ", "off"); return; }
  try { await ready(); } catch (e) { setLive("HORS LIGNE", "off"); if (!session.get("sp_top_" + mode, null)) renderRows(mode, []); return; }
  if (!isOpen || currentTab !== mode) return;
  const { fs } = fb;
  const q = fs.query(fs.collection(db, COLL), fs.where("mode", "==", mode), fs.orderBy("score", "desc"), fs.limit(TOP_N));
  unsub = fs.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const rows = snap.docs.map((d) => d.data());
    lastRows[mode] = rows;
    session.set("sp_top_" + mode, rows);
    if (currentTab !== mode) return;
    renderRows(mode, rows);
    setLive(snap.metadata.fromCache ? "CACHE · SYNCHRONISATION…" : "EN DIRECT", snap.metadata.fromCache ? "" : "on");
    renderMe(mode);
  }, (err) => {
    console.warn("[Classement] écoute impossible :", err);
    setLive("HORS LIGNE", "off");
  });
}

function open(mode) {
  if (isOpen) return;
  isOpen = true;
  const lb = $("lb");
  lb.classList.remove("hidden", "closing"); void lb.offsetWidth; lb.classList.add("open");
  document.body.classList.add("lb-open");
  $("lbPseudo").value = pseudo || "";
  $("lbMsg").textContent = CONFIGURED ? "" : "Ajoute ta configuration dans js/firebase-config.js pour activer le classement.";
  buildTabs();
  selectTab(mode || SP.getDiff());
  setTimeout(() => lb.querySelector(".lb-x").focus({ preventScroll: true }), 50);
}
function close() {
  if (!isOpen) return;
  isOpen = false; stopListening();
  const lb = $("lb");
  lb.classList.remove("open"); lb.classList.add("closing");
  setTimeout(() => { lb.classList.add("hidden"); lb.classList.remove("closing"); document.body.classList.remove("lb-open"); }, 240);
}

/* ---------- Événements de l'interface ---------- */
$("lb").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
window.addEventListener("keydown", (e) => {
  if (!isOpen) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.target.matches("input")) {
    const ids = SP.DIFF_LIST.map((d) => d.id);
    const i = (ids.indexOf(currentTab) + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length;
    selectTab(ids[i]);
  }
});
$("lbPseudoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("lbMsg"); msg.textContent = "Enregistrement…";
  try { const r = await savePseudo($("lbPseudo").value); msg.textContent = r.msg; }
  catch (err) { msg.textContent = "Impossible d'enregistrer le pseudo pour le moment."; }
  $("lbPseudo").blur();
});
// Onglet en arrière-plan : on coupe l'écoute temps réel (aucune lecture inutile)
document.addEventListener("visibilitychange", () => {
  if (!isOpen) return;
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
    else el.textContent = "🌍 Classement indisponible pour le moment (score gardé en local).";
  } catch (err) {
    el.textContent = "🌍 Classement indisponible pour le moment (score gardé en local).";
  }
});

/* ---------- API publique + démarrage différé ---------- */
window.SunPilotLB = { open, close, submitScore, getRank, savePseudo, get uid() { return user && user.uid; } };

// Connexion anonyme dès que le jeu est affiché, sans gêner le chargement
if (CONFIGURED) {
  const start = () => ready().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 800);
}
