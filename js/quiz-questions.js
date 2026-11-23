/* =========================================================
   BANQUE DE QUESTIONS — quiz « seconde chance »
   ---------------------------------------------------------
   Utilisée par index.html quand le joueur perd sa vie :
   une question tirée au hasard, 4 réponses mélangées.

   Format d'une question :
     { cat: 'CATÉGORIE', q: 'Question ?', a: ['BONNE réponse', 'fausse', 'fausse', 'fausse'] }
   ➜ La bonne réponse est TOUJOURS la première du tableau « a » :
     le jeu mélange l'ordre à l'affichage.

   ➜ POUR AJOUTER UNE QUESTION : copier une ligne, garder exactement
     4 réponses. Les questions mal formées sont ignorées automatiquement.

   Script classique (pas un module) : le quiz marche même si Firebase
   ne se charge pas.
   ========================================================= */
window.SP_QUIZ_QUESTIONS = [
  /* ---------- HISTOIRE ---------- */
  { cat: 'HISTOIRE', q: 'En quelle année a eu lieu la prise de la Bastille ?', a: ['1789', '1792', '1776', '1815'] },
  { cat: 'HISTOIRE', q: 'Qui fut le premier empereur des Français ?', a: ['Napoléon Ier', 'Louis XIV', 'Charlemagne', 'Napoléon III'] },
  { cat: 'HISTOIRE', q: 'En quelle année l\'homme a-t-il marché sur la Lune pour la première fois ?', a: ['1969', '1965', '1972', '1959'] },
  { cat: 'HISTOIRE', q: 'Quel mur est tombé en 1989 ?', a: ['Le mur de Berlin', 'La Grande Muraille', 'Le mur d\'Hadrien', 'Le mur des Lamentations'] },
  { cat: 'HISTOIRE', q: 'Quelle reine de France fut guillotinée en 1793 ?', a: ['Marie-Antoinette', 'Catherine de Médicis', 'Anne d\'Autriche', 'Aliénor d\'Aquitaine'] },
  { cat: 'HISTOIRE', q: 'En quelle année s\'est terminée la Seconde Guerre mondiale ?', a: ['1945', '1944', '1918', '1950'] },
  { cat: 'HISTOIRE', q: 'Quelle civilisation a bâti la cité de Machu Picchu ?', a: ['Les Incas', 'Les Aztèques', 'Les Mayas', 'Les Olmèques'] },
  { cat: 'HISTOIRE', q: 'Qui fut le premier président de la Ve République ?', a: ['Charles de Gaulle', 'Georges Pompidou', 'René Coty', 'Vincent Auriol'] },
  { cat: 'HISTOIRE', q: 'Quelle célèbre bataille Napoléon a-t-il perdue en 1815 ?', a: ['Waterloo', 'Austerlitz', 'Iéna', 'Wagram'] },
  { cat: 'HISTOIRE', q: 'Qui a inventé la montgolfière en 1783 ?', a: ['Les frères Montgolfier', 'Les frères Lumière', 'Les frères Wright', 'Les frères Goncourt'] },

  /* ---------- GÉOGRAPHIE ---------- */
  { cat: 'GÉOGRAPHIE', q: 'Quelle est la capitale de l\'Australie ?', a: ['Canberra', 'Sydney', 'Melbourne', 'Perth'] },
  { cat: 'GÉOGRAPHIE', q: 'Quel est le plus long fleuve de France ?', a: ['La Loire', 'La Seine', 'Le Rhône', 'La Garonne'] },
  { cat: 'GÉOGRAPHIE', q: 'Quel est le plus grand océan du monde ?', a: ['L\'océan Pacifique', 'L\'océan Atlantique', 'L\'océan Indien', 'L\'océan Arctique'] },
  { cat: 'GÉOGRAPHIE', q: 'Quel est le plus haut sommet du monde ?', a: ['L\'Everest', 'Le K2', 'Le mont Blanc', 'Le Kilimandjaro'] },
  { cat: 'GÉOGRAPHIE', q: 'Dans quel pays se trouve la ville de Marrakech ?', a: ['Le Maroc', 'La Tunisie', 'L\'Algérie', 'L\'Égypte'] },
  { cat: 'GÉOGRAPHIE', q: 'Quelle est la capitale du Canada ?', a: ['Ottawa', 'Toronto', 'Montréal', 'Vancouver'] },
  { cat: 'GÉOGRAPHIE', q: 'Quel est le plus grand désert chaud du monde ?', a: ['Le Sahara', 'Le désert de Gobi', 'Le Kalahari', 'L\'Atacama'] },
  { cat: 'GÉOGRAPHIE', q: 'Dans quel département se trouve la ville de Saint-Quentin ?', a: ['L\'Aisne', 'La Somme', 'L\'Oise', 'Le Nord'] },
  { cat: 'GÉOGRAPHIE', q: 'Quel pays a la forme d\'une botte ?', a: ['L\'Italie', 'La Grèce', 'Le Portugal', 'Le Chili'] },
  { cat: 'GÉOGRAPHIE', q: 'Quelle est la capitale du Japon ?', a: ['Tokyo', 'Kyoto', 'Osaka', 'Séoul'] },

  /* ---------- SCIENCES ---------- */
  { cat: 'SCIENCES', q: 'Quel est le symbole chimique de l\'or ?', a: ['Au', 'Ag', 'Or', 'Fe'] },
  { cat: 'SCIENCES', q: 'Quelle planète est la plus proche du Soleil ?', a: ['Mercure', 'Vénus', 'Mars', 'La Terre'] },
  { cat: 'SCIENCES', q: 'Combien d\'os compte le squelette d\'un adulte ?', a: ['206', '186', '226', '306'] },
  { cat: 'SCIENCES', q: 'Quel gaz les plantes absorbent-elles pour la photosynthèse ?', a: ['Le dioxyde de carbone', 'L\'oxygène', 'L\'azote', 'L\'hélium'] },
  { cat: 'SCIENCES', q: 'À quelle température l\'eau bout-elle au niveau de la mer ?', a: ['100 °C', '90 °C', '120 °C', '80 °C'] },
  { cat: 'SCIENCES', q: 'Qui a formulé la théorie de la relativité ?', a: ['Albert Einstein', 'Isaac Newton', 'Galilée', 'Marie Curie'] },
  { cat: 'SCIENCES', q: 'Quelle est la formule chimique de l\'eau ?', a: ['H₂O', 'CO₂', 'O₂', 'NaCl'] },
  { cat: 'SCIENCES', q: 'Combien de chromosomes possède une cellule humaine (hors gamètes) ?', a: ['46', '23', '44', '48'] },
  { cat: 'SCIENCES', q: 'Quelle est la vitesse approximative de la lumière dans le vide ?', a: ['300 000 km/s', '30 000 km/s', '3 000 km/s', '1 000 000 km/s'] },
  { cat: 'SCIENCES', q: 'Quelle scientifique a reçu deux prix Nobel (physique et chimie) ?', a: ['Marie Curie', 'Rosalind Franklin', 'Ada Lovelace', 'Irène Joliot-Curie'] },

  /* ---------- ESPACE ---------- */
  { cat: 'ESPACE', q: 'Quelle planète est surnommée la « planète rouge » ?', a: ['Mars', 'Jupiter', 'Vénus', 'Saturne'] },
  { cat: 'ESPACE', q: 'Quelle est la plus grande planète du système solaire ?', a: ['Jupiter', 'Saturne', 'Neptune', 'La Terre'] },
  { cat: 'ESPACE', q: 'Comment s\'appelle notre galaxie ?', a: ['La Voie lactée', 'Andromède', 'Le Grand Nuage de Magellan', 'Le Sombrero'] },
  { cat: 'ESPACE', q: 'Qui fut le premier humain envoyé dans l\'espace, en 1961 ?', a: ['Youri Gagarine', 'Neil Armstrong', 'Buzz Aldrin', 'Thomas Pesquet'] },

  /* ---------- SPORT ---------- */
  { cat: 'SPORT', q: 'Combien de joueurs une équipe de football aligne-t-elle sur le terrain ?', a: ['11', '10', '9', '12'] },
  { cat: 'SPORT', q: 'En quelle année la France a-t-elle gagné sa première Coupe du monde de football ?', a: ['1998', '2006', '2018', '1984'] },
  { cat: 'SPORT', q: 'Dans quel sport utilise-t-on un volant ?', a: ['Le badminton', 'Le tennis', 'Le squash', 'Le tennis de table'] },
  { cat: 'SPORT', q: 'Quelle ville a accueilli les Jeux olympiques d\'été de 2024 ?', a: ['Paris', 'Los Angeles', 'Tokyo', 'Londres'] },
  { cat: 'SPORT', q: 'Combien de points rapporte un essai au rugby à XV ?', a: ['5', '3', '4', '7'] },
  { cat: 'SPORT', q: 'Quelle course cycliste se termine traditionnellement sur les Champs-Élysées ?', a: ['Le Tour de France', 'Paris-Roubaix', 'Le Tour d\'Italie', 'Le Tour d\'Espagne'] },
  { cat: 'SPORT', q: 'Combien de minutes dure le temps réglementaire d\'un match de NBA ?', a: ['48 minutes', '40 minutes', '60 minutes', '90 minutes'] },
  { cat: 'SPORT', q: 'Quel tournoi du Grand Chelem se joue sur terre battue ?', a: ['Roland-Garros', 'Wimbledon', 'L\'US Open', 'L\'Open d\'Australie'] },

  /* ---------- INFORMATIQUE & CRYPTO ---------- */
  { cat: 'INFORMATIQUE', q: 'Que signifie « HTML » ?', a: ['HyperText Markup Language', 'High Tech Modern Language', 'HyperTransfer Machine Language', 'Home Tool Markup Language'] },
  { cat: 'INFORMATIQUE', q: 'Qui a cofondé Apple avec Steve Wozniak ?', a: ['Steve Jobs', 'Bill Gates', 'Mark Zuckerberg', 'Elon Musk'] },
  { cat: 'INFORMATIQUE', q: 'Combien de bits y a-t-il dans un octet ?', a: ['8', '4', '16', '10'] },
  { cat: 'INFORMATIQUE', q: 'Quel langage rend les pages web interactives dans le navigateur ?', a: ['JavaScript', 'HTML', 'CSS', 'SQL'] },
  { cat: 'INFORMATIQUE', q: 'Sous quel pseudonyme le créateur du Bitcoin a-t-il publié son livre blanc ?', a: ['Satoshi Nakamoto', 'Vitalik Buterin', 'Hal Finney', 'Nick Szabo'] },
  { cat: 'INFORMATIQUE', q: 'En quelle année le réseau Bitcoin a-t-il été lancé ?', a: ['2009', '2005', '2012', '2015'] },
  { cat: 'INFORMATIQUE', q: 'Que signifie « CPU » ?', a: ['Central Processing Unit', 'Computer Power Unit', 'Central Program Utility', 'Core Personal Unit'] },
  { cat: 'INFORMATIQUE', q: 'Quel système d\'exploitation mobile est développé par Google ?', a: ['Android', 'iOS', 'Windows Phone', 'Symbian'] },
  { cat: 'INFORMATIQUE', q: 'Que signifient les lettres « www » d\'une adresse web ?', a: ['World Wide Web', 'Wide World Web', 'Web World Wide', 'World Web Wire'] },

  /* ---------- CINÉMA ---------- */
  { cat: 'CINÉMA', q: 'Qui a réalisé le film « Titanic » (1997) ?', a: ['James Cameron', 'Steven Spielberg', 'Ridley Scott', 'Christopher Nolan'] },
  { cat: 'CINÉMA', q: 'Quel film de Ridley Scott (1982) est une référence du cyberpunk ?', a: ['Blade Runner', 'Matrix', 'Tron', 'Alien'] },
  { cat: 'CINÉMA', q: 'Dans « Matrix », quelle pilule Neo choisit-il ?', a: ['La rouge', 'La bleue', 'La verte', 'La jaune'] },
  { cat: 'CINÉMA', q: 'Quel film français de 2001 suit une serveuse de Montmartre ?', a: ['Le Fabuleux Destin d\'Amélie Poulain', 'Intouchables', 'La Haine', 'Les Choristes'] },
  { cat: 'CINÉMA', q: 'Quelle récompense suprême est remise au Festival de Cannes ?', a: ['La Palme d\'or', 'L\'Ours d\'or', 'Le Lion d\'or', 'Le César'] },
  { cat: 'CINÉMA', q: 'Quel acteur incarne Jack Sparrow dans « Pirates des Caraïbes » ?', a: ['Johnny Depp', 'Orlando Bloom', 'Brad Pitt', 'Leonardo DiCaprio'] },
  { cat: 'CINÉMA', q: 'Quel studio a produit « Toy Story » (1995), premier long métrage entièrement en images de synthèse ?', a: ['Pixar', 'DreamWorks', 'Blue Sky', 'Illumination'] },

  /* ---------- ARTS & LITTÉRATURE ---------- */
  { cat: 'ARTS', q: 'Qui a peint « La Joconde » ?', a: ['Léonard de Vinci', 'Michel-Ange', 'Raphaël', 'Botticelli'] },
  { cat: 'LITTÉRATURE', q: 'Qui a écrit « Les Misérables » ?', a: ['Victor Hugo', 'Émile Zola', 'Honoré de Balzac', 'Alexandre Dumas'] },
  { cat: 'LITTÉRATURE', q: 'Qui a écrit « Le Petit Prince » ?', a: ['Antoine de Saint-Exupéry', 'Jules Verne', 'Albert Camus', 'Jacques Prévert'] },
  { cat: 'LITTÉRATURE', q: 'Qui est l\'auteur de « Vingt Mille Lieues sous les mers » ?', a: ['Jules Verne', 'Victor Hugo', 'Alexandre Dumas', 'Guy de Maupassant'] },
  { cat: 'MUSIQUE', q: 'Combien de cordes compte une guitare classique ?', a: ['6', '4', '5', '7'] },
  { cat: 'MUSIQUE', q: 'Quel compositeur, devenu sourd, a écrit la 9e Symphonie et son « Ode à la joie » ?', a: ['Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Jean-Sébastien Bach', 'Frédéric Chopin'] },

  /* ---------- NATURE & DIVERS ---------- */
  { cat: 'NATURE', q: 'Quel est le plus grand animal du monde ?', a: ['La baleine bleue', 'L\'éléphant d\'Afrique', 'La girafe', 'Le cachalot'] },
  { cat: 'NATURE', q: 'Combien de pattes possède une araignée ?', a: ['8', '6', '10', '12'] },
  { cat: 'NATURE', q: 'Quel est l\'animal terrestre le plus rapide ?', a: ['Le guépard', 'Le lion', 'L\'antilope', 'Le lévrier'] },
  { cat: 'NATURE', q: 'Quel oiseau incapable de voler vit en Antarctique ?', a: ['Le manchot empereur', 'Le pingouin', 'L\'autruche', 'L\'albatros'] },
  { cat: 'DIVERS', q: 'Combien de jours compte une année bissextile ?', a: ['366', '365', '364', '367'] },
  { cat: 'DIVERS', q: 'Quelle monnaie a remplacé le franc dans les porte-monnaie français en 2002 ?', a: ['L\'euro', 'L\'écu', 'Le mark', 'Le dollar'] },
];
