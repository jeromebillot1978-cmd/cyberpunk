// Tests du serveur ORION (api/orion.js) sur les émulateurs Auth + Firestore.
// Lancement : voir tests/package.json (npm run test:rules)
import handler from "../api/orion.js";
import { admin } from "../api/_lib/admin.js";

const a = admin();
if (!a) { console.log("Émulateurs absents"); process.exit(1); }
const { db, FieldValue, Timestamp } = a;
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "→", e.message); } }
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Compte anonyme sur l'émulateur Auth → jeton d'identité réel
async function signUp() {
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) });
  const d = await r.json(); return { uid: d.localId, token: d.idToken };
}
function call(body, token, headers = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ status: this.code, body: o }); } };
    handler({ method: "POST", headers: { host: "localhost:3000", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body }, res);
  });
}
const orionMsgs = async () => (await db.collection("messages").where("type", "==", "orion").get()).docs.map((d) => d.data());
const now = () => Timestamp.now();

await Promise.all((await db.listCollections()).map((c) => db.recursiveDelete(c)));
const alice = await signUp(), bob = await signUp(), troll = await signUp();
await db.doc(`users/${alice.uid}`).set({ uid: alice.uid, pseudo: "Alice", createdAt: now(), updatedAt: now() });
await db.doc(`users/${bob.uid}`).set({ uid: bob.uid, pseudo: "Bob", createdAt: now(), updatedAt: now() });
await db.doc(`users/${troll.uid}`).set({ uid: troll.uid, pseudo: "Troll", createdAt: now(), updatedAt: now() });
await db.doc(`bans/${troll.uid}`).set({ uid: troll.uid });
await db.doc(`chatState/${alice.uid}`).set({ welcomedAt: now() });
await db.doc(`chatState/${bob.uid}`).set({ welcomedAt: Timestamp.fromMillis(Date.now() - 3600000) });

console.log("Accès");
await t("refus : GET", async () => eq((await new Promise((r) => handler({ method: "GET", headers: {} }, { setHeader() {}, status(c) { return { json: (o) => r(c) }; } }))), 405, "statut"));
await t("refus : sans jeton", async () => eq((await call({ action: "welcome" })).status, 401, "statut"));
await t("refus : faux jeton", async () => eq((await call({ action: "welcome" }, "faux")).status, 401, "statut"));
await t("refus : origine étrangère", async () => eq((await call({ action: "welcome" }, alice.token, { origin: "https://pirate.example" })).status, 403, "statut"));
await t("refus : action inconnue", async () => eq((await call({ action: "pirater" }, alice.token)).status, 400, "statut"));
await t("refus : pilote exclu", async () => eq((await call({ action: "animate" }, troll.token)).status, 403, "statut"));

console.log("Accueil");
await t("ORION accueille Alice", async () => { const r = await call({ action: "welcome" }, alice.token); eq(r.status, 200, "statut"); if (!r.body.id) throw new Error(JSON.stringify(r.body)); });
await t("le message d'ORION contient le pseudo", async () => { const m = await orionMsgs(); if (!m.some((x) => /Alice/.test(x.text) && x.uid === "orion" && x.hidden === false)) throw new Error("absent"); });
await t("refus : appels trop rapprochés (8 s)", async () => eq((await call({ action: "welcome" }, alice.token)).status, 429, "statut"));
await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {} }, { merge: true });
await t("pas de 2e accueil", async () => { const r = await call({ action: "welcome" }, alice.token); eq(r.body.skipped, "déjà accueilli", "résultat"); });
await t("pas d'accueil pour un ancien pilote", async () => { const r = await call({ action: "welcome" }, bob.token); eq(r.body.skipped, "pas de nouvelle arrivée", "résultat"); });

console.log("Questions");
const q1 = await db.collection("messages").add({ uid: alice.uid, pseudo: "Alice", type: "user", text: "@ORION comment on joue ?", createdAt: now(), hidden: false, reports: 0 });
await t("réponse de la base de connaissances", async () => {
  const r = await call({ action: "ask", messageId: q1.id }, alice.token); eq(r.status, 200, "statut");
  const m = (await db.doc(`messages/${r.body.id}`).get()).data();
  if (!/Maintiens le clic/.test(m.text) || m.replyTo.id !== q1.id || !/^@Alice/.test(m.text)) throw new Error(m.text);
});
await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {} }, { merge: true });
await t("pas de 2e réponse au même message", async () => eq((await call({ action: "ask", messageId: q1.id }, alice.token)).body.skipped, "déjà répondu", "résultat"));
await t("refus : répondre au message d'un autre", async () => eq((await call({ action: "ask", messageId: q1.id }, bob.token)).status, 403, "statut"));
await t("refus : identifiant de message invalide", async () => { await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true }); eq((await call({ action: "ask", messageId: "../users/x" }, bob.token)).status, 400, "statut"); });
const q2 = await db.collection("messages").add({ uid: bob.uid, pseudo: "Bob", type: "user", text: "orion tu connais la recette des crêpes ?", createdAt: now(), hidden: false, reports: 0 });
await t("sans IA configurée : réponse de repli", async () => {
  await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true });
  const r = await call({ action: "ask", messageId: q2.id }, bob.token);
  const m = (await db.doc(`messages/${r.body.id}`).get()).data();
  if (!/pas encore la réponse/.test(m.text)) throw new Error(m.text);
});
const q3 = await db.collection("messages").add({ uid: bob.uid, pseudo: "Bob", type: "user", text: "salut tout le monde", createdAt: now(), hidden: false, reports: 0 });
await t("ignore un message qui ne mentionne pas ORION", async () => { await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true }); eq((await call({ action: "ask", messageId: q3.id }, bob.token)).body.skipped, "ORION n'est pas mentionné", "résultat"); });

console.log("Records");
await db.doc(`scores/${bob.uid}_pro`).set({ uid: bob.uid, pseudo: "Bob", score: 9000, mode: "pro", createdAt: now() });
await db.doc(`scores/x_pro`).set({ uid: "x", pseudo: "Zed", score: 12000, mode: "pro", createdAt: now() });
await t("ORION commente le record de Bob (2e mondial)", async () => {
  await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true });
  const r = await call({ action: "record", mode: "pro" }, bob.token); eq(r.status, 200, "statut");
  const m = (await db.doc(`messages/${r.body.id}`).get()).data();
  if (!/Bob/.test(m.text) || !/2e/.test(m.text) || !/9\s?000/.test(m.text)) throw new Error(m.text);
});
await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true });
await t("pas de 2e commentaire du même record", async () => eq((await call({ action: "record", mode: "pro" }, bob.token)).body.skipped, "déjà commenté", "résultat"));
await t("refus : mode invalide", async () => { await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {} }, { merge: true }); eq((await call({ action: "record", mode: "god" }, alice.token)).status, 400, "statut"); });

console.log("Animation du canal");
await t("canal actif : pas d'animation", async () => { await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {} }, { merge: true }); eq((await call({ action: "animate" }, alice.token)).body.skipped, "canal actif", "résultat"); });
await Promise.all((await db.collection("messages").get()).docs.map((d) => d.ref.update({ createdAt: Timestamp.fromMillis(Date.now() - 3600000) })));
await db.doc("orion/state").set({ lastAnimateAt: 0 }, { merge: true });
await t("canal calme : ORION anime", async () => {
  await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {} }, { merge: true });
  const r = await call({ action: "animate" }, alice.token); eq(r.status, 200, "statut"); if (!r.body.id) throw new Error(JSON.stringify(r.body));
});
await t("une seule animation par tranche de 45 min", async () => { await db.doc(`orionLimits/${bob.uid}`).set({ lastAt: {} }, { merge: true }); eq((await call({ action: "animate" }, bob.token)).body.skipped, "animation récente", "résultat"); });

console.log("Quotas");
await t("40 appels par jour et par joueur", async () => {
  await db.doc(`orionLimits/${alice.uid}`).set({ lastAt: {}, day: new Date().toISOString().slice(0, 10), count: 40 });
  eq((await call({ action: "animate" }, alice.token)).status, 429, "statut");
});

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
