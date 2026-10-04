window.FICHE_LECTURE_TEMPLATE_V1 = {
  "format": "atelier-recherche/fiche-template",
  "version": 1,
  "name": "Fiche de lecture — version simplifiée",
  "columns": [
    { "id": "rub", "label": "Rubrique" },
    { "id": "cont", "label": "Contenu" }
  ],
  "rows": [
    { "id": "g1", "kind": "header", "cells": { "rub": { "text": "<b>Identification</b>", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f1_01", "key": "f1_01", "hint": "Article scientifique · Livre / ouvrage · Chapitre d'ouvrage collectif · Thèse ou mémoire · Rapport · Autre", "cells": { "rub": { "text": "Type de document", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f1_02", "key": "f1_02", "hint": "Ex. : Tordo, F. (2021). Soi-même comme un avatar. Imaginaire & Inconscient, 1(47), 77-88.", "cells": { "rub": { "text": "Référence complète (APA 7)", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f1_08", "key": "f1_08", "hint": "Ex. : communication, sociologie de l'enfance, game studies, psychologie sociale", "cells": { "rub": { "text": "Discipline et champ", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f1_09", "key": "f1_09", "hint": "Mots-clés de l'auteur·e et les miens", "cells": { "rub": { "text": "Mots-clés", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "g2", "kind": "header", "cells": { "rub": { "text": "<b>Suivi de lecture</b>", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f2_02", "key": "f2_02", "hint": "À lire · En cours · Lue · Relue", "cells": { "rub": { "text": "Statut", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f2_03", "key": "f2_03", "hint": "Cœur · Appui · Contexte · Hors sujet (et pourquoi)", "cells": { "rub": { "text": "Pertinence pour ma thèse", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "g3", "kind": "header", "cells": { "rub": { "text": "<b>Contenu du texte</b>", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_01", "key": "f3_01", "hint": "Quel problème l'auteur·e veut-il ou elle éclairer ? Quelle est sa question de recherche ?", "cells": { "rub": { "text": "Problématique et question de recherche", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_02", "key": "f3_02", "hint": "Ce que le texte cherche à démontrer, comprendre ou décrire", "cells": { "rub": { "text": "Objectifs ou hypothèses", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_03", "key": "f3_03", "hint": "Théories, écoles de pensée et auteur·e·s mobilisé·e·s", "cells": { "rub": { "text": "Cadre théorique", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_04", "key": "f3_04", "hint": "Concepts clés et définitions retenues par l'auteur·e", "cells": { "rub": { "text": "Concepts clés", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_05", "key": "f3_05", "hint": "Méthode, terrain, participant·e·s, corpus, outils d'analyse", "cells": { "rub": { "text": "Méthodologie ou démarche", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_08", "key": "f3_08", "hint": "Conclusions de l'auteur·e et pistes de recherche proposées", "cells": { "rub": { "text": "Conclusion", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f3_09", "key": "f3_09", "hint": "Limites reconnues dans le texte ou limites de ma lecture", "cells": { "rub": { "text": "Limites", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "g4", "kind": "header", "cells": { "rub": { "text": "<b>Mon analyse</b>", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f5_01", "key": "f5_01", "hint": "Résumé dans mes mots : l'essentiel du texte", "cells": { "rub": { "text": "Résumé dans mes mots", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f5_02", "key": "f5_02", "hint": "Ce que ce texte m'apporte pour ma recherche", "cells": { "rub": { "text": "Apports pour ma thèse", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f5_03", "key": "f5_03", "hint": "Mes critiques, tensions, maladresses ou angles à revisiter", "cells": { "rub": { "text": "Critiques et désaccords", "tags": [] }, "cont": { "text": "", "tags": [] } } },
    { "id": "f5_06", "key": "f5_06", "hint": "Questions, pistes, éléments à vérifier ou à approfondir", "cells": { "rub": { "text": "Questions et idées à creuser", "tags": [] }, "cont": { "text": "", "tags": [] } } }
  ],
  "rowLines": "strong"
};

window.FICHE_LECTURE_TEMPLATE = {
  "format": "atelier-recherche/fiche-template",
  "version": 2,
  "name": "Fiche de lecture — version 2",
  "columns": [
    { "id": "rub", "label": "Rubrique" },
    { "id": "cont", "label": "Contenu" }
  ],
  "rows": [
    { "key": "reference", "label": "Référence APA 7", "hint": "", "long": true },
    { "key": "kw", "label": "Mots-clés", "hint": "Mots-clés de l'auteur·e et les miens, séparés par des virgules", "long": false },
    { "key": "resume", "label": "Résumé", "hint": "L'essentiel du texte, dans mes mots", "long": true },
    { "key": "hypothese", "label": "Hypothèse", "hint": "Ce que l'auteur·e cherche à démontrer ou à vérifier", "long": true },
    { "key": "notes", "label": "Notes", "hint": "Mes notes libres sur ce texte", "long": true }
  ],
  "tables": [
    { "key": "definitions", "label": "Définitions", "hint": "Un mot par ligne et sa définition (avec la page)", "columns": ["Mot", "Définition"] },
    { "key": "concepts", "label": "Concepts et théories", "hint": "Un concept ou une théorie par ligne et ce qu'il ou elle veut dire", "columns": ["Concept ou théorie", "Définition"] }
  ]
};
