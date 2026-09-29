#!/usr/bin/env python3
"""Range des icônes reçues dans le dossier icons/ servi par Caddy, en les renommant.

Usage : python3 scripts/normalize-icons.py <dossier reçu> [dossier icons, défaut ./icons]

Noms reconnus (majuscules indifférentes) :
  ClassIcon_<classe>.png             -> icons/class/<classe>.png
  <Classe><1|2|3>-<Arbre>.png        -> icons/tree/<classe>-<n>.png   (n = ordre de l'arbre dans le jeu)
  Profession_<Métier>.png            -> icons/prof/<métier>.png
Les autres fichiers sont listés et ignorés.
"""
import re, shutil, sys
from pathlib import Path

CLASSES = {"warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
dst = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("icons")
if not src or not src.is_dir():
    sys.exit(__doc__)

done, skipped = 0, []
for f in sorted(src.iterdir()):
    if f.suffix.lower() not in (".png", ".webp", ".jpg", ".jpeg") or not f.is_file():
        continue
    stem, ext = f.stem, f.suffix.lower()
    target = None
    if m := re.fullmatch(r"classicon[_-]([a-z]+)", stem, re.I):
        if m[1].lower() in CLASSES:
            target = dst / "class" / f"{m[1].lower()}{ext}"
    elif m := re.fullmatch(r"([a-z]+)([123])[_-](.+)", stem, re.I):
        if m[1].lower() in CLASSES:
            target = dst / "tree" / f"{m[1].lower()}-{m[2]}{ext}"
    elif m := re.fullmatch(r"profession[_-](.+)", stem, re.I):
        target = dst / "prof" / f"{slug(m[1])}{ext}"
    if not target:
        skipped.append(f.name)
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(f, target)
    target.chmod(0o644)
    print(f"{f.name} -> {target}")
    done += 1

print(f"\n{done} icône(s) rangée(s).")
if skipped:
    print("Ignorées (nom non reconnu) :", ", ".join(skipped))
