#!/usr/bin/env python3
"""Range des icônes reçues dans le dossier icons/ servi par Caddy, en les renommant.
Usage : python3 scripts/normalize-icons.py <dossier reçu> [dossier icons, défaut ./icons]

Noms reconnus (majuscules, espaces et tirets indifférents) :
  ClassIcon_<classe>.png          -> icons/class/<classe>.png
  <Classe><n>-<Spé ou arbre>.png  -> icons/spec/<classe>-<spé>.png
      Le nom après le tiret désigne la spé (Druid3-FeralCat, Druid2-FeralGuardian)
      ou l'arbre de talents (Paladin1-Holy : vaut pour Holy Heal et Holy DPS).
      Le numéro <n> ne sert qu'à trier les fichiers.
  Profession_<Métier>.png         -> icons/prof/<métier>.png
Les autres fichiers sont listés et ignorés.
"""
import re, shutil, sys
from pathlib import Path

# Spés du site (packages/game-data/src/core.ts, CLASS_SPECS) et arbres de talents du jeu, dans l'ordre
SPECS = {
    "warrior": (["Arms", "Fury", "Protection"], ["Arms", "Fury", "Protection"]),
    "paladin": (["Holy", "Protection", "Retribution"], ["Holy Heal", "Holy DPS", "Protection", "Retribution"]),
    "hunter": (["Beast Mastery", "Marksmanship", "Survival"], ["Beast Mastery", "Marksmanship", "Survival"]),
    "rogue": (["Assassination", "Combat", "Subtlety"], ["Assassination", "Combat", "Subtlety"]),
    "priest": (["Discipline", "Holy", "Shadow"], ["Discipline Heal", "Discipline DPS", "Holy", "Shadow"]),
    "shaman": (["Elemental", "Enhancement", "Restoration"], ["Elemental", "Enhancement DPS", "Enhancement Tank", "Restoration"]),
    "mage": (["Arcane", "Fire", "Frost"], ["Arcane", "Fire", "Frost"]),
    "warlock": (["Affliction", "Demonology", "Destruction"], ["Affliction", "Demonology", "Destruction"]),
    "druid": (["Balance", "Feral Combat", "Restoration"], ["Balance", "Feral Cat", "Feral Bear", "Restoration"]),
}
# Arbre de chaque spé (même ordre que SPECS) : sert quand le fichier porte le nom d'un arbre
TREE_OF = {
    "warrior": [0, 1, 2], "paladin": [0, 0, 1, 2], "hunter": [0, 1, 2], "rogue": [0, 1, 2], "priest": [0, 0, 1, 2],
    "shaman": [0, 1, 1, 2], "mage": [0, 1, 2], "warlock": [0, 1, 2], "druid": [0, 1, 1, 2],
}
# Autres noms courants (ceux du jeu moderne notamment)
ALIASES = {
    ("druid", "guardian"): ["Feral Bear"], ("druid", "feralguardian"): ["Feral Bear"], ("druid", "bear"): ["Feral Bear"], ("druid", "feralbear"): ["Feral Bear"],
    ("druid", "cat"): ["Feral Cat"], ("druid", "feral"): ["Feral Cat"], ("druid", "feralcat"): ["Feral Cat"],
    ("shaman", "enhancementtank"): ["Enhancement Tank"], ("shaman", "enhancementtankrockbiter"): ["Enhancement Tank"],
    ("shaman", "rockbiter"): ["Enhancement Tank"], ("shaman", "enhancementdps"): ["Enhancement DPS"],
}

key = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def specs_for(cls: str, name: str) -> list[str]:
    trees, specs = SPECS[cls]
    k = key(name)
    if (cls, k) in ALIASES:
        return ALIASES[(cls, k)]
    exact = [s for s in specs if key(s) == k]
    if exact:
        return exact
    tree = [i for i, t in enumerate(trees) if key(t) == k]
    if tree:
        return [s for s, t in zip(specs, TREE_OF[cls]) if t == tree[0]]
    return []


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("icons")
    if not src or not src.is_dir():
        sys.exit(__doc__)
    done, skipped = 0, []
    # Fichiers d'une spé précise après ceux d'un arbre entier : Shaman3-EnhancementTank l'emporte sur Shaman2-Enhancement
    tree_named = lambda f: (m := re.fullmatch(r"([a-z]+)\d*[_-](.+)", f.stem, re.I)) is not None and m[1].lower() in SPECS \
        and len(specs_for(m[1].lower(), m[2])) > 1
    for f in sorted(src.iterdir(), key=lambda f: (not tree_named(f), f.name)):
        if f.suffix.lower() not in (".png", ".webp", ".jpg", ".jpeg") or not f.is_file():
            continue
        stem, ext = f.stem, f.suffix.lower()
        targets = []
        if m := re.fullmatch(r"classicon[_-]([a-z]+)", stem, re.I):
            if m[1].lower() in SPECS:
                targets = [dst / "class" / f"{m[1].lower()}{ext}"]
        elif m := re.fullmatch(r"([a-z]+)(\d*)[_-](.+)", stem, re.I):
            cls = m[1].lower()
            if cls in SPECS:
                targets = [dst / "spec" / f"{cls}-{slug(s)}{ext}" for s in specs_for(cls, m[3])]
            elif cls == "profession":
                targets = [dst / "prof" / f"{slug(m[3])}{ext}"]
        if not targets:
            skipped.append(f.name)
            continue
        for target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, target)
            target.chmod(0o644)
            print(f"{f.name} -> {target}")
            done += 1
    print(f"\n{done} icône(s) rangée(s).")
    if skipped:
        print("Ignorées (nom non reconnu) :", ", ".join(skipped))


if __name__ == "__main__":
    main()
