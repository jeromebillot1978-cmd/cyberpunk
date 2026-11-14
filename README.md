# Sun Pilot · Neon Skies — classement mondial Firebase

Jeu HTML/CSS/JS sans framework + classement mondial en temps réel (Firebase Auth anonyme + Cloud Firestore), hébergé sur Vercel.

## Structure du projet

```
sun-pilot-firebase/
├── index.html               ← le jeu (modifié : bouton 🏆 CLASSEMENT, fenêtre, envoi des scores)
├── js/
│   ├── firebase-config.js   ← configuration du projet Firebase (déjà remplie)
│   ├── firebase.js          ← noyau partagé : App, App Check, Auth anonyme, Firestore
│   ├── profiles.js          ← pilotes de l'appareil (jusqu'à 4, chacun son compte Firebase)
│   ├── identity.js          ← pseudo obligatoire (création, unicité, modification)
│   ├── pilots.js            ← écran « 👥 QUI PILOTE ? » (choisir, ajouter, retirer)
│   ├── leaderboard.js       ← classement mondial (scores, top 10, rang)
│   ├── modal.js             ← fenêtres modales réutilisables (animations)
│   └── main.js              ← point d'entrée des modules
├── firestore.rules          ← règles de sécurité
├── firestore.indexes.json   ← index composite + exemptions (réduction des coûts)
├── firebase.json            ← déploiement des règles/index + émulateurs
├── vercel.json              ← en-têtes de sécurité et de cache
├── .vercelignore / .gitignore
└── tests/                   ← 28 tests automatiques des règles (émulateur)
```

Le jeu reste 100 % jouable sans Firebase : records locaux, difficultés, tout fonctionne. Le classement s'active dès que `js/firebase-config.js` est rempli.

---

## Étape 1 — Créer le projet Firebase (console, ~5 min)

1. Va sur https://console.firebase.google.com → **Ajouter un projet** → nom : `sun-pilot` (Google Analytics : facultatif, inutile ici).
2. **Ajouter une application Web** (icône `</>`) → surnom `Sun Pilot` → ne coche pas « Firebase Hosting » → copie l'objet `firebaseConfig`.
3. Colle les valeurs dans `js/firebase-config.js` (remplace les `VOTRE_…`).
4. **Authentication** → *Commencer* → onglet *Mode de connexion* → active **Anonyme** → Enregistrer.
5. **Firestore Database** → *Créer une base de données* → édition **Standard** → emplacement **`europe-west9` (Paris)** ou `eur3` → démarre en **mode production** (tout est fermé, nos règles ouvriront le strict nécessaire).

## Étape 2 — Déployer les règles et l'index

Avec la ligne de commande (recommandé) :

```bash
npm install -g firebase-tools
firebase login
cd sun-pilot-firebase
firebase use --add            # choisis ton projet, alias : default
firebase deploy --only firestore:rules,firestore:indexes
```

Sans ligne de commande : console → Firestore → onglet **Règles** → colle le contenu de `firestore.rules` → *Publier*. Puis onglet **Index** → *Composite* → *Créer un index* : collection `scores`, champs `mode` **Croissant** puis `score` **Décroissant**, portée *Collection*.

⏳ L'index met quelques minutes à se construire (statut « Activé » dans la console). Tant qu'il ne l'est pas, le top 10 affiche « HORS LIGNE ».

## Étape 3 — Mettre en ligne sur Vercel

**Option A — via GitHub (mises à jour automatiques)**
1. Crée un dépôt GitHub et pousse le dossier `sun-pilot-firebase`.
2. https://vercel.com/new → importe le dépôt.
3. *Framework Preset* : **Other** · *Build Command* : vide · *Output Directory* : vide (racine) → **Deploy**.

**Option B — en ligne de commande**
```bash
npm install -g vercel
cd sun-pilot-firebase
vercel          # première fois : crée le projet (preview)
vercel --prod   # mise en production
```

Aucune variable d'environnement n'est nécessaire : la config web Firebase n'est pas secrète.

## Étape 4 — Sécuriser (fortement recommandé)

1. **Domaines autorisés** : Firebase → Authentication → *Paramètres* → *Domaines autorisés* → ajoute `ton-projet.vercel.app` (et ton domaine perso).
2. **Restreindre la clé API** : https://console.cloud.google.com → ton projet → *API et services* → *Identifiants* → la clé « Browser key » → *Restrictions d'application* : **Sites Web** → ajoute `https://ton-projet.vercel.app/*`, `https://*.vercel.app/*` si tu utilises les previews, et ton domaine.
3. **App Check (anti-robots)** : déjà configuré. Clé reCAPTCHA Fraud Defense (ex-Enterprise, type « score ») créée dans le projet `sun-pilot-jercat`, enregistrée dans Firebase App Check et dans `js/firebase-config.js` (`appCheckSiteKey`). Firebase n'accepte plus les clés reCAPTCHA v3 classiques pour les nouveaux projets.
   - Pour passer du mode observation au blocage : console Firebase → *App Check* → *APIs* → Cloud Firestore → **Appliquer**, une fois que les métriques montrent ~100 % de requêtes vérifiées.

## Domaine perso (optionnel, ex. `sunpilot.jercat.fr` chez OVH)

Vercel → projet → *Settings* → *Domains* → ajoute `sunpilot.jercat.fr`. Chez OVH → zone DNS de `jercat.fr` → ajoute un enregistrement **CNAME** `sunpilot` → `cname.vercel-dns.com.` Pense ensuite aux étapes 4.1 et 4.2 pour ce domaine.

---

## Modèle de données

**Pseudo obligatoire** : au premier lancement, le jeu reste verrouillé (bouton JOUER désactivé, clavier et tactile bloqués) tant que le joueur n'a pas créé un pseudo unique. Modifiable ensuite dans ⚙ Paramètres → « ✏ MODIFIER MON PSEUDO ».

```js
users/{uid}         { uid, pseudo: "JERCAT", createdAt, updatedAt }
pseudos/{pseudo}    { uid }            // pseudo en minuscules : unicité insensible à la casse
scores/{uid}_{mode} { uid, pseudo, score, mode, bitcoins, distance, level, createdAt }
```

- Pseudo : 3 à 15 caractères, `a-z A-Z 0-9 _ -` (espaces, accents, emoji, HTML refusés et retirés automatiquement à la saisie).
- Création / modification en **une transaction** (profil + réservation du pseudo + libération de l'ancien) : deux joueurs ne peuvent jamais obtenir le même pseudo.
- Le pseudo d'un score doit être celui du profil : les classements affichent toujours le pseudo officiel, mis à jour automatiquement après un changement.

**Plusieurs joueurs sur le même appareil (chacun son tour)** : jusqu'à 4 pilotes. Chaque pilote a sa propre instance Firebase nommée, donc son propre compte anonyme (UID), son pseudo, ses records locaux et son rang mondial. Avec 2 pilotes ou plus, JOUER ouvre « 👥 QUI PILOTE ? » ; au Game Over, « 👥 JOUEUR SUIVANT ». Le pseudo du pilote est affiché au-dessus de sa montgolfière pendant la partie. Dans le classement : « TOI » = pilote actif, « ICI » = autre pilote de l'appareil.

## Sécurité (firestore.rules)

| Protection | Comment |
|---|---|
| Pseudo unique | réservation `pseudos/{pseudo en minuscules}` créée dans la même transaction que le profil |
| Pseudo valide côté serveur | 3 à 15 caractères `A-Z a-z 0-9 _ -`, vérifié par les règles |
| Profils protégés | chaque joueur ne lit et ne modifie que `users/{son uid}`, impossible de créer un faux UID |
| Pas de doublons de scores | l'ID du document est imposé : `uid_mode` |
| Personne ne modifie le score d'un autre | `uid` doit être celui du joueur connecté, en création comme en mise à jour |
| Seul le meilleur score est gardé | une mise à jour n'est acceptée que si `score` est **strictement supérieur** |
| Anti-spam | 10 s minimum entre deux écritures d'un même document, horodatage imposé par le serveur |
| Données propres | champs exacts, types entiers, bornes, mode connu, pseudo filtré (pas de HTML) |
| Scores impossibles | `score ≤ 3 × (distance × 2 + bitcoins × 40) + 100` |
| Pas d'aspiration de la base | toute requête de liste doit avoir une limite ≤ 1000 |
| Rien d'autre n'est accessible | tout le reste de la base est fermé, suppression interdite |

Tests : `cd tests && npm install && npm run test:rules` (Java requis pour l'émulateur) → 52 tests.

> Limite honnête : dans un jeu 100 % navigateur, le score est calculé chez le joueur. Les règles bloquent les écritures incohérentes, App Check bloque les scripts hors de ton site, mais un tricheur très motivé peut toujours envoyer un score plausible. Pour une protection totale, il faudrait valider la partie côté serveur (Cloud Function qui rejoue la partie), ce qui est bien plus lourd.

## Optimisation des coûts

| Action | Coût Firestore |
|---|---|
| Ouverture du jeu | 0 lecture (connexion anonyme seulement, Firestore chargé en différé) |
| Fin de partie sans record en ligne | 0 (record en ligne mémorisé ; 1 seule lecture la toute première fois par mode) |
| Nouveau record | 1 écriture + 1 lecture (count du rang) |
| Ouverture du classement | 10 lectures, puis 1 par score modifié en direct ; quasi 0 si rouvert dans les 30 min (cache persistant) |
| Rang mondial | 1 lecture (agrégation `count()`, mise en cache 5 min) ; 0 si le joueur est dans le top 10 |
| Onglet en arrière-plan / fenêtre fermée | 0 (écoute coupée) |

- Index composite unique `(mode ↑, score ↓)` qui sert au top 10 **et** au rang.
- Exemptions d'index sur `pseudo`, `bitcoins`, `distance`, `level`, `createdAt`, `uid` : moins de stockage, écritures plus légères.
- Le plan gratuit Spark (50 000 lectures et 20 000 écritures par jour) couvre largement plusieurs centaines de joueurs quotidiens.

## Tester en local avec les émulateurs

```bash
firebase emulators:start --only auth,firestore --project demo-sunpilot
python3 -m http.server 5173      # dans un 2e terminal, à la racine du projet
```
Ouvre `http://127.0.0.1:5173/?emulator` : le jeu se connecte aux émulateurs (interface de contrôle sur http://127.0.0.1:4000).

⚠ Le classement ne fonctionne pas si tu ouvres `index.html` en double-cliquant dessus (`file://`) : les navigateurs y bloquent les modules JavaScript. Le jeu reste jouable et affiche « CLASSEMENT : VERSION EN LIGNE ».
