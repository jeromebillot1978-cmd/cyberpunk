/* =========================================================
   « 👥 QUI PILOTE ? » — choix du joueur sur un appareil partagé
   ---------------------------------------------------------
   Ouvert avant une partie quand plusieurs pilotes existent,
   depuis le Game Over (« Joueur suivant ») ou pour gérer
   les joueurs (menu, paramètres).
   ========================================================= */
import { openModal, closeModal, isModalOpen } from "./modal.js";
import { listProfiles, getActiveId, profileKey, MAX_PROFILES } from "./profiles.js";
import { switchProfile, addPlayer, removePlayer, openIdentity } from "./identity.js";

const $ = (id) => document.getElementById(id);
const SP = window.SunPilot;
let purpose = "manage";          // "play" : choisir puis décoller | "manage" : gérer les joueurs
let onPick = null;
let confirmId = null;            // suppression en attente de confirmation

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
function localBest(id) {
  const mode = SP.getDiff();
  try { return parseInt(localStorage.getItem(profileKey("sp_best_" + mode, id)) || "0", 10) || 0; } catch (e) { return 0; }
}

function render() {
  const list = listProfiles().filter((p) => p.pseudo);
  const active = getActiveId();
  const d = SP.DIFFICULTIES[SP.getDiff()];
  $("plTitle").textContent = purpose === "play" ? "👥 QUI PILOTE ?" : "👥 JOUEURS DE CET APPAREIL";
  $("plHint").textContent = purpose === "play"
    ? "Choisis le pilote de la prochaine partie. Chacun a ses records et son rang mondial."
    : "Chaque joueur garde son pseudo, ses records et son rang mondial.";
  const ol = $("plList"); ol.innerHTML = "";
  for (const p of list) {
    const li = document.createElement("li");
    li.className = "pl-card" + (p.id === active ? " on" : "");
    const pick = document.createElement("button");
    pick.type = "button"; pick.className = "pl-pick";
    pick.setAttribute("aria-label", `Choisir ${p.pseudo}`);
    const name = document.createElement("span"); name.className = "pl-name"; name.textContent = `👤 ${p.pseudo}`;
    if (p.id === active) { const em = document.createElement("em"); em.textContent = "ACTIF"; name.appendChild(em); }
    const rec = document.createElement("span"); rec.className = "pl-rec";
    rec.textContent = `Record ${d.emoji} ${d.label} : ${fmt(localBest(p.id))}`;
    pick.append(name, rec);
    pick.addEventListener("click", () => choose(p.id));
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "pl-icon"; edit.title = "Modifier le pseudo"; edit.textContent = "✏";
    edit.addEventListener("click", async () => { await switchProfile(p.id); await closeModal($("pilots")); openIdentity("edit"); });
    li.append(pick, edit);
    if (list.length > 1) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "pl-icon del" + (confirmId === p.id ? " confirm" : "");
      del.title = "Retirer ce joueur de cet appareil";
      del.textContent = confirmId === p.id ? "✔ ?" : "🗑";
      del.addEventListener("click", async () => {
        if (confirmId !== p.id) { confirmId = p.id; render(); return; }
        confirmId = null; await removePlayer(p.id); render();
      });
      li.append(del);
    }
    ol.appendChild(li);
  }
  const add = $("plAdd");
  const count = listProfiles().length;
  add.disabled = count >= MAX_PROFILES;
  add.textContent = count >= MAX_PROFILES ? `JOUEURS AU COMPLET (${MAX_PROFILES}/${MAX_PROFILES})` : `➕ NOUVEAU JOUEUR (${count}/${MAX_PROFILES})`;
  $("plMsg").textContent = confirmId ? "Clique sur ✔ ? pour confirmer. Le pseudo et les scores en ligne restent dans le classement." : "";
}

async function choose(id) {
  await closeModal($("pilots"));
  await switchProfile(id);
  if (purpose === "play" && onPick) onPick();
}

export function openPilots(p = "manage", cb = null) {
  purpose = p; onPick = cb; confirmId = null;
  render();
  openModal($("pilots"));
}
export const pilotCount = () => listProfiles().filter((p) => p.pseudo).length;

$("pilots").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal($("pilots")); });
$("plAdd").addEventListener("click", async () => {
  const wasPlay = purpose === "play", cb = onPick;
  await closeModal($("pilots"));
  const r = await addPlayer({
    onDone: () => { if (wasPlay && cb) cb(); },
    onCancel: () => openPilots(wasPlay ? "play" : "manage", cb),
  });
  if (!r.ok) { openPilots(purpose, cb); $("plMsg").textContent = r.msg; }
});
window.addEventListener("keydown", (e) => {
  if (isModalOpen($("pilots")) && e.key === "Escape") { e.preventDefault(); closeModal($("pilots")); }
});

window.SunPilotPilots = { open: openPilots, count: pilotCount };
