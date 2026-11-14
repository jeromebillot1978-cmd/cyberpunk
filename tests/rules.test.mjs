// Tests des règles Firestore (émulateur requis) :
//   cd tests && npm install && npm run test:rules
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  getDocs, getCountFromServer, serverTimestamp, writeBatch, setLogLevel,
} from "firebase/firestore";

setLogLevel("error");
const env = await initializeTestEnvironment({
  projectId: "demo-sunpilot-rules",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});
await env.clearFirestore();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "→", e.message); } }

const ctx = (uid) => env.authenticatedContext(uid).firestore();
const alice = ctx("alice"), bob = ctx("bob"), eve = ctx("eve");
const anon = env.unauthenticatedContext().firestore();
const ts = () => serverTimestamp();
const age = (path, field, ms = 60000) => env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), path), { [field]: new Date(Date.now() - ms) }));

// Crée un profil + réservation dans une même écriture groupée (comme le jeu)
function claim(db, uid, pseudo, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "users", uid), { uid, pseudo, createdAt: ts(), updatedAt: ts(), ...extra });
  b.set(doc(db, "pseudos", pseudo.toLowerCase()), { uid });
  return b.commit();
}
function rename(db, uid, oldP, newP) {
  const b = writeBatch(db);
  b.update(doc(db, "users", uid), { pseudo: newP, updatedAt: ts() });
  if (oldP.toLowerCase() !== newP.toLowerCase()) {
    b.delete(doc(db, "pseudos", oldP.toLowerCase()));
    b.set(doc(db, "pseudos", newP.toLowerCase()), { uid });
  }
  return b.commit();
}

console.log("Profils et pseudos");
await t("refus : non connecté", () => assertFails(claim(anon, "x", "Ghost")));
await t("refus : profil sans réservation du pseudo", () => assertFails(setDoc(doc(alice, "users/alice"), { uid: "alice", pseudo: "JERCAT", createdAt: ts(), updatedAt: ts() })));
await t("refus : réservation sans profil", () => assertFails(setDoc(doc(alice, "pseudos/jercat"), { uid: "alice" })));
await t("refus : pseudo trop court (2)", () => assertFails(claim(alice, "alice", "AB")));
await t("refus : pseudo trop long (16)", () => assertFails(claim(alice, "alice", "ABCDEFGHIJKLMNOP")));
await t("refus : espace", () => assertFails(claim(alice, "alice", "Jer cat")));
await t("refus : accent", () => assertFails(claim(alice, "alice", "Jérôme")));
await t("refus : emoji", () => assertFails(claim(alice, "alice", "Pilot🚀")));
await t("refus : HTML", () => assertFails(claim(alice, "alice", "<script>x")));
await t("refus : faux UID (profil d'un autre)", () => assertFails(claim(alice, "bob", "Faker")));
await t("refus : champ uid falsifié", () => assertFails(claim(alice, "alice", "Faker", { uid: "bob" })));
await t("refus : champ en trop", () => assertFails(claim(alice, "alice", "Faker", { admin: true })));
await t("accepté : création JERCAT", () => assertSucceeds(claim(alice, "alice", "JERCAT")));
await t("lecture de son profil", () => assertSucceeds(getDoc(doc(alice, "users/alice"))));
await t("refus : lire le profil d'un autre", () => assertFails(getDoc(doc(bob, "users/alice"))));
await t("refus : lister les profils", () => assertFails(getDocs(collection(bob, "users"))));
await t("vérifier qu'un pseudo est pris (lecture publique)", async () => { const s = await assertSucceeds(getDoc(doc(anon, "pseudos/jercat"))); if (!s.exists()) throw new Error("absent"); });
await t("refus : pseudo déjà pris (même casse)", () => assertFails(claim(bob, "bob", "JERCAT")));
await t("refus : pseudo déjà pris (autre casse)", () => assertFails(claim(bob, "bob", "jercat")));
await t("refus : voler la réservation d'un autre", () => assertFails(setDoc(doc(bob, "pseudos/jercat"), { uid: "bob" })));
await t("refus : supprimer la réservation d'un autre", () => assertFails(deleteDoc(doc(bob, "pseudos/jercat"))));
await t("refus : modifier le profil d'un autre", () => assertFails(updateDoc(doc(bob, "users/alice"), { pseudo: "Hacked", updatedAt: ts() })));
await t("accepté : bob crée Neo_Pilot-02", () => assertSucceeds(claim(bob, "bob", "Neo_Pilot-02")));
await t("refus : changement de pseudo trop rapide (< 10 s)", () => assertFails(rename(alice, "alice", "JERCAT", "Jercat2")));
await age("users/alice", "updatedAt");
await t("refus : changer de pseudo sans libérer l'ancien", async () => {
  const b = writeBatch(alice);
  b.update(doc(alice, "users/alice"), { pseudo: "Squatter", updatedAt: ts() });
  b.set(doc(alice, "pseudos/squatter"), { uid: "alice" });
  await assertFails(b.commit());
});
await t("refus : prendre le pseudo de bob en renommant", () => assertFails(rename(alice, "alice", "JERCAT", "neo_pilot-02")));
await t("refus : modifier createdAt", () => assertFails(updateDoc(doc(alice, "users/alice"), { pseudo: "Jercat2", createdAt: ts(), updatedAt: ts() })));
await t("accepté : renommer JERCAT → Jercat_Pro", () => assertSucceeds(rename(alice, "alice", "JERCAT", "Jercat_Pro")));
await t("l'ancien pseudo est libéré", async () => { const s = await getDoc(doc(anon, "pseudos/jercat")); if (s.exists()) throw new Error("toujours réservé"); });
await age("users/alice", "updatedAt");
await t("accepté : changer seulement la casse (Jercat_Pro → JERCAT_PRO)", () => assertSucceeds(rename(alice, "alice", "Jercat_Pro", "JERCAT_PRO")));
await t("accepté : eve reprend le pseudo libéré JERCAT", () => assertSucceeds(claim(eve, "eve", "JERCAT")));
await t("refus : supprimer son profil", () => assertFails(deleteDoc(doc(alice, "users/alice"))));

console.log("Scores");
const good = (uid, pseudo, over = {}) => ({ uid, pseudo, score: 1500, mode: "pro", bitcoins: 30, distance: 900, level: 3, createdAt: ts(), ...over });
await t("accepté : score avec le pseudo du profil", () => assertSucceeds(setDoc(doc(alice, "scores/alice_pro"), good("alice", "JERCAT_PRO"))));
await t("refus : score avec un autre pseudo", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", "JERCAT_PRO"))));
await t("refus : score sans profil", () => assertFails(setDoc(doc(ctx("zed"), "scores/zed_pro"), good("zed", "Zed123"))));
await t("refus : écrire le score d'un autre", () => assertFails(setDoc(doc(bob, "scores/alice_beginner"), good("alice", "JERCAT_PRO", { mode: "beginner" }))));
await t("refus : id ne correspond pas (doublon)", () => assertFails(setDoc(doc(bob, "scores/bob_pro2"), good("bob", "Neo_Pilot-02"))));
await t("refus : score impossible", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", "Neo_Pilot-02", { score: 999999, distance: 10, bitcoins: 0 }))));
await t("refus : date fournie par le client", () => assertFails(setDoc(doc(bob, "scores/bob_pro"), good("bob", "Neo_Pilot-02", { createdAt: new Date() }))));
await t("refus : nouveau record trop tôt (< 10 s)", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", "JERCAT_PRO", { score: 1600 }))));
await age("scores/alice_pro", "createdAt");
await t("refus : score inférieur (pas d'écrasement)", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", "JERCAT_PRO", { score: 1400 }))));
await t("refus : score égal", () => assertFails(setDoc(doc(alice, "scores/alice_pro"), good("alice", "JERCAT_PRO", { score: 1500 }))));
await t("accepté : nouveau record supérieur", () => assertSucceeds(setDoc(doc(alice, "scores/alice_pro"), good("alice", "JERCAT_PRO", { score: 1800, distance: 1000 }))));
await t("refus : modifier le score d'un autre", () => assertFails(updateDoc(doc(bob, "scores/alice_pro"), { score: 9000, createdAt: ts() })));
// Propagation du pseudo après un renommage (immédiate, sans attendre 10 s)
await age("users/alice", "updatedAt");
await rename(alice, "alice", "JERCAT_PRO", "Alice_X");
await t("accepté : propagation du nouveau pseudo au score", () => assertSucceeds(updateDoc(doc(alice, "scores/alice_pro"), { pseudo: "Alice_X", createdAt: ts() })));
await t("refus : propagation d'un pseudo qui n'est pas le sien", () => assertFails(updateDoc(doc(alice, "scores/alice_pro"), { pseudo: "Neo_Pilot-02", createdAt: ts() })));
await t("refus : suppression d'un score", () => assertFails(deleteDoc(doc(alice, "scores/alice_pro"))));

console.log("Lecture");
const top = query(collection(anon, "scores"), where("mode", "==", "pro"), orderBy("score", "desc"), limit(10));
await t("top 10 public", () => assertSucceeds(getDocs(top)));
await t("refus : liste sans limite", () => assertFails(getDocs(query(collection(anon, "scores"), where("mode", "==", "pro")))));
await t("refus : lister les pseudos", () => assertFails(getDocs(query(collection(anon, "pseudos"), limit(10)))));
const rankQ = query(collection(anon, "scores"), where("mode", "==", "pro"), where("score", ">", 100), orderBy("score", "desc"), limit(1000));
await t("rang mondial (count)", async () => { const s = await assertSucceeds(getCountFromServer(rankQ)); if (s.data().count !== 1) throw new Error("count=" + s.data().count); });
await t("refus : écriture hors collections prévues", () => assertFails(setDoc(doc(alice, "admin/x"), { a: 1 })));

console.log(`\n${pass} réussis, ${fail} échoués`);
await env.cleanup();
process.exit(fail ? 1 : 0);
