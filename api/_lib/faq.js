/* =========================================================
   ORION — base de connaissances de Sun Pilot · Neon Skies
   Réponses directes aux questions fréquentes (sans IA, gratuites,
   instantanées). Les mêmes faits servent de contexte au modèle
   d'IA pour les questions plus libres.
   ========================================================= */

export const GAME_FACTS = `
Sun Pilot · Neon Skies est un jeu web cyberpunk : on pilote une montgolfière dans une ville néon et on ramasse des Bitcoins.
Commandes : maintenir le clic, la touche Espace ou le doigt sur l'écran pour monter ; relâcher pour redescendre.
Raccourcis : 1, 2, 3 = difficulté ; P ou Échap = pause ; M = son ; L = classement ; C = Canal des Pilotes ; O = paramètres.
Difficultés : Débutant (score ×0,3, bouclier au départ, trajectoire affichée, mini-aimant), Intermédiaire (score ×1,5, équilibré), Pro (score ×5, vitesse +60 %, drones chasseurs, plafond électrifié, aucune aide).
Une partie est comptée dans le mode le plus facile utilisé pendant la partie.
Obstacles : pylônes électriques (passer par l'ouverture), drones (contourner), hologrammes (faire le tour), câbles 20 kV (passer dessous), hover-cars (alerte rouge à droite, changer de hauteur), doubles drones, combos.
Bonus : Bouclier (encaisse un choc), Aimant (attire les Bitcoins proches), Turbo (invincible, pulvérise drones, hologrammes et voitures).
Score : il vient de la distance parcourue et des Bitcoins, multiplié selon la difficulté.
Classement mondial : top 10 par difficulté, rang mondial, seul le meilleur score de chaque pilote par mode est gardé. Un record en ligne est enregistré quand on bat son propre record.
Pseudo : obligatoire, 3 à 15 caractères (lettres sans accent, chiffres, _ et -), unique, modifiable dans les paramètres (⚙).
Plusieurs joueurs peuvent partager un appareil : jusqu'à 4 pilotes, chacun avec son pseudo et ses records (bouton 👥).
Canal des Pilotes : 4 secondes entre deux messages, 6 messages par minute, 280 caractères, pas de liens ni d'insultes ; ⚑ pour signaler, un message signalé 3 fois est masqué ; on peut corriger son message pendant 10 minutes et le supprimer.
`.trim();

/** Questions fréquentes : motif de reconnaissance → réponse courte (≤ 280 caractères). */
const FAQ = [
  [/(comment|comme)\s+(on\s+)?(jou|monte|vole|pilot|contr[oô]l)|commandes?|touches?\b/i,
    "Maintiens le clic, Espace ou ton doigt pour monter, relâche pour redescendre. Raccourcis : 1-2-3 difficulté, P pause, M son, L classement, C canal. 🎈"],
  [/(difficult|mode|d[ée]butant|interm[ée]diaire|\bpro\b|multiplicateur|×|x5|x1)/i,
    "3 modes : 🟢 Débutant (score ×0,3, aides à fond), 🟡 Intermédiaire (×1,5, équilibré), 🔴 Pro (×5, vitesse +60 %, drones chasseurs, aucune aide). Le Pro rapporte le plus… si tu survis. 😈"],
  [/(bonus|bouclier|aimant|turbo|power)/i,
    "🛡 Bouclier : encaisse un choc. 🧲 Aimant : attire les Bitcoins. ⚡ Turbo : invincible, tu pulvérises drones, hologrammes et voitures. En Pro, ils sont rares et plus courts."],
  [/(score|points?|calcul|bitcoin|₿|btc)/i,
    "Ton score vient de la distance et des Bitcoins ramassés, multiplié par la difficulté (×0,3, ×1,5 ou ×5). Ramasse un max de ₿ sans ralentir !"],
  [/(classement|rang|top\s?10|record|leaderboard|mondial)/i,
    "Le classement garde ton meilleur score par difficulté. Bats ton record pour l'envoyer en ligne et voir ton rang mondial (touche L). Top 10 = annonce dans le canal ! 🏆"],
  [/(pseudo|nom|changer.*(pseudo|nom)|renomm)/i,
    "Ton pseudo (3 à 15 caractères, sans accent) se change dans ⚙ Paramètres → Modifier mon pseudo. Il est remplacé partout, classement compris."],
  [/(plusieurs|deux|2)\s+(joueurs?|pilotes?)|appareil|partag|famille|fr[eè]re|s[oœ]ur/i,
    "Jusqu'à 4 pilotes par appareil, chacun avec son pseudo et ses records : bouton 👥 sur l'écran d'accueil ou en fin de partie."],
  [/(drone|pyl[oô]ne|c[aâ]ble|hologramme|voiture|hover|obstacle)/i,
    "Pylône : passe par l'ouverture. Drone : contourne-le. Câble 20 kV : passe dessous. Hover-car : guette l'alerte rouge à droite et change de hauteur."],
  [/(signal|report|insult|spam|mod[ée]rat|r[eè]gle.*canal|banni|exclu)/i,
    "Dans le canal : pas d'insultes, pas de liens, 6 messages par minute. ⚑ pour signaler : 3 signalements masquent le message. Restons classe, pilotes. 🛰"],
  [/(qui es[- ]tu|t'es qui|c'est quoi orion|tu es (une )?ia|robot)/i,
    "Je suis ORION, le pilote IA du canal. J'accueille les nouveaux, je réponds aux questions sur Sun Pilot et je salue les records. Tape @ORION pour me parler. 🤖"],
  [/^(salut|bonjour|hello|coucou|yo|hey|bonsoir)\b/i,
    "Salut pilote ! 👋 Une question sur le jeu ? Tape @ORION suivi de ta question."],
];

export function faqAnswer(question) {
  const q = String(question || "").trim();
  for (const [re, answer] of FAQ) if (re.test(q)) return answer;
  return null;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function welcomeText(pseudo) {
  return pick([
    `Bienvenue à bord, ${pseudo} ! Je suis ORION, le pilote IA du canal. Une question sur le jeu ? Tape @ORION. 🚀`,
    `${pseudo} rejoint l'escadrille ! Je suis ORION : tape @ORION si tu veux des astuces pour grimper au classement. 🎈`,
    `Contact établi avec ${pseudo}. Ici ORION, IA de bord. Astuce : le mode 🔴 Pro rapporte ×5. Bon vol ! ⚡`,
  ]);
}

export function recordText(pseudo, score, modeLabel, rank) {
  const s = Number(score).toLocaleString("fr-FR");
  if (rank === 1) return pick([
    `🚨 NOUVEAU RECORD MONDIAL ! ${pseudo} prend la 1re place en ${modeLabel} avec ${s} pts. Qui ose le défier ?`,
    `Les néons tremblent : ${pseudo} est n°1 mondial en ${modeLabel} (${s} pts). Respect, pilote. 👑`,
  ]);
  if (rank && rank <= 3) return `Podium ! ${pseudo} décroche la ${rank}e place en ${modeLabel} avec ${s} pts. 🥇🥈🥉 La 1re place n'est plus très loin…`;
  if (rank) return `${pseudo} entre dans le top 10 en ${modeLabel} : ${rank}e avec ${s} pts. Bien piloté ! 🏆`;
  return `Beau vol de ${pseudo} : ${s} pts en ${modeLabel} ! 🏆`;
}

export const FALLBACK = "Je n'ai pas encore la réponse à ça, pilote. Demande-moi les commandes, les modes, les bonus, le score ou le classement ! 🛰";

/** Animation d'un canal calme : défis, astuces, questions. `tops` = meilleurs scores par mode. */
export function animationText(tops) {
  const lines = [
    "Canal bien calme… Défi du moment : battre 10 000 pts en 🟡 Intermédiaire. Qui relève le gant ? ⚡",
    "Astuce d'ORION : en Pro, garde de la hauteur, les hover-cars arrivent sans prévenir. 🚗",
    "Question pour l'escadrille : vous préférez le Bouclier, l'Aimant ou le Turbo ? 🛡🧲⚡",
    "Astuce : le Turbo te rend invincible, fonce dans les drones pour faire le ménage. 🤖💥",
    "Les Bitcoins font le score : un vol propre qui ramasse tout vaut mieux qu'un vol long. ₿",
  ];
  const withTop = tops.filter((t) => t && t.score > 0);
  if (withTop.length) {
    const t = pick(withTop);
    lines.push(`Le record à battre en ${t.label} : ${Number(t.score).toLocaleString("fr-FR")} pts par ${t.pseudo}. Quelqu'un pour le détrôner ? 👑`);
    lines.push(`${t.pseudo} règne en ${t.label} avec ${Number(t.score).toLocaleString("fr-FR")} pts. Le canal attend un challenger… 🎈`);
  }
  return pick(lines);
}
