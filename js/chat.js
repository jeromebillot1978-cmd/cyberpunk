/* =========================================================
   CANAL DES PILOTES — chat communautaire de Sun Pilot
   ---------------------------------------------------------
   • messages/{id}     : visibles par tous, en temps réel
   • chatState/{uid}   : anti-spam (4 s entre deux messages,
                         6 messages par minute), vérifié par
                         les règles Firestore
   • presence/{uid}    : pilotes présents (signal de vie /60 s)
   • reports/{id}      : signalements (masquage auto à 3)
   • ORION             : pilote IA, répond via /api/orion
   Coûts maîtrisés : écoute active uniquement fenêtre ouverte
   et onglet visible, 40 derniers messages, aucun écouteur
   de présence (comptage agrégé 1 fois par minute).
   ========================================================= */
import { getFirebase, CONFIGURED, errorMessage } from "./firebase.js";
import { getPseudo, onPseudoChange, openIdentity } from "./identity.js";
import { getActiveId, getProfile } from "./profiles.js";
import { openModal, closeModal, isModalOpen } from "./modal.js";
import { checkMessage, cleanText, TEXT_MAX } from "./chat-filter.js";

/* ---------- Réglages (identiques aux règles Firestore) ---------- */
const PAGE = 40;                       // messages chargés à l'ouverture
const OLDER_PAGE = 30;                 // « messages plus anciens »
const COOLDOWN = 4000;                 // délai entre deux messages
const WINDOW = 60000, MAX_PER_WINDOW = 6;
const EDIT_WINDOW = 10 * 60000;        // correction possible pendant 10 min
const JOIN_GAP = 10 * 60000;           // « a rejoint » au plus toutes les 10 min
const RECORD_GAP = 10 * 60000;         // annonce de record au plus toutes les 10 min
const HEARTBEAT = 60000;               // signal de présence
const ONLINE_WINDOW = 150000;          // présent = signe de vie depuis moins de 2 min 30
const HIDE_AT = 3;                     // signalements avant masquage automatique
const QUIET = 20 * 60000;              // canal calme : ORION anime au bout de 20 min
const MARGIN = 1500;                   // marge pour les écarts d'horloge
const REASONS = [["insulte", "Insulte"], ["haine", "Propos haineux"], ["spam", "Spam"], ["triche", "Triche"], ["autre", "Autre"]];
const ORION_RE = /(^|[^a-z0-9_])@?orion\b/i;

const SP = window.SunPilot || {};
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const now = () => Date.now();
const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);

/* ---------- État ---------- */
let ctx = null;            // { user, db, fs, pid } du pilote actif
let state = null;          // copie locale de chatState (millisecondes)
let unsub = null;
let live = [];             // 40 derniers messages (écoute temps réel), du plus récent au plus ancien
let older = [];            // messages plus anciens chargés à la demande
let olderCursor = null, noMoreOlder = false;
let isMod = false, banned = false;
let hbTimer = null, onlineTimer = null;
let joinedNow = false;     // un « a rejoint » a été publié pendant cette ouverture
let firstSnap = true, sending = false;
let editing = null, confirmDel = null, reporting = null;
const reported = new Set((() => { try { return JSON.parse(sessionGet("sp_chat_reported") || "[]"); } catch (e) { return []; } })());

function sessionGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function sessionSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
const isOpen = () => isModalOpen($("chat"));

/* =========================================================
   CONNEXION ET ÉTAT ANTI-SPAM
   ========================================================= */
async function connect(pid = getActiveId()) {
  const f = await getFirebase(pid);
  return { ...f, pid };
}
function toLocal(d) {
  return {
    lastMsgAt: tsMs(d.lastMsgAt), winStart: tsMs(d.winStart), winCount: d.winCount || 0,
    joinedAt: tsMs(d.joinedAt), leftAt: tsMs(d.leftAt), recordAt: tsMs(d.recordAt),
  };
}
async function readState(c) {
  const snap = await c.fs.getDoc(c.fs.doc(c.db, "chatState", c.user.uid));
  return snap.exists() ? toLocal(snap.data()) : null;
}
function pseudoOf(pid) {
  return pid === getActiveId() ? getPseudo() : (getProfile(pid) || {}).pseudo;
}

/**
 * Garantit l'existence de l'état anti-spam. Première fois : « Bienvenue à bord »
 * (écriture groupée, une seule fois par pilote, vérifiée par les règles).
 */
async function ensureState(c, { announceJoin = false } = {}) {
  const { fs, db, user } = c;
  let st = await readState(c);
  const pseudo = pseudoOf(c.pid);
  if (!st) {
    const EPOCH = fs.Timestamp.fromMillis(0);
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "chatState", user.uid), {
      uid: user.uid, createdAt: fs.serverTimestamp(), welcomedAt: fs.serverTimestamp(),
      lastMsgAt: EPOCH, lastMsgId: "", winStart: EPOCH, winCount: 0,
      joinedAt: fs.serverTimestamp(), leftAt: EPOCH, recordAt: EPOCH,
    });
    b.set(fs.doc(fs.collection(db, "messages")), { uid: user.uid, pseudo, type: "welcome", createdAt: fs.serverTimestamp(), hidden: false, reports: 0 });
    await b.commit();
    st = { lastMsgAt: 0, winStart: 0, winCount: 0, joinedAt: now(), leftAt: 0, recordAt: 0 };
    if (announceJoin) joinedNow = true;
    orion("welcome", {}, c);
    return st;
  }
  if (announceJoin && now() - st.joinedAt > JOIN_GAP + MARGIN) {
    try {
      const b = fs.writeBatch(db);
      b.set(fs.doc(fs.collection(db, "messages")), { uid: user.uid, pseudo, type: "join", createdAt: fs.serverTimestamp(), hidden: false, reports: 0 });
      b.update(fs.doc(db, "chatState", user.uid), { joinedAt: fs.serverTimestamp() });
      await b.commit();
      st.joinedAt = now(); joinedNow = true;
    } catch (e) { console.warn("[Canal] arrivée non annoncée :", e.code || e); }
  }
  return st;
}

async function announceLeave() {
  if (!ctx || !state || !joinedNow || state.leftAt >= state.joinedAt) return;
  joinedNow = false;
  const { fs, db, user } = ctx;
  try {
    const b = fs.writeBatch(db);
    b.set(fs.doc(fs.collection(db, "messages")), { uid: user.uid, pseudo: getPseudo(), type: "leave", createdAt: fs.serverTimestamp(), hidden: false, reports: 0 });
    b.update(fs.doc(db, "chatState", user.uid), { leftAt: fs.serverTimestamp() });
    await b.commit();
    state.leftAt = now();
  } catch (e) { console.warn("[Canal] départ non annoncé :", e.code || e); }
}

/* =========================================================
   ORION : appel du serveur (/api/orion)
   ========================================================= */
async function orion(action, extra = {}, c = ctx) {
  if (!c || location.protocol === "file:") return;
  try {
    const token = await c.user.getIdToken();
    await fetch("/api/orion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...extra }),
      keepalive: true,
    });
  } catch (e) { /* ORION indisponible : le canal fonctionne sans lui */ }
}

/* =========================================================
   ENVOI
   ========================================================= */
function waitText(ms) { return `${Math.ceil(ms / 1000)} s`; }

/** Prochaine étape de la fenêtre anti-spam, ou délai d'attente. */
function plan() {
  const t = now();
  const sinceLast = t - state.lastMsgAt;
  if (sinceLast < COOLDOWN + MARGIN) return { wait: COOLDOWN + MARGIN - sinceLast, why: "cooldown" };
  const inWin = t - state.winStart;
  if (inWin >= WINDOW + MARGIN) return { reset: true };
  if (inWin > WINDOW - MARGIN) return { wait: WINDOW + MARGIN - inWin, why: "window" };
  if (state.winCount >= MAX_PER_WINDOW) return { wait: WINDOW + MARGIN - inWin, why: "limit" };
  return { reset: false, count: state.winCount + 1 };
}

async function send(e) {
  e.preventDefault();
  if (!ctx || !state) return;
  if (sending) return status("⏳ Envoi en cours…");
  if (banned) return status("⛔ Tu as été exclu du canal.", "err");
  const input = $("chatInput");
  const raw = input.value;
  const chk = checkMessage(raw);
  if (!chk.ok) return status("❌ " + chk.message, "err");
  const p = plan();
  if (p.wait) {
    return status(p.why === "limit"
      ? `⏳ ${MAX_PER_WINDOW} messages par minute maximum. Réessaie dans ${waitText(p.wait)}.`
      : `⏳ Patiente ${waitText(p.wait)} avant le prochain message.`, "err");
  }
  const { fs, db, user } = ctx;
  sending = true; $("chatSend").disabled = true; status("⏳ Envoi…");
  try {
    const ref = fs.doc(fs.collection(db, "messages"));
    const b = fs.writeBatch(db);
    b.set(ref, { uid: user.uid, pseudo: getPseudo(), type: "user", text: chk.text, createdAt: fs.serverTimestamp(), hidden: false, reports: 0 });
    b.update(fs.doc(db, "chatState", user.uid), {
      lastMsgAt: fs.serverTimestamp(), lastMsgId: ref.id,
      ...(p.reset ? { winStart: fs.serverTimestamp(), winCount: 1 } : { winCount: p.count }),
    });
    await b.commit();
    state.lastMsgAt = now();
    if (p.reset) { state.winStart = now(); state.winCount = 1; } else state.winCount = p.count;
    if (input.value === raw) input.value = "";          // le joueur n'a pas commencé un autre message
    counter(); if ($("chatStatus").textContent === "⏳ Envoi…") status("");
    stickToBottom = true; scrollToBottom();
    if (ORION_RE.test(chk.text)) { status("🤖 ORION réfléchit…"); orion("ask", { messageId: ref.id }).then(() => status("")); }
  } catch (err) {
    console.warn("[Canal] envoi refusé :", err);
    if (err.code === "permission-denied") {
      try { state = (await readState(ctx)) || state; } catch (_) {}
      status("⏳ Envoi refusé par l'anti-spam ou les règles du canal. Réessaie dans quelques secondes.", "err");
    } else status("❌ " + errorMessage(err), "err");
  } finally {
    sending = false; $("chatSend").disabled = false; input.focus({ preventScroll: true });
  }
}

/* =========================================================
   ANNONCE D'UN RECORD (fin de partie, top 10 mondial)
   ========================================================= */
window.addEventListener("sunpilot:onlinerecord", async (e) => {
  const d = e.detail || {};
  if (!CONFIGURED || !d.rank || d.rank.capped || d.rank.pos > 10) return;
  try {
    const c = await connect(d.profileId || getActiveId());
    const st = (ctx && ctx.pid === c.pid && state) ? state : await ensureState(c);
    if (now() - st.recordAt < RECORD_GAP + MARGIN) return;
    const { fs, db, user } = c;
    const b = fs.writeBatch(db);
    b.set(fs.doc(fs.collection(db, "messages")), {
      uid: user.uid, pseudo: pseudoOf(c.pid), type: "record", mode: d.mode, score: d.score,
      createdAt: fs.serverTimestamp(), hidden: false, reports: 0,
    });
    b.update(fs.doc(db, "chatState", user.uid), { recordAt: fs.serverTimestamp() });
    await b.commit();
    st.recordAt = now();
    orion("record", { mode: d.mode }, c);
  } catch (err) { console.warn("[Canal] record non annoncé :", err.code || err); }
});

/* =========================================================
   ÉCOUTE TEMPS RÉEL ET AFFICHAGE
   ========================================================= */
function setLive(text, cls) {
  const el = $("chatLive"); el.classList.remove("on", "off"); if (cls) el.classList.add(cls);
  $("chatLiveTxt").textContent = text;
}
function stopListening() { if (unsub) { unsub(); unsub = null; } }

function listen() {
  stopListening();
  if (!ctx) return;
  const { fs, db } = ctx;
  setLive("CONNEXION…", "");
  const q = fs.query(fs.collection(db, "messages"), fs.where("hidden", "==", false), fs.orderBy("createdAt", "desc"), fs.limit(PAGE));
  unsub = fs.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    live = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites }));
    if (!olderCursor && snap.docs.length) olderCursor = snap.docs[snap.docs.length - 1];
    $("chatOlder").classList.toggle("hidden", noMoreOlder || snap.docs.length < PAGE);
    render();
    setLive(snap.metadata.fromCache ? "CACHE · SYNCHRONISATION…" : "EN DIRECT", snap.metadata.fromCache ? "" : "on");
    if (firstSnap && !snap.metadata.fromCache) {
      firstSnap = false;
      const newest = live[0] ? tsMs(live[0].createdAt) : 0;
      if (now() - newest > QUIET) orion("animate");          // canal calme : ORION relance la conversation
    }
  }, (err) => { console.warn("[Canal] écoute impossible :", err); setLive("HORS LIGNE", "off"); });
}

async function loadOlder() {
  if (!ctx || !olderCursor || noMoreOlder) return;
  const { fs, db } = ctx;
  const btn = $("chatOlder"); btn.disabled = true; btn.textContent = "CHARGEMENT…";
  try {
    const q = fs.query(fs.collection(db, "messages"), fs.where("hidden", "==", false), fs.orderBy("createdAt", "desc"), fs.startAfter(olderCursor), fs.limit(OLDER_PAGE));
    const snap = await fs.getDocs(q);
    if (snap.docs.length) olderCursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < OLDER_PAGE) noMoreOlder = true;
    const feed = $("chatFeed"); const before = feed.scrollHeight;
    older = older.concat(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    render({ keepPosition: true });
    feed.scrollTop += feed.scrollHeight - before;      // garde la position de lecture
  } catch (e) { status("❌ " + errorMessage(e), "err"); }
  btn.disabled = false; btn.textContent = "↑ MESSAGES PLUS ANCIENS";
  btn.classList.toggle("hidden", noMoreOlder);
}

/* ---------- Rendu (DOM + textContent : aucune injection HTML possible) ---------- */
let stickToBottom = true;
function nearBottom() { const f = $("chatFeed"); return f.scrollHeight - f.scrollTop - f.clientHeight < 90; }
function scrollToBottom() { const f = $("chatFeed"); f.scrollTop = f.scrollHeight; $("chatNew").classList.add("hidden"); }

function timeText(ms) {
  if (!ms) return "";
  const d = new Date(ms), t = new Date();
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === t.toDateString() ? hm : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}
function hue(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/** Texte avec mise en avant de « @pseudo » quand il désigne le joueur. */
function richText(text) {
  const span = el("span", "msg-text");
  const me = (getPseudo() || "").toLowerCase();
  String(text).split(/(@[A-Za-z0-9_-]{3,15})/g).forEach((part) => {
    if (/^@/.test(part) && (part.slice(1).toLowerCase() === me || part.slice(1).toLowerCase() === "orion")) span.append(el("mark", "", part));
    else if (part) span.append(document.createTextNode(part));
  });
  return span;
}

function systemLine(m) {
  const who = m.pseudo || "Un pilote";
  if (m.type === "welcome") return `🚀 Bienvenue à bord, ${who} !`;
  if (m.type === "join") return `📡 ${who} vient de rejoindre le canal.`;
  if (m.type === "leave") return `📴 ${who} vient de quitter le canal.`;
  if (m.type === "record") {
    const d = (SP.DIFFICULTIES || {})[m.mode];
    return `🏆 Le pilote ${who} vient d'établir un nouveau record ! ${fmt(m.score)} pts${d ? ` en ${d.emoji} ${d.label}` : ""}`;
  }
  return null;
}

function render({ keepPosition = false } = {}) {
  const keep = !keepPosition && nearBottom();
  const ol = $("chatList"); ol.innerHTML = "";
  const all = [...live, ...older.filter((o) => !live.some((l) => l.id === o.id))].reverse();
  if (!all.length) {
    ol.append(el("li", "chat-empty", "Le canal est silencieux… Lance la conversation, pilote ! 🚀"));
  }
  const myUid = ctx && ctx.user.uid;
  let lastDay = "";
  for (const m of all) {
    const ms = tsMs(m.createdAt);
    const day = ms ? new Date(ms).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
    if (day && day !== lastDay) { ol.append(el("li", "chat-day", day.toUpperCase())); lastDay = day; }
    const sys = systemLine(m);
    if (sys) {
      const li = el("li", `chat-sys ${m.type}`);
      li.append(el("span", "", sys), el("time", "", timeText(ms)));
      ol.append(li); continue;
    }
    const mine = m.uid === myUid;
    const li = el("li", "chat-msg" + (m.type === "orion" ? " orion" : "") + (mine ? " mine" : "") + (m.pending ? " pending" : ""));
    li.dataset.id = m.id;
    const head = el("div", "msg-head");
    const name = el("span", "msg-name", m.type === "orion" ? "ORION" : m.pseudo || "Pilote");
    if (m.type === "orion") name.append(el("em", "", "IA"));
    else name.style.setProperty("--h", hue(m.pseudo));
    if (mine) name.append(el("em", "me", "TOI"));
    head.append(name, el("time", "", timeText(ms) + (m.editedAt ? " · modifié" : "")));
    li.append(head);

    if (editing === m.id) {
      const f = el("form", "msg-edit");
      const inp = el("input"); inp.type = "text"; inp.maxLength = TEXT_MAX; inp.value = m.text; inp.setAttribute("aria-label", "Modifier le message");
      const ok = el("button", "mini ok", "✔"); ok.type = "submit"; ok.title = "Enregistrer";
      const no = el("button", "mini", "✕"); no.type = "button"; no.title = "Annuler";
      no.addEventListener("click", () => { editing = null; render(); });
      f.addEventListener("submit", (ev) => { ev.preventDefault(); saveEdit(m, inp.value); });
      f.append(inp, ok, no); li.append(f);
      setTimeout(() => inp.focus({ preventScroll: true }), 0);
    } else li.append(richText(m.text || ""));

    li.append(actions(m, mine, ms));
    if (reporting === m.id) li.append(reportPanel(m));
    ol.append(li);
  }
  if (keepPosition) return;
  if (keep || stickToBottom) { scrollToBottom(); stickToBottom = false; }
  else if (all.length) $("chatNew").classList.remove("hidden");
}

function actions(m, mine, ms) {
  const bar = el("div", "msg-actions");
  const btn = (label, title, fn, cls = "") => { const b = el("button", "mini " + cls, label); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", fn); bar.append(b); };
  if (mine && m.type === "user" && !m.pending) {
    if (now() - ms < EDIT_WINDOW) btn("✏", "Modifier", () => { editing = m.id; confirmDel = null; render(); });
    btn(confirmDel === m.id ? "✔ ?" : "🗑", confirmDel === m.id ? "Confirmer la suppression" : "Supprimer", () => removeMsg(m), confirmDel === m.id ? "danger" : "");
  }
  if (!mine && !isMod) {
    if (reported.has(m.id)) bar.append(el("span", "msg-flag", "⚑ signalé"));
    else btn("⚑", "Signaler ce message", () => { reporting = reporting === m.id ? null : m.id; render(); });
  }
  if (isMod && !mine) {
    btn("🛡", "Masquer (modération)", () => modHide(m));
    btn("🗑", "Supprimer (modération)", () => modDelete(m), "danger");
    if (m.type !== "orion" && m.uid) btn("⛔", "Exclure ce pilote du canal", () => modBan(m), "danger");
  }
  return bar;
}

function reportPanel(m) {
  const box = el("div", "msg-report");
  box.append(el("span", "", "Signaler pour :"));
  for (const [id, label] of REASONS) {
    const b = el("button", "mini", label); b.type = "button";
    b.addEventListener("click", () => report(m, id)); box.append(b);
  }
  return box;
}

/* =========================================================
   ACTIONS SUR LES MESSAGES
   ========================================================= */
async function saveEdit(m, raw) {
  const chk = checkMessage(raw);
  if (!chk.ok) return status("❌ " + chk.message, "err");
  const { fs, db } = ctx;
  try {
    await fs.updateDoc(fs.doc(db, "messages", m.id), { text: chk.text, editedAt: fs.serverTimestamp() });
    editing = null; status("✅ Message modifié", "ok"); render();
  } catch (e) { status(e.code === "permission-denied" ? "❌ Modification impossible (plus de 10 min ou texte refusé)." : "❌ " + errorMessage(e), "err"); }
}
async function removeMsg(m) {
  if (confirmDel !== m.id) { confirmDel = m.id; editing = null; render(); return; }
  confirmDel = null;
  const { fs, db } = ctx;
  try { await fs.deleteDoc(fs.doc(db, "messages", m.id)); older = older.filter((o) => o.id !== m.id); status("🗑 Message supprimé", "ok"); }
  catch (e) { status("❌ " + errorMessage(e), "err"); }
  render();
}
async function report(m, reason) {
  reporting = null;
  const { fs, db, user } = ctx;
  const count = (m.reports || 0) + 1, hide = count >= HIDE_AT;
  try {
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "reports", `${m.id}_${user.uid}`), { messageId: m.id, reporterUid: user.uid, authorUid: m.uid, reason, createdAt: fs.serverTimestamp() });
    b.update(fs.doc(db, "messages", m.id), { reports: count, hidden: hide });
    if (hide) b.set(fs.doc(db, "moderation", `autohide_${m.id}`), { action: "auto_hide", messageId: m.id, reports: count, by: user.uid, createdAt: fs.serverTimestamp() });
    await b.commit();
    reported.add(m.id); sessionSet("sp_chat_reported", JSON.stringify([...reported].slice(-200)));
    if (hide) older = older.filter((o) => o.id !== m.id);
    status(hide ? "⚑ Merci : message masqué après plusieurs signalements." : "⚑ Merci, le message a été signalé aux modérateurs.", "ok");
  } catch (e) {
    console.warn("[Canal] signalement refusé :", e);
    reported.add(m.id);
    status(e.code === "permission-denied" ? "⚑ Message déjà signalé ou déjà masqué." : "❌ " + errorMessage(e), "err");
  }
  render();
}
async function modLog(action, m) {
  const { fs, db, user } = ctx;
  await fs.addDoc(fs.collection(db, "moderation"), { action, messageId: m.id, targetUid: m.uid || "", reason: "modération manuelle", by: user.uid, createdAt: fs.serverTimestamp() }).catch(() => {});
}
async function modHide(m) {
  const { fs, db, user } = ctx;
  try { await fs.updateDoc(fs.doc(db, "messages", m.id), { hidden: true, moderatedBy: user.uid, moderatedAt: fs.serverTimestamp() }); modLog("hide", m); status("🛡 Message masqué", "ok"); }
  catch (e) { status("❌ " + errorMessage(e), "err"); }
}
async function modDelete(m) {
  const { fs, db } = ctx;
  try { await fs.deleteDoc(fs.doc(db, "messages", m.id)); modLog("delete", m); older = older.filter((o) => o.id !== m.id); status("🗑 Message supprimé", "ok"); render(); }
  catch (e) { status("❌ " + errorMessage(e), "err"); }
}
async function modBan(m) {
  if (!confirm(`Exclure ${m.pseudo} du canal ?`)) return;
  const { fs, db, user } = ctx;
  try {
    await fs.setDoc(fs.doc(db, "bans", m.uid), { uid: m.uid, pseudo: m.pseudo || "", reason: "modération manuelle", by: user.uid, createdAt: fs.serverTimestamp() });
    modLog("ban", m); status(`⛔ ${m.pseudo} est exclu du canal`, "ok");
  } catch (e) { status("❌ " + errorMessage(e), "err"); }
}

/* =========================================================
   PRÉSENCE (sans écouteur : signal /60 s + comptage agrégé)
   ========================================================= */
async function heartbeat() {
  if (!ctx || banned || document.hidden) return;
  const { fs, db, user } = ctx;
  try { await fs.setDoc(fs.doc(db, "presence", user.uid), { uid: user.uid, pseudo: getPseudo(), lastSeen: fs.serverTimestamp() }); }
  catch (e) { /* moins de 30 s depuis le dernier signal : sans importance */ }
}
function presenceQuery(extra = []) {
  const { fs, db } = ctx;
  return fs.query(fs.collection(db, "presence"), fs.where("lastSeen", ">", fs.Timestamp.fromMillis(now() - ONLINE_WINDOW)), ...extra);
}
async function refreshOnline() {
  if (!ctx || document.hidden) return;
  try {
    const n = (await ctx.fs.getCountFromServer(presenceQuery([ctx.fs.limit(1000)]))).data().count;
    $("chatOnlineTxt").textContent = `${n >= 1000 ? "1000+" : fmt(Math.max(n, 1))} pilote${n > 1 ? "s" : ""} en ligne`;
  } catch (e) { $("chatOnlineTxt").textContent = "pilotes en ligne"; }
}
async function toggleOnlineList() {
  const box = $("chatOnlineList");
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden"); box.textContent = "Chargement…";
  try {
    const { fs } = ctx;
    const snap = await fs.getDocs(presenceQuery([fs.orderBy("lastSeen", "desc"), fs.limit(30)]));
    box.innerHTML = "";
    if (!snap.size) box.textContent = "Aucun autre pilote pour l'instant.";
    snap.docs.forEach((d) => { const s = el("span", "", `👤 ${d.data().pseudo}`); s.style.setProperty("--h", hue(d.data().pseudo)); box.append(s); });
  } catch (e) { box.textContent = errorMessage(e); }
}
function startTimers() {
  stopTimers();
  hbTimer = setInterval(heartbeat, HEARTBEAT);
  onlineTimer = setInterval(refreshOnline, HEARTBEAT);
}
function stopTimers() { clearInterval(hbTimer); clearInterval(onlineTimer); hbTimer = onlineTimer = null; }

/* =========================================================
   OUVERTURE / FERMETURE
   ========================================================= */
function status(text, kind = "") { const s = $("chatStatus"); s.textContent = text; s.className = "chat-status" + (kind ? " " + kind : ""); }
function counter() { const n = $("chatInput").value.length; $("chatCount").textContent = `${n}/${TEXT_MAX}`; $("chatCount").classList.toggle("warn", n > TEXT_MAX - 30); }
function lockForm(on, placeholder) {
  $("chatInput").disabled = on; $("chatSend").disabled = on;
  if (placeholder) $("chatInput").placeholder = placeholder;
}

async function open() {
  if (isOpen()) return;
  if (!CONFIGURED) return;
  if (!getPseudo()) { openIdentity("create", "Choisis ton pseudo pour rejoindre le Canal des Pilotes."); return; }
  live = []; older = []; olderCursor = null; noMoreOlder = false; firstSnap = true; joinedNow = false; stickToBottom = true;
  editing = confirmDel = reporting = null;
  $("chatOnlineList").classList.add("hidden");
  $("chatList").innerHTML = ""; $("chatList").append(el("li", "chat-empty", "Connexion au canal…"));
  status(""); counter(); lockForm(true, "Connexion…");
  openModal($("chat"));
  try {
    ctx = await connect();
    const { fs, db, user } = ctx;
    const [banSnap, modSnap] = await Promise.all([
      fs.getDoc(fs.doc(db, "bans", user.uid)).catch(() => null),
      fs.getDoc(fs.doc(db, "moderators", user.uid)).catch(() => null),
    ]);
    banned = !!(banSnap && banSnap.exists());
    isMod = !!(modSnap && modSnap.exists());
    if (!isOpen()) return;
    listen();
    if (banned) { lockForm(true, "⛔ Tu as été exclu du canal."); status("⛔ Tu peux lire le canal, mais plus y écrire.", "err"); return; }
    state = await ensureState(ctx, { announceJoin: true });
    lockForm(false, "Message aux pilotes… (@ORION pour l'IA)");
    setTimeout(() => $("chatInput").focus({ preventScroll: true }), 120);
    heartbeat(); refreshOnline(); startTimers();
  } catch (e) {
    console.warn("[Canal] ouverture impossible :", e);
    setLive("HORS LIGNE", "off"); lockForm(true, "Canal indisponible");
    status("❌ " + errorMessage(e), "err");
  }
}
async function close() {
  if (!isOpen()) return;
  stopListening(); stopTimers();
  announceLeave();
  await closeModal($("chat"));
}

/* ---------- Événements ---------- */
$("chat").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
$("chatForm").addEventListener("submit", send);
$("chatInput").addEventListener("input", () => { counter(); if ($("chatStatus").classList.contains("err")) status(""); });
$("chatInput").addEventListener("blur", () => { const v = cleanText($("chatInput").value); if (v !== $("chatInput").value.trim()) $("chatInput").value = v; counter(); });
$("chatOlder").addEventListener("click", loadOlder);
$("chatNew").addEventListener("click", scrollToBottom);
$("chatFeed").addEventListener("scroll", () => { if (nearBottom()) $("chatNew").classList.add("hidden"); }, { passive: true });
$("chatOnline").addEventListener("click", toggleOnlineList);
window.addEventListener("keydown", (e) => {
  if (!isOpen()) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (editing || reporting || confirmDel) { editing = reporting = confirmDel = null; render(); } else close();
  }
});
// Onglet en arrière-plan : écoute et présence coupées (aucune lecture inutile)
document.addEventListener("visibilitychange", () => {
  if (!isOpen()) return;
  if (document.hidden) { stopListening(); stopTimers(); }
  else { listen(); heartbeat(); refreshOnline(); startTimers(); }
});
// Changement de pilote : le canal se ferme (il sera rouvert avec le bon pseudo)
onPseudoChange((p, pid) => { if (isOpen() && ctx && ctx.pid !== pid) close(); });

export const Chat = { open, close };
window.SunPilotChat = Chat;
