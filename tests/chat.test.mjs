// Tests de sécurité du Canal des Pilotes (émulateur requis) :
//   cd tests && npm install && npm run test:rules
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  getDocs, getCountFromServer, serverTimestamp, writeBatch, setLogLevel, Timestamp, increment,
} from "firebase/firestore";

setLogLevel("error");
const env = await initializeTestEnvironment({
  projectId: "demo-sunpilot-chat",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});
await env.clearFirestore();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "→", e.message); } }

const ctx = (uid) => env.authenticatedContext(uid).firestore();
const alice = ctx("alice"), bob = ctx("bob"), eve = ctx("eve"), carl = ctx("carl"), dan = ctx("dan"), mod = ctx("mod"), ban = ctx("banned");
const anon = env.unauthenticatedContext().firestore();
const ts = () => serverTimestamp();
const EPOCH = Timestamp.fromMillis(0);
const admin = (fn) => env.withSecurityRulesDisabled((c) => fn(c.firestore()));
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);

// ---------- Données de départ (règles désactivées) ----------
await admin(async (db) => {
  for (const [uid, pseudo] of [["alice", "Alice"], ["bob", "Bob_01"], ["eve", "Eve"], ["carl", "Carl"], ["dan", "Dan"], ["mod", "Modo"], ["banned", "Troll"]]) {
    await setDoc(doc(db, "users", uid), { uid, pseudo, createdAt: ago(86400000), updatedAt: ago(86400000) });
    await setDoc(doc(db, "pseudos", pseudo.toLowerCase()), { uid });
  }
  await setDoc(doc(db, "moderators", "mod"), { since: ago(1000) });
  await setDoc(doc(db, "bans", "banned"), { uid: "banned", pseudo: "Troll", reason: "test", by: "mod", createdAt: ago(1000) });
  await setDoc(doc(db, "scores", "alice_pro"), { uid: "alice", pseudo: "Alice", score: 5000, mode: "pro", bitcoins: 10, distance: 500, level: 3, createdAt: ago(30000), v: 2 });
  await setDoc(doc(db, "scores", "bob_pro"), { uid: "bob", pseudo: "Bob_01", score: 4000, mode: "pro", bitcoins: 10, distance: 500, level: 3, createdAt: ago(3600000), v: 2 });
});

// ---------- Aides : mêmes écritures groupées que js/chat.js ----------
function initialState(uid, extra = {}) {
  return { uid, createdAt: ts(), welcomedAt: ts(), lastMsgAt: EPOCH, lastMsgId: "", winStart: EPOCH, winCount: 0, joinedAt: ts(), leftAt: EPOCH, recordAt: EPOCH, ...extra };
}
function enter(db, uid, pseudo, { msg = {}, state = {} } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "chatState", uid), initialState(uid, state));
  b.set(doc(collection(db, "messages")), { uid, pseudo, type: "welcome", createdAt: ts(), hidden: false, reports: 0, ...msg });
  return b.commit();
}
// Envoi d'un message : nouvelle fenêtre (reset) ou +1 dans la fenêtre en cours
function send(db, uid, pseudo, text, { reset = true, count = 1, msg = {}, state = {}, id } = {}) {
  const ref = id ? doc(db, "messages", id) : doc(collection(db, "messages"));
  const b = writeBatch(db);
  b.set(ref, { uid, pseudo, type: "user", text, createdAt: ts(), hidden: false, reports: 0, ...msg });
  b.update(doc(db, "chatState", uid), { lastMsgAt: ts(), lastMsgId: ref.id, ...(reset ? { winStart: ts(), winCount: 1 } : { winCount: count }), ...state });
  return b.commit().then(() => ref);
}
const ageState = (uid, fields) => admin((db) => updateDoc(doc(db, "chatState", uid), fields));
const coolDown = (uid) => ageState(uid, { lastMsgAt: ago(5000) });
const newWindow = (uid) => ageState(uid, { lastMsgAt: ago(61000), winStart: ago(61000) });
function sys(db, uid, pseudo, type, field, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(collection(db, "messages")), { uid, pseudo, type, createdAt: ts(), hidden: false, reports: 0, ...extra });
  b.update(doc(db, "chatState", uid), { [field]: ts() });
  return b.commit();
}
function report(db, uid, msgId, { reason = "insulte", hide = false, log = false, reports } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "reports", `${msgId}_${uid}`), { messageId: msgId, reporterUid: uid, authorUid: "alice", reason, createdAt: ts() });
  b.update(doc(db, "messages", msgId), { reports: reports ?? increment(1), hidden: hide });
  if (log) b.set(doc(db, "moderation", `autohide_${msgId}`), { action: "auto_hide", messageId: msgId, reports: 3, by: uid, createdAt: ts() });
  return b.commit();
}
const visible = (db, n = 40) => query(collection(db, "messages"), where("hidden", "==", false), orderBy("createdAt", "desc"), limit(n));

console.log("Arrivée dans le canal");
await t("refus : non connecté", () => assertFails(enter(anon, "x", "Ghost")));
await t("refus : état sans message de bienvenue (compteurs truqués)", () => assertFails(setDoc(doc(alice, "chatState/alice"), initialState("alice", { winCount: 5 }))));
await t("refus : bienvenue au nom d'un autre pseudo", () => assertFails(enter(alice, "alice", "Bob_01")));
await t("refus : état d'un autre joueur", () => assertFails(enter(alice, "bob", "Bob_01")));
await t("refus : pilote exclu", () => assertFails(enter(ban, "banned", "Troll")));
await t("accepté : Alice arrive (Bienvenue à bord)", () => assertSucceeds(enter(alice, "alice", "Alice")));
await t("refus : deuxième bienvenue", () => assertFails(enter(alice, "alice", "Alice")));
await t("refus : lire l'état anti-spam d'un autre", () => assertFails(getDoc(doc(bob, "chatState/alice"))));
await t("accepté : Bob, Eve, Carl, Dan et le modérateur arrivent", async () => {
  await assertSucceeds(enter(bob, "bob", "Bob_01")); await assertSucceeds(enter(eve, "eve", "Eve"));
  await assertSucceeds(enter(carl, "carl", "Carl")); await assertSucceeds(enter(dan, "dan", "Dan"));
  await assertSucceeds(enter(mod, "mod", "Modo"));
});

console.log("Envoi de messages et anti-spam");
await t("accepté : premier message après l'arrivée", () => assertSucceeds(send(alice, "alice", "Alice", "Salut les pilotes !")));
await t("refus : second message moins de 4 s après", () => assertFails(send(alice, "alice", "Alice", "Encore moi", { reset: false, count: 2 })));
await coolDown("alice");
await t("accepté : message suivant après 4 s (+1 dans la fenêtre)", () => assertSucceeds(send(alice, "alice", "Alice", "Prête pour le Pro ?", { reset: false, count: 2 })));
await coolDown("alice");
await t("refus : remettre la fenêtre à zéro avant 60 s", () => assertFails(send(alice, "alice", "Alice", "Je triche", { reset: true })));
await t("refus : compteur qui n'augmente pas", () => assertFails(send(alice, "alice", "Alice", "Je triche", { reset: false, count: 2 })));
await t("refus : compteur qui saute", () => assertFails(send(alice, "alice", "Alice", "Je triche", { reset: false, count: 5 })));
for (let i = 3; i <= 6; i++) { await coolDown("alice"); await assertSucceeds(send(alice, "alice", "Alice", `Message ${i}`, { reset: false, count: i })); }
await coolDown("alice");
await t("refus : 7e message dans la même minute", () => assertFails(send(alice, "alice", "Alice", "Message 7", { reset: false, count: 7 })));
await newWindow("alice");
await t("accepté : nouvelle minute, compteur remis à 1", () => assertSucceeds(send(alice, "alice", "Alice", "Nouvelle minute")));
await newWindow("alice");
await t("refus : message sans mise à jour de l'état anti-spam", () => assertFails(setDoc(doc(collection(alice, "messages")), { uid: "alice", pseudo: "Alice", type: "user", text: "Contournement", createdAt: ts(), hidden: false, reports: 0 })));
await t("refus : lastMsgId différent de l'identifiant du message", async () => {
  const b = writeBatch(alice); const ref = doc(collection(alice, "messages"));
  b.set(ref, { uid: "alice", pseudo: "Alice", type: "user", text: "Bonjour", createdAt: ts(), hidden: false, reports: 0 });
  b.update(doc(alice, "chatState/alice"), { lastMsgAt: ts(), lastMsgId: "autre", winStart: ts(), winCount: 1 });
  await assertFails(b.commit());
});
await t("refus : message au nom d'un autre (uid)", () => assertFails(send(alice, "alice", "Alice", "Coucou", { msg: { uid: "bob" } })));
await t("refus : pseudo usurpé", () => assertFails(send(alice, "alice", "Alice", "Coucou", { msg: { pseudo: "Bob_01" } })));
await t("refus : date falsifiée", () => assertFails(send(alice, "alice", "Alice", "Coucou", { msg: { createdAt: ago(3600000) } })));
await t("refus : message déjà masqué ou avec signalements", () => assertFails(send(alice, "alice", "Alice", "Coucou", { msg: { reports: 2 } })));
await t("refus : champ en trop", () => assertFails(send(alice, "alice", "Alice", "Coucou", { msg: { admin: true } })));
await t("refus : se faire passer pour ORION", () => assertFails(send(alice, "alice", "Alice", "Je suis l'IA", { msg: { type: "orion" } })));
await t("refus : message système inventé", () => assertFails(send(alice, "alice", "Alice", "x", { msg: { type: "system" } })));

console.log("Validation du texte");
for (const [name, text] of [
  ["vide", ""], ["uniquement des espaces", "     "], ["281 caractères", "a".repeat(281)], ["caractère de contrôle", "salut\u0007"],
  ["retour à la ligne", "ligne 1\nligne 2"], ["lien https", "va sur https://arnaque.example"], ["lien www", "www.arnaque.fr"],
  ["invitation Discord", "rejoins discord.gg/abc"], ["insulte", "t'es un connard"], ["insulte en majuscules", "SALOPE"],
  ["insulte au milieu", "bien joué fdp lol"], ["propos haineux", "sale arabe"], ["nombre au lieu d'un texte", 42],
]) await t(`refus : texte ${name}`, () => assertFails(send(alice, "alice", "Alice", text)));
await t("accepté : 280 caractères", () => assertSucceeds(send(alice, "alice", "Alice", "é".repeat(280))));
await newWindow("alice");
await t("accepté : mots proches d'insultes (député, disputé, réputation)", () => assertSucceeds(send(alice, "alice", "Alice", "Le député a disputé sa réputation au Pro 🚀")));
await newWindow("alice");

console.log("Lecture");
let aliceMsg;
await t("lecture publique des messages visibles (limite 40)", async () => { const s = await assertSucceeds(getDocs(visible(anon))); if (s.size < 5) throw new Error("trop peu de messages : " + s.size); });
await t("refus : liste sans filtre « visible »", () => assertFails(getDocs(query(collection(anon, "messages"), orderBy("createdAt", "desc"), limit(10)))));
await t("refus : liste sans limite", () => assertFails(getDocs(query(collection(anon, "messages"), where("hidden", "==", false), orderBy("createdAt", "desc")))));
await t("refus : liste de plus de 50 messages", () => assertFails(getDocs(visible(anon, 51))));

console.log("Modification et suppression");
await t("accepté : Alice envoie un message", async () => { aliceMsg = await assertSucceeds(send(alice, "alice", "Alice", "Mon record arrive !")); });
await t("accepté : Alice corrige son message", () => assertSucceeds(updateDoc(doc(alice, "messages", aliceMsg.id), { text: "Mon record arrive bientôt !", editedAt: ts() })));
await t("refus : correction avec un mot interdit", () => assertFails(updateDoc(doc(alice, "messages", aliceMsg.id), { text: "connard", editedAt: ts() })));
await t("refus : modifier le pseudo de son message", () => assertFails(updateDoc(doc(alice, "messages", aliceMsg.id), { pseudo: "Bob_01" })));
await t("refus : Bob modifie le message d'Alice", () => assertFails(updateDoc(doc(bob, "messages", aliceMsg.id), { text: "piraté", editedAt: ts() })));
await t("refus : Bob supprime le message d'Alice", () => assertFails(deleteDoc(doc(bob, "messages", aliceMsg.id))));
await admin((db) => updateDoc(doc(db, "messages", aliceMsg.id), { createdAt: ago(11 * 60000) }));
await t("refus : correction après 10 min", () => assertFails(updateDoc(doc(alice, "messages", aliceMsg.id), { text: "trop tard", editedAt: ts() })));
await t("accepté : Alice supprime son message", () => assertSucceeds(deleteDoc(doc(alice, "messages", aliceMsg.id))));

console.log("Signalements et masquage automatique");
let target;
await newWindow("alice");
await t("accepté : Alice envoie le message qui sera signalé", async () => { target = await assertSucceeds(send(alice, "alice", "Alice", "Message limite")); });
await t("refus : se signaler soi-même", () => assertFails(report(alice, "alice", target.id)));
await t("refus : signalement sans compteur +1", async () => {
  await assertFails(setDoc(doc(bob, "reports", `${target.id}_bob`), { messageId: target.id, reporterUid: "bob", authorUid: "alice", reason: "spam", createdAt: ts() }));
});
await t("refus : +1 sans signalement", () => assertFails(updateDoc(doc(bob, "messages", target.id), { reports: 1, hidden: false })));
await t("refus : motif inconnu", () => assertFails(report(bob, "bob", target.id, { reason: "pas content" })));
await t("refus : masquer dès le 1er signalement", () => assertFails(report(bob, "bob", target.id, { hide: true })));
await t("accepté : Bob signale (1/3)", () => assertSucceeds(report(bob, "bob", target.id)));
await t("refus : Bob signale une 2e fois", () => assertFails(report(bob, "bob", target.id)));
await t("refus : sauter de 1 à 3", () => assertFails(report(eve, "eve", target.id, { reports: 3, hide: true })));
await t("accepté : Eve signale (2/3)", () => assertSucceeds(report(eve, "eve", target.id)));
await t("refus : 3e signalement sans masquage", () => assertFails(report(carl, "carl", target.id)));
await t("accepté : Carl signale (3/3) → masqué et journalisé", () => assertSucceeds(report(carl, "carl", target.id, { hide: true, log: true })));
await t("le message masqué n'est plus lisible", () => assertFails(getDoc(doc(anon, "messages", target.id))));
await t("refus : signaler un message déjà masqué", () => assertFails(report(dan, "dan", target.id, { hide: true })));
await t("refus : un joueur lit les signalements", () => assertFails(getDoc(doc(bob, "reports", `${target.id}_bob`))));
await t("refus : un joueur lit le journal de modération", () => assertFails(getDoc(doc(bob, "moderation", `autohide_${target.id}`))));
await t("refus : faux journal de masquage", () => assertFails(setDoc(doc(bob, "moderation", "autohide_x"), { action: "auto_hide", messageId: "x", reports: 3, by: "bob", createdAt: ts() })));

console.log("Modération");
await t("le modérateur lit le message masqué", () => assertSucceeds(getDoc(doc(mod, "messages", target.id))));
await t("le modérateur lit les signalements", () => assertSucceeds(getDoc(doc(mod, "reports", `${target.id}_bob`))));
await t("le modérateur réaffiche le message", () => assertSucceeds(updateDoc(doc(mod, "messages", target.id), { hidden: false, moderatedBy: "mod", moderatedAt: ts() })));
await t("le modérateur supprime le message", () => assertSucceeds(deleteDoc(doc(mod, "messages", target.id))));
await t("refus : un joueur se nomme modérateur", () => assertFails(setDoc(doc(bob, "moderators", "bob"), { since: ts() })));
await t("refus : un joueur exclut un autre joueur", () => assertFails(setDoc(doc(bob, "bans", "eve"), { uid: "eve", pseudo: "Eve", reason: "x", by: "bob", createdAt: ts() })));
await t("le modérateur exclut Dan", () => assertSucceeds(setDoc(doc(mod, "bans", "dan"), { uid: "dan", pseudo: "Dan", reason: "spam", by: "mod", createdAt: ts() })));
await t("refus : Dan exclu ne peut plus écrire", () => assertFails(send(dan, "dan", "Dan", "Je reviens")));
await t("refus : exclure un modérateur", () => assertFails(setDoc(doc(mod, "bans", "mod"), { uid: "mod", pseudo: "Modo", reason: "x", by: "mod", createdAt: ts() })));

console.log("Messages système");
await t("refus : « a rejoint » moins de 10 min après l'arrivée", () => assertFails(sys(bob, "bob", "Bob_01", "join", "joinedAt")));
await ageState("bob", { joinedAt: ago(11 * 60000) });
await t("accepté : « a rejoint » après 10 min", () => assertSucceeds(sys(bob, "bob", "Bob_01", "join", "joinedAt")));
await t("refus : « a rejoint » deux fois de suite", () => assertFails(sys(bob, "bob", "Bob_01", "join", "joinedAt")));
await t("accepté : « a quitté »", () => assertSucceeds(sys(bob, "bob", "Bob_01", "leave", "leftAt")));
await t("refus : « a quitté » deux fois", () => assertFails(sys(bob, "bob", "Bob_01", "leave", "leftAt")));
await t("refus : record jamais enregistré (Bob, score inventé)", () => assertFails(sys(bob, "bob", "Bob_01", "record", "recordAt", { mode: "pro", score: 999999 })));
await t("refus : record trop ancien (Bob, 1 h)", () => assertFails(sys(bob, "bob", "Bob_01", "record", "recordAt", { mode: "pro", score: 4000 })));
await t("refus : record avec un autre score que l'enregistré", () => assertFails(sys(alice, "alice", "Alice", "record", "recordAt", { mode: "pro", score: 6000 })));
await t("accepté : record réel d'Alice", () => assertSucceeds(sys(alice, "alice", "Alice", "record", "recordAt", { mode: "pro", score: 5000 })));
await t("refus : deuxième annonce de record dans les 10 min", () => assertFails(sys(alice, "alice", "Alice", "record", "recordAt", { mode: "pro", score: 5000 })));
await t("refus : supprimer un message système", async () => {
  const s = await getDocs(query(collection(alice, "messages"), where("hidden", "==", false), orderBy("createdAt", "desc"), limit(1)));
  await assertFails(deleteDoc(doc(alice, "messages", s.docs[0].id)));
});

console.log("Présence");
await t("accepté : Alice signale sa présence", () => assertSucceeds(setDoc(doc(alice, "presence/alice"), { uid: "alice", pseudo: "Alice", lastSeen: ts() })));
await t("refus : signal de vie moins de 30 s après", () => assertFails(setDoc(doc(alice, "presence/alice"), { uid: "alice", pseudo: "Alice", lastSeen: ts() })));
await admin((db) => updateDoc(doc(db, "presence", "alice"), { lastSeen: ago(31000) }));
await t("accepté : signal de vie après 30 s", () => assertSucceeds(setDoc(doc(alice, "presence/alice"), { uid: "alice", pseudo: "Alice", lastSeen: ts() })));
await t("refus : présence au nom d'un autre", () => assertFails(setDoc(doc(alice, "presence/bob"), { uid: "bob", pseudo: "Bob_01", lastSeen: ts() })));
await t("refus : présence avec un faux pseudo", () => assertFails(setDoc(doc(bob, "presence/bob"), { uid: "bob", pseudo: "Alice", lastSeen: ts() })));
await t("refus : date de présence falsifiée", () => assertFails(setDoc(doc(bob, "presence/bob"), { uid: "bob", pseudo: "Bob_01", lastSeen: Timestamp.fromMillis(Date.now() + 3600000) })));
await t("comptage des pilotes présents", async () => {
  const q = query(collection(anon, "presence"), where("lastSeen", ">", ago(150000)), limit(1000));
  const n = (await assertSucceeds(getCountFromServer(q))).data().count; if (n !== 1) throw new Error("compte : " + n);
});
await t("refus : liste de présence sans limite", () => assertFails(getDocs(collection(anon, "presence"))));

console.log("Données d'ORION (serveur uniquement)");
await t("refus : lire l'état d'ORION", () => assertFails(getDoc(doc(alice, "orion/state"))));
await t("refus : écrire dans les quotas d'ORION", () => assertFails(setDoc(doc(alice, "orionLimits/alice"), { dayCount: 0 })));

console.log(`\n${pass} réussis, ${fail} échoués`);
await env.cleanup();
process.exit(fail ? 1 : 0);
