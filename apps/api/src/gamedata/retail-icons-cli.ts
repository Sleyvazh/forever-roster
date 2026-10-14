/**
 * Icônes officielles des classes propres à WoW Retail (chevalier de la mort, chasseur de démons, évocateur, moine) et de
 * leurs spés, en PNG 64×64 : <dossier>/class/<slug>.png et <dossier>/spec/<slug>-<spé>.png (voir retail-icons.ts).
 * Fichiers de Blizzard : ils restent dans icons/retail/ du serveur, jamais dans Git. Ne retélécharge pas ce qui existe ;
 * si wago.tools ou le serveur d'images est injoignable, le signale et sort quand même avec le code 0 (le site affiche
 * l'initiale de la classe, le bot se passe d'émoji). Appelé par scripts/fetch-item-icons.sh :
 *
 *   docker compose run --rm --no-deps -T -v "$PWD/icons/retail:/out" api node dist/retail-icons.js /out
 *
 * WAGO_RETAIL_BRANCHES : branches (produits) de wago.tools où chercher les fichiers BLP, séparées par des virgules
 * (par défaut le produit Retail retenu, puis wow, wowt, wowxptr, wow_beta).
 */
import { fetchRetailIcons } from "./retail-icons";

const out = process.argv[2];
if (!out) throw new Error("dossier de destination manquant");

const branches = process.env.WAGO_RETAIL_BRANCHES?.split(",").map(s => s.trim()).filter(Boolean);
await fetchRetailIcons(out, branches?.length ? { branches } : {});
