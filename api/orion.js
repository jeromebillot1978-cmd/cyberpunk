/* =========================================================
   ORION — pilote IA du Canal des Pilotes (fonction Vercel)
   ---------------------------------------------------------
   POST /api/orion   Authorization: Bearer <jeton Firebase du joueur>
   { action: "welcome" }                 accueille un nouveau pilote
   { action: "ask", messageId }          répond à un message qui mentionne @ORION
   { action: "record", mode }            commente un record du top 10
   { action: "animate" }                 anime le canal quand il est calme
   Seul ce serveur peut écrire des messages de type « orion »
   (les règles Firestore l'interdisent aux joueurs).
   Garde-fous : jeton vérifié, joueur exclu refusé, 1 appel / 8 s
   et 40 / jour par joueur, quotas globaux d'IA et de messages,
   chaque événement traité une seule fois (documents de dédoublonnage).
   ========================================================= */
import { admin, adminError } from "./_lib/admin.js";
import { faqAnswer, welcomeText, recordText, animationText, FALLBACK } from "./_lib/faq.js";
import { askGroq, sanitize } from "./_lib/groq.js";

const MODES = { beginner: "🟢 DÉBUTANT", intermediate: "🟡 INTERMÉDIAIRE", pro: "🔴 PRO" };
const USER_GAP = 8000, USER_DAY = 40;          // par joueur
const AI_DAY = 300, POSTS_DAY = 600;           // pour tout le canal
const ANIMATE_GAP = 45 * 60000, QUIET = 20 * 60000;
const MIN = 60000;

const day = () => new Date().toISOString().slice(0, 10);
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : 0);
class Stop extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;                                    // appel même origine sans en-tête
  try {
    const host = new URL(origin).host;
    const list = (process.env.ALLOWED_ORIGINS || "cyberpunk.jercat.fr").split(",").map((s) => s.trim()).filter(Boolean);
    return host === req.headers.host || list.includes(host) || /^localhost(:\d+)?$/.test(host);
  } catch (e) { return false; }
}

/** Quota par joueur : 1 appel toutes les 8 s pour chaque action, 40 appels par jour au total. */
async function userQuota(db, uid, action) {
  const ref = db.collection("orionLimits").doc(uid);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    const t = Date.now();
    const last = (d.lastAt && d.lastAt[action]) || 0;
    if (t - last < USER_GAP) throw new Stop(429, "trop rapide");
    const count = d.day === day() ? (d.count || 0) : 0;
    if (count >= USER_DAY) throw new Stop(429, "quota du jour atteint");
    tx.set(ref, { lastAt: { ...(d.lastAt || {}), [action]: t }, day: day(), count: count + 1 }, { merge: true });
    return d;
  });
}

/** Quota global (appels d'IA ou messages publiés par ORION). */
async function globalQuota(db, field, max) {
  const ref = db.collection("orion").doc("state");
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    const counts = d.day === day() ? (d.counts || {}) : {};
    if ((counts[field] || 0) >= max) return false;
    counts[field] = (counts[field] || 0) + 1;
    tx.set(ref, { day: day(), counts }, { merge: true });
    return true;
  });
}

/** Crée un document de dédoublonnage ; false s'il existe déjà (événement déjà traité). */
async function once(db, coll, id) {
  try { await db.collection(coll).doc(id).create({ at: Date.now() }); return true; }
  catch (e) { if (e.code === 6 || /already exists/i.test(e.message)) return false; throw e; }
}

async function post(a, text, extra = {}) {
  if (!(await globalQuota(a.db, "posts", POSTS_DAY))) throw new Stop(429, "quota de messages d'ORION atteint");
  const ref = await a.db.collection("messages").add({
    uid: "orion", pseudo: "ORION", type: "orion", text, createdAt: a.FieldValue.serverTimestamp(), hidden: false, reports: 0, ...extra,
  });
  return ref.id;
}

/* ---------- Actions ---------- */
async function welcome(a, uid, pseudo, quota) {
  if (quota.welcomed) return { skipped: "déjà accueilli" };
  const st = await a.db.collection("chatState").doc(uid).get();
  if (!st.exists || Date.now() - ms(st.data().welcomedAt) > 10 * MIN) return { skipped: "pas de nouvelle arrivée" };
  await a.db.collection("orionLimits").doc(uid).set({ welcomed: true }, { merge: true });
  return { id: await post(a, welcomeText(pseudo)) };
}

async function ask(a, uid, pseudo, messageId) {
  if (typeof messageId !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(messageId)) throw new Stop(400, "messageId invalide");
  const snap = await a.db.collection("messages").doc(messageId).get();
  if (!snap.exists) throw new Stop(404, "message introuvable");
  const m = snap.data();
  if (m.uid !== uid || m.type !== "user" || m.hidden) throw new Stop(403, "message non autorisé");
  if (Date.now() - ms(m.createdAt) > 3 * MIN) return { skipped: "message trop ancien" };
  if (!/(^|[^a-z0-9_])@?orion\b/i.test(m.text || "")) return { skipped: "ORION n'est pas mentionné" };
  if (!(await once(a.db, "orionAnswers", messageId))) return { skipped: "déjà répondu" };

  const question = String(m.text).replace(/@?orion\b[,:!]?/gi, "").trim();
  const faq = faqAnswer(question);
  let answer = null;
  // Question courte et reconnue : réponse directe. Sinon l'IA (si configurée), puis la base de connaissances.
  if (faq && question.length <= 80) answer = faq;
  else if (process.env.GROQ_API_KEY && (await globalQuota(a.db, "ai", AI_DAY))) answer = await askGroq(question || "Présente-toi", pseudo);
  answer = answer || faq || FALLBACK;
  return { id: await post(a, sanitize(`@${pseudo} ${answer}`) || `@${pseudo} ${FALLBACK}`, { replyTo: { id: messageId, pseudo } }) };
}

async function record(a, uid, pseudo, mode) {
  if (!MODES[mode]) throw new Stop(400, "mode invalide");
  const s = await a.db.collection("scores").doc(`${uid}_${mode}`).get();
  if (!s.exists) throw new Stop(404, "score introuvable");
  const sc = s.data();
  if (Date.now() - ms(sc.createdAt) > 10 * MIN) return { skipped: "record trop ancien" };
  if (!(await once(a.db, "orionRecords", `${uid}_${mode}_${sc.score}`))) return { skipped: "déjà commenté" };
  const better = await a.db.collection("scores").where("mode", "==", mode).where("score", ">", sc.score).count().get();
  const rank = better.data().count + 1;
  if (rank > 10) return { skipped: "hors top 10" };
  return { id: await post(a, recordText(sc.pseudo || pseudo, sc.score, MODES[mode], rank)) };
}

async function animate(a) {
  const ref = a.db.collection("orion").doc("state");
  const ok = await a.db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (Date.now() - ((s.exists && s.data().lastAnimateAt) || 0) < ANIMATE_GAP) return false;
    tx.set(ref, { lastAnimateAt: Date.now() }, { merge: true });
    return true;
  });
  if (!ok) return { skipped: "animation récente" };
  const last = await a.db.collection("messages").where("hidden", "==", false).orderBy("createdAt", "desc").limit(1).get();
  if (!last.empty && Date.now() - ms(last.docs[0].data().createdAt) < QUIET) return { skipped: "canal actif" };
  const tops = await Promise.all(Object.entries(MODES).map(async ([mode, label]) => {
    const q = await a.db.collection("scores").where("mode", "==", mode).orderBy("score", "desc").limit(1).get();
    return q.empty ? null : { label, score: q.docs[0].data().score, pseudo: q.docs[0].data().pseudo };
  }));
  return { id: await post(a, animationText(tops)) };
}

/* ---------- Point d'entrée ---------- */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Orion-Version", "4");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  if (!allowedOrigin(req)) return res.status(403).json({ error: "Origine non autorisée" });
  let a = null;
  try { a = await admin(); } catch (e) { console.error("[ORION] initialisation :", e); }
  if (!a) return res.status(503).json({ error: `ORION n'est pas configuré (${adminError()})` });

  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Stop(401, "Jeton manquant");
    let uid;
    try { uid = (await a.auth.verifyIdToken(token)).uid; } catch (e) { throw new Stop(401, "Jeton invalide"); }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = body.action;
    if (!["welcome", "ask", "record", "animate"].includes(action)) throw new Stop(400, "Action inconnue");

    const [user, ban] = await Promise.all([a.db.collection("users").doc(uid).get(), a.db.collection("bans").doc(uid).get()]);
    if (ban.exists) throw new Stop(403, "Pilote exclu du canal");
    if (!user.exists) throw new Stop(403, "Pseudo requis");
    const pseudo = user.data().pseudo;
    const quota = await userQuota(a.db, uid, action);

    let result;
    if (action === "welcome") result = await welcome(a, uid, pseudo, quota);
    else if (action === "ask") result = await ask(a, uid, pseudo, body.messageId);
    else if (action === "record") result = await record(a, uid, pseudo, body.mode);
    else result = await animate(a);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof Stop) return res.status(e.status).json({ error: e.message });
    console.error("[ORION]", e);
    return res.status(500).json({ error: "Erreur interne" });
  }
}
