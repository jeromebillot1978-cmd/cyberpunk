# 💬 Canal des Pilotes — documentation technique

Chat communautaire intégré à **Sun Pilot · Neon Skies**, avec **ORION**, pilote IA.
Ajouté le 18 novembre 2026. Tout réutilise l'existant : Firebase (connexion anonyme, App Check, cache local), pseudos uniques, fenêtres modales, design néon, Vercel.

---

## 1. Analyse technique

### Ce qui existait et a été réutilisé

| Élément existant | Réutilisation dans le canal |
|---|---|
| `js/firebase.js` : une connexion Firebase par pilote, App Check, cache persistant | même connexion (`getFirebase`), aucun nouveau SDK |
| `js/identity.js` : pseudo unique vérifié par les règles (`users/{uid}`) | le pseudo affiché dans chaque message est **vérifié par les règles** contre `users/{uid}` |
| `js/profiles.js` : jusqu'à 4 pilotes par appareil | chaque pilote écrit avec son propre compte ; changer de pilote ferme le canal |
| `js/modal.js` + styles `.modal` | la fenêtre du canal est une modale du jeu (animation, Échap, blocage des touches du jeu) |
| `js/leaderboard.js` : envoi du record, calcul du rang | émet `sunpilot:onlinerecord` ; le canal annonce les records du top 10 |
| Règles Firestore et 54 tests | règles du canal ajoutées dans le même fichier, tests ajoutés à côté |
| Vercel | la fonction serveur `api/orion.js` est déployée avec le jeu |

### Choix d'architecture

- **Firestore seul**, pas de Realtime Database : un seul service à surveiller.
- **Pas de Cloud Functions** (elles exigent l'offre payante Blaze) : toute la sécurité des joueurs est dans les **règles Firestore** ; seul ORION passe par une **fonction Vercel** avec `firebase-admin`.
- **Anti-spam vérifié par le serveur** : chaque message est écrit dans la même écriture groupée qu'un document `chatState/{uid}` dont les règles imposent le délai et le compteur. Un client modifié ne peut pas contourner les limites.
- **Présence sans écouteur temps réel** : un écouteur de présence coûterait N² lectures (chaque signal de vie lu par tous). On utilise un signal par minute et un comptage agrégé.

---

## 2. Structure Firestore

| Collection | Document | Champs | Qui écrit |
|---|---|---|---|
| `messages` | auto | `uid`, `pseudo`, `type` (`user`, `welcome`, `join`, `leave`, `record`, `orion`), `text`, `mode`, `score`, `createdAt`, `hidden`, `reports`, `editedAt`, `replyTo` | joueurs (selon les règles), ORION (serveur) |
| `chatState` | `{uid}` | `lastMsgAt`, `lastMsgId`, `winStart`, `winCount`, `joinedAt`, `leftAt`, `recordAt`, `welcomedAt`, `createdAt` | le joueur, contrôlé par les règles ; privé |
| `presence` | `{uid}` | `uid`, `pseudo`, `lastSeen` | le joueur (1 fois / 30 s maximum) |
| `reports` | `{messageId}_{uid}` | `messageId`, `reporterUid`, `authorUid`, `reason`, `createdAt` | le joueur ; lecture modérateurs |
| `moderation` | `autohide_{id}` ou auto | `action`, `messageId`, `reports`/`targetUid`, `by`, `createdAt` | journal (masquage auto, actions des modérateurs) |
| `moderators` | `{uid}` | libre (ex. `since`) | **console Firebase uniquement** |
| `bans` | `{uid}` | `uid`, `pseudo`, `reason`, `by`, `createdAt` | modérateurs |
| `orion`, `orionLimits`, `orionAnswers`, `orionRecords` | — | quotas et dédoublonnage d'ORION | **serveur uniquement** (fermé aux joueurs) |

Index composite : `messages` → `hidden` ↑, `createdAt` ↓ (`firestore.indexes.json`). Les champs jamais filtrés (texte, pseudo…) sont exclus de l'indexation pour réduire le coût des écritures.

---

## 3. Règles de sécurité (`firestore.rules`)

| Protection | Règle |
|---|---|
| Auteur authentique | `uid` = joueur connecté, `pseudo` = celui de `users/{uid}`, `createdAt` = heure du serveur |
| Texte | 1 à 280 caractères, pas que des espaces, aucun caractère de contrôle, **aucun lien**, **aucun mot interdit** |
| Délai | 4 s minimum entre deux messages |
| Débit | 6 messages par fenêtre de 60 s |
| Messages système | « Bienvenue » une seule fois ; « a rejoint » 1 fois / 10 min ; « a quitté » 1 fois après chaque arrivée ; record : uniquement le score **réellement enregistré** il y a moins de 5 min, 1 annonce / 10 min |
| ORION | aucun joueur ne peut écrire un message de type `orion` |
| Modifier / supprimer | uniquement **ses propres** messages ; correction pendant 10 min, texte revérifié |
| Signaler | 1 fois par message et par joueur, jamais soi-même ; au 3e signalement le message est masqué et journalisé |
| Lecture | uniquement les messages non masqués, 50 au maximum par requête |
| Exclusion | un pilote présent dans `bans` ne peut plus écrire |
| Modération | `moderators/{uid}` (créé à la main) : voir les messages masqués, masquer, supprimer, exclure |

Le filtre du jeu (`js/chat-filter.js`) applique la même liste et va plus loin (chiffres à la place des lettres, lettres répétées ou espacées, majuscules en rafale) ; il est aussi utilisé pour vérifier les réponses d'ORION.

---

## 4. Frontend

| Fichier | Rôle |
|---|---|
| `js/chat.js` | canal : écoute temps réel, envoi, anti-spam local, rendu, modification, suppression, signalement, présence, outils de modération, annonce des records, appels à ORION |
| `js/chat-filter.js` | nettoyage et filtrage des messages (partagé avec le serveur) |
| `index.html` | fenêtre `#chat`, styles `.chat-*`, boutons « 💬 CANAL DES PILOTES » (accueil et fin de partie), touche **C** |
| `js/leaderboard.js` | émet `sunpilot:onlinerecord` après un record en ligne |
| `js/main.js` | charge `chat.js` |

Fonctions : horodatage (heure, date si ancien, séparateurs de jour), pseudo coloré, badge **TOI** et **IA**, mentions `@pseudo` surlignées, défilement automatique (bouton « nouveaux messages » si on lit plus haut), messages plus anciens à la demande, compteur 0/280, pilotes en ligne (liste au clic), responsive (plein écran sur téléphone), texte sélectionnable, aucune injection HTML possible (`textContent` partout).

---

## 5. Backend — ORION (`api/orion.js`)

Fonction Vercel (Node 22, `firebase-admin`). Le jeu l'appelle avec le **jeton Firebase** du joueur.

| Action | Déclencheur | Ce que fait ORION |
|---|---|---|
| `welcome` | première entrée dans le canal | message d'accueil personnalisé |
| `ask` | message contenant `@ORION` (ou « orion ») | réponse : base de connaissances du jeu (gratuite, immédiate), sinon IA Groq si configurée, sinon réponse de repli |
| `record` | record du top 10 mondial | commentaire avec le rang réel (record mondial, podium, top 10) |
| `animate` | ouverture d'un canal calme depuis 20 min | défi, astuce, question ou record à battre (au plus 1 fois / 45 min) |

Garde-fous : jeton vérifié, origine vérifiée, joueur exclu refusé, **1 appel / 8 s par action et 40 / jour par joueur**, **300 réponses d'IA et 600 messages d'ORION par jour** pour tout le canal, chaque événement traité une seule fois, réponse de l'IA nettoyée (liens retirés, 280 caractères, filtre du canal), consignes contre les détournements de rôle.

Variables d'environnement Vercel :

| Variable | Obligatoire | Contenu |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | oui | contenu complet du fichier JSON du compte de service Firebase |
| `GROQ_API_KEY` | non | clé Groq (sans elle, ORION répond avec sa base de connaissances) |
| `ORION_MODEL` | non | modèle Groq (défaut : `llama-3.3-70b-versatile`) |
| `ALLOWED_ORIGINS` | non | domaines autorisés (défaut : `cyberpunk.jercat.fr`) |

Sans `FIREBASE_SERVICE_ACCOUNT`, le canal fonctionne normalement ; seul ORION est silencieux.

---

## 6. Tests

`cd tests && npm install && npm run test:rules` (Java requis pour l'émulateur ; `npm install` aussi à la racine pour `firebase-admin`).

| Suite | Tests | Contenu |
|---|---|---|
| `tests/rules.test.mjs` | 54 | règles existantes (pseudos, scores), inchangées |
| `tests/chat.test.mjs` | 100 | arrivée, anti-spam (délai, débit, compteurs truqués), usurpation, ORION interdit aux joueurs, 15 cas de texte refusé, lecture, modification/suppression, signalements et masquage, modération et exclusion, messages système, présence, données d'ORION |
| `tests/orion.test.mjs` | 24 | accès (jeton, origine, exclu), accueil, réponses, records, animation, quotas |

Résultat au 18/11/2026 : **178 réussis, 0 échoué**. Test complet dans un navigateur (ordinateur + téléphone, deux joueurs) sur les émulateurs : accueil, ORION, temps réel, anti-spam, filtre, mention, signalement, modification, suppression, départ, annonce de record commentée par ORION : **aucune erreur JavaScript**.

---

## 7. Performances et coûts

Quotas gratuits Firestore : 50 000 lectures et 20 000 écritures par jour.

| Action | Lectures | Écritures |
|---|---|---|
| Ouvrir le canal | ~45 (état, exclusion, modérateur, 40 messages, comptage) ; moins si rouvert dans les 30 min | 1 à 3 (présence, « a rejoint ») |
| Canal ouvert, par minute | 1 (comptage des présents) | 1 (signal de présence) |
| Un message envoyé | 1 par pilote ayant le canal ouvert | 2 |
| Canal fermé ou onglet en arrière-plan | **0** (écoute coupée) | 0 |

Exemple : 200 pilotes par jour qui ouvrent le canal 10 minutes, 400 messages, 15 pilotes connectés en moyenne → environ 17 000 lectures et 3 500 écritures par jour : **dans l'offre gratuite**.
Plusieurs centaines de pilotes connectés **en même temps** et très bavards dépasseraient le gratuit (chaque message est lu par tous les présents) : il faudra alors l'offre Blaze, avec une alerte de budget. Les limites (6 messages/min, 40 messages affichés, écoute coupée fenêtre fermée) plafonnent ce coût.

Chargement : `chat.js` + `chat-filter.js` (~32 Ko non compressés), chargés avec les autres modules ; **aucune lecture Firestore tant que le canal n'est pas ouvert**.

---

## 8. Déploiement

1. **Règles et index** : Console Firebase → Firestore → **Règles** → coller `firestore.rules` → **Publier**. Puis **Index** → **Composite** → **Créer un index** : collection `messages`, `hidden` Croissant, `createdAt` Décroissant, portée Collection. (Ou en ligne de commande : `firebase deploy --only firestore:rules,firestore:indexes`.)
2. **Compte de service** : Console Firebase → ⚙ Paramètres du projet → **Comptes de service** → **Générer une nouvelle clé privée** → un fichier JSON est téléchargé. Ne jamais le publier.
3. **Vercel** → projet du jeu → Settings → **Environment Variables** : `FIREBASE_SERVICE_ACCOUNT` = tout le contenu du fichier JSON ; facultatif : `GROQ_API_KEY`. Cocher Production (et Preview).
4. **Mise en ligne** : fusion de la branche `canal-des-pilotes` dans `main` → Vercel déploie automatiquement (redéployer si les variables ont été ajoutées après).
5. **Devenir modérateur** : Firestore → collection `users` → trouver le document dont `pseudo` est le tien → copier son identifiant → créer la collection `moderators` avec un document de ce même identifiant (champ `since`, type timestamp).
6. **Vérifier** : ouvrir le jeu → 💬 CANAL DES PILOTES → « Bienvenue à bord » puis ORION ; écrire `@ORION comment on joue ?`.

---

## 9. Corrections faites pendant les tests

- Envoi pendant un envoi en cours : un message « Envoi en cours… » s'affiche au lieu d'un clic ignoré, et le texte tapé entre-temps n'est plus effacé.
- Lettres répétées (« connnnard ») et lettres espacées (« f d p ») : désormais bloquées.
- Majuscules en rafale avec espaces : désormais détectées.
- Doublon visuel « ↪ @pseudo » sur les réponses d'ORION retiré (la mention est déjà en tête).
- Quota d'ORION par action : l'accueil ou l'animation ne bloque plus une question posée juste après.
- Script de test : le fichier `tests/firebase.json` pointait hors du dossier (refusé par la version actuelle de Firebase) ; les tests se lancent maintenant depuis la racine.
