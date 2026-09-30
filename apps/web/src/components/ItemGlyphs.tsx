/**
 * Pictogrammes d'emplacement (SVG maison) : emplacements vides de la fiche d'équipement,
 * et repli partout où l'icône d'un objet est introuvable. Le sprite est inséré une fois dans la page (App).
 */
export function GlyphSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="g-head" viewBox="0 0 24 24"><path d="M5 15a7 7 0 0 1 14 0v4H5z" /><path d="M9 19v-4h6v4M12 8V5" /></symbol>
      <symbol id="g-neck" viewBox="0 0 24 24"><path d="M6 3c0 6 3 9 6 9s6-3 6-9" /><path d="M12 12v2" /><circle cx="12" cy="17.5" r="3" /></symbol>
      <symbol id="g-shoulder" viewBox="0 0 24 24"><path d="M3 15c2-6 6-8 9-8s7 2 9 8l-4 2-5-3-5 3z" /><path d="M8 10l-1-3M16 10l1-3" /></symbol>
      <symbol id="g-back" viewBox="0 0 24 24"><path d="M8 4h8l3 16-7-3-7 3z" /><path d="M9 4c1 2 5 2 6 0" /></symbol>
      <symbol id="g-chest" viewBox="0 0 24 24"><path d="M7 4l5 2 5-2 3 4-3 3v9H7v-9L4 8z" /><path d="M12 6v14" /></symbol>
      <symbol id="g-wrist" viewBox="0 0 24 24"><path d="M6 7h12v10H6z" /><path d="M6 12h12M10 7v10M14 7v10" /></symbol>
      <symbol id="g-hands" viewBox="0 0 24 24"><path d="M8 21v-6L6 11V6.5a1 1 0 0 1 2 0V10h1V4.5a1 1 0 0 1 2 0V10h1V4.5a1 1 0 0 1 2 0V10h1V6.5a1 1 0 0 1 2 0V14l-2 2v5z" /></symbol>
      <symbol id="g-waist" viewBox="0 0 24 24"><path d="M3 9h18v6H3z" /><path d="M10 8h4v8h-4z" /></symbol>
      <symbol id="g-legs" viewBox="0 0 24 24"><path d="M7 3h10l-1 18h-3l-1-11-1 11H8z" /></symbol>
      <symbol id="g-feet" viewBox="0 0 24 24"><path d="M8 3h5v11l6 3v3H6l1-6z" /><path d="M8 8h5" /></symbol>
      <symbol id="g-ring" viewBox="0 0 24 24"><circle cx="12" cy="15" r="5.5" /><path d="M10 6.5l2-3 2 3-2 3z" /></symbol>
      <symbol id="g-trinket" viewBox="0 0 24 24"><path d="M12 3l7 7-7 11-7-11z" /><path d="M5 10h14M12 3v18" /></symbol>
      <symbol id="g-weapon" viewBox="0 0 24 24"><path d="M4 20l9-9" /><path d="M13 5l6 6-3 3-6-6z" /><path d="M15 3l1 2M21 9l-2-1" /></symbol>
      <symbol id="g-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" /></symbol>
      <symbol id="g-item" viewBox="0 0 24 24"><path d="M8 7c0-2 1.8-4 4-4s4 2 4 4" /><path d="M5 8h14l-1.5 12h-11z" /><path d="M9 12h6" /></symbol>
      <symbol id="g-ranged" viewBox="0 0 24 24"><path d="M6 3c9 2 13 8 15 17" /><path d="M6 3l15 17" /><path d="M3 12l6-3" /></symbol>
    </svg>
  );
}

/** Pictogramme pour un type d'emplacement du jeu (InventoryType) ; objets non équipables : une bourse. */
export function glyphFor(inventoryType: number | undefined) {
  switch (inventoryType) {
    case 1: return "head"; case 2: return "neck"; case 3: return "shoulder"; case 4: case 5: case 19: case 20: return "chest";
    case 6: return "waist"; case 7: return "legs"; case 8: return "feet"; case 9: return "wrist"; case 10: return "hands";
    case 11: return "ring"; case 12: case 23: case 28: return "trinket"; case 13: case 17: case 21: case 22: return "weapon";
    case 14: return "shield"; case 15: case 25: case 26: return "ranged"; case 16: return "back";
    default: return "item";
  }
}
