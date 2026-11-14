// Tests des règles Firestore (émulateur requis) :
//   firebase emulators:exec --only firestore "node tests/rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, getCountFromServer, serverTimestamp, setLogLevel } from "firebase/firestore";

setLogLevel("error");
const env = await initializeTestEnvironment({
  projectId: "demo-sunpilot-rules",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});
await env.clearFirestore();   // base vide à chaque lancement
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "→", e.message); } }
const good = (uid, over = {}) => ({ uid, pseudo: "Jercat", score: 1500, mode: "pro", bitcoins: 30, distance: 900, level: 3, createdAt: serverTimestamp(), ...over });

const alice = env.authenticatedContext("alice").firestore();
const bob = env.authenticatedContext("bob").firestore();
const anon = env.unauthenticatedContext().firestore();

console.log("Création");
await t("joueur connecté crée SON score (id uid_mode)", () => assertSucceeds(setDoc(doc(alice, "scores/alice_pro"), good("alice"))));
await t("refus : non connecté", () => assertFails(setDoc(doc(anon, "scores/x_pro"), good("x"))));
await t("refus : id ne correspond pas (doublon)", () => assertFails(setDoc(doc(alice, "scores/alice_pro2"), good("alice"))));
await t("refus : id d'un autre mode", () => assertFails(setDoc(doc(alice, "scores/alice_beginner"), good("alice"))));
await t("refus : écrire pour un autre joueur", () => assertFails(setDoc(doc(bob, "scores/alice_beginner"), good("alice", { mode: "beginner" }))));
await t("refus : uid falsifié", () => assertFails(setDoc(doc(bob, "scores/bob_beginner"), good("alice", { mode: "beginner" }))));
await t("refus : mode inconnu", () => assertFails(setDoc(doc(bob, "scores/bob_god"), good("bob", { mode: "god" }))));
await t("refus : score non entier", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", { score: 12.5 }))));
await t("refus : score impossible (incohérent)", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", { score: 999999, distance: 10, bitcoins: 0 }))));
await t("refus : champ en trop", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), { ...good("bob"), admin: true })));
await t("refus : pseudo avec HTML", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", { pseudo: "<b>x</b>" }))));
await t("accepté : pseudo accentué", () => assertSucceeds(setDoc(doc(bob, "scores/bob_intermediate"), good("bob", { mode: "intermediate", pseudo: "Jérôme_02" }))));
await t("refus : date fournie par le client", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", { createdAt: new Date() }))));

console.log("Mise à jour");
await t("refus : nouveau record trop tôt (< 10 s, anti-spam)", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", { score: 1600 }))));
// on vieillit le document pour tester la suite
await env.withSecurityRulesDisabled(async (c) => {
  const old = new Date(Date.now() - 60000);
  await setDoc(doc(c.firestore(), "scores/alice_pro"), { ...good("alice"), createdAt: old });
});
await t("refus : score inférieur au record (pas d'écrasement)", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", { score: 1400 }))));
await t("refus : score égal au record", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", { score: 1500 }))));
await t("refus : un autre joueur modifie le score", () => assertFails(updateDoc(doc(bob, "scores/alice_pro"), { score: 1700, createdAt: serverTimestamp() })));
await t("refus : changer de mode", () => assertFails(updateDoc(doc(alice, "scores/alice_pro"), { mode: "beginner", score: 1700, createdAt: serverTimestamp() })));
await t("accepté : changement de pseudo seul", () => assertSucceeds(updateDoc(doc(alice, "scores/alice_pro"), { pseudo: "Neo Pilot", createdAt: serverTimestamp() })));
await env.withSecurityRulesDisabled(async (c) => {
  await updateDoc(doc(c.firestore(), "scores/alice_pro"), { createdAt: new Date(Date.now() - 60000) });
});
await t("refus : pseudo + baisse de score déguisée", () => assertFails(updateDoc(doc(alice, "scores/alice_pro"), { pseudo: "X1", score: 10, createdAt: serverTimestamp() })));
await t("accepté : nouveau record supérieur", () => assertSucceeds(setDoc(doc(alice, "scores/alice_pro"), good("alice", { score: 1800, distance: 1000 }))));
await t("refus : suppression", () => assertFails(deleteDoc(doc(alice, "scores/alice_pro"))));

console.log("Lecture");
await t("lecture publique d'un score", () => assertSucceeds(getDoc(doc(anon, "scores/alice_pro"))));
const top = query(collection(anon, "scores"), where("mode", "==", "pro"), orderBy("score", "desc"), limit(10));
await t("top 10 public", () => assertSucceeds(getDocs(top)));
await t("refus : liste sans limite (aspiration)", () => assertFails(getDocs(query(collection(anon, "scores"), where("mode", "==", "pro")))));
await t("refus : limite > 1000", () => assertFails(getDocs(query(collection(anon, "scores"), limit(5000)))));
const rankQ = query(collection(anon, "scores"), where("mode", "==", "pro"), where("score", ">", 100), orderBy("score", "desc"), limit(1000));
await t("rang mondial (count limité à 1000)", async () => { const s = await assertSucceeds(getCountFromServer(rankQ)); if (s.data().count !== 1) throw new Error("count=" + s.data().count); });
await t("refus : écriture hors collection scores", () => assertFails(setDoc(doc(alice, "admin/x"), { a: 1 })));

console.log(`\n${pass} réussis, ${fail} échoués`);
await env.cleanup();
process.exit(fail ? 1 : 0);
