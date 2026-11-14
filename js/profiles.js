/* =========================================================
   PROFILS LOCAUX — plusieurs joueurs sur le même appareil
   ---------------------------------------------------------
   Chaque profil = un pilote avec SON compte Firebase anonyme
   (instance Firebase nommée), son pseudo, ses records locaux
   et ses records en ligne. Le profil "p0" est le joueur
   d'origine : il garde ses anciennes données sans migration.
   ========================================================= */
export const MAX_PROFILES = 4;
const LIST_KEY = "sp_profiles";
const ACTIVE_KEY = "sp_active_profile";

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/** Clé de stockage propre à un profil (p0 garde les clés historiques). */
export function profileKey(base, id = getActiveId()) {
  return id === "p0" ? base : `${base}__${id}`;
}

export function listProfiles() {
  const list = ls.get(LIST_KEY, null);
  if (Array.isArray(list) && list.length) return list;
  const first = [{ id: "p0", pseudo: null, uid: null }];
  ls.set(LIST_KEY, first);
  return first;
}
function save(list) { ls.set(LIST_KEY, list); }

export function getProfile(id = getActiveId()) {
  return listProfiles().find((p) => p.id === id) || null;
}
export function getActiveId() {
  const id = ls.get(ACTIVE_KEY, "p0");
  return listProfiles().some((p) => p.id === id) ? id : listProfiles()[0].id;
}
export function setActiveId(id) {
  if (listProfiles().some((p) => p.id === id)) ls.set(ACTIVE_KEY, id);
}

/** Met à jour les infos connues d'un profil (pseudo, uid). */
export function updateProfile(id, patch) {
  const list = listProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  save(list);
}

/** Crée un nouveau profil vide et renvoie son id (ou null si le maximum est atteint). */
export function addProfile() {
  const list = listProfiles();
  if (list.length >= MAX_PROFILES) return null;
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  list.push({ id, pseudo: null, uid: null });
  save(list);
  return id;
}

/** Retire un profil de CET appareil (ses scores en ligne restent dans le classement). */
export function removeProfile(id) {
  const list = listProfiles();
  if (list.length <= 1) return false;
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  save(next);
  // Nettoie les données locales propres à ce profil (jamais celles de p0)
  if (id !== "p0") {
    try {
      Object.keys(localStorage).filter((k) => k.endsWith(`__${id}`)).forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }
  if (getActiveId() === id || ls.get(ACTIVE_KEY, null) === id) setActiveId(next[0].id);
  return true;
}

/** Identifiants Firebase de tous les pilotes de cet appareil (badge « ICI » du classement). */
export function localUids() {
  return listProfiles().map((p) => p.uid).filter(Boolean);
}
