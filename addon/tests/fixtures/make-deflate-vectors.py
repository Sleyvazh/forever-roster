#!/usr/bin/env python3
# Vecteurs de test du décompresseur de l'addon (addon/ForeverRoster/Inflate.lua, lu par inflate_test.lua) :
# flux « deflate » bruts produits par zlib, un autre compresseur que LibDeflate (niveaux 0, 1 et 9, codes fixes,
# Huffman seul).   python3 addon/tests/fixtures/make-deflate-vectors.py   (depuis la racine du dépôt)
import random
import zlib
from pathlib import Path

here = Path(__file__).resolve().parent


def raw(data, level, strategy=zlib.Z_DEFAULT_STRATEGY):
    c = zlib.compressobj(level, zlib.DEFLATED, -15, 9, strategy)
    return c.compress(data) + c.flush()


random.seed(20261112)
frg = (here.parent / "sample.frg").read_bytes()
cases = [
    ("vide", b""),
    ("un octet", b"a"),
    ("répétitions", b"hello hello hello hello hello hello"),
    ("tous les octets", bytes(range(256)) * 3),
    ("longue série", b"\x00" * 5000 + b"fin"),
    ("aléatoire", bytes(random.randrange(256) for _ in range(700))),
    ("bloc du site", frg[:1200]),
]
variants = [("0", 0, zlib.Z_DEFAULT_STRATEGY), ("1", 1, zlib.Z_DEFAULT_STRATEGY), ("9", 9, zlib.Z_DEFAULT_STRATEGY),
            ("6 fixe", 6, zlib.Z_FIXED), ("6 huffman", 6, zlib.Z_HUFFMAN_ONLY)]
out = ["-- Flux « deflate » bruts produits par zlib (make-deflate-vectors.py), pour inflate_test.lua :",
       "-- { nom, entrée en hexadécimal, { { variante, flux en hexadécimal }, … } }. Fichier généré : ne pas modifier.",
       "return {"]
for name, data in cases:
    rows = []
    for tag, level, strategy in variants:
        z = raw(data, level, strategy)
        assert zlib.decompress(z, -15) == data
        rows.append('{ "%s", "%s" }' % (tag, z.hex()))
    out.append('  { "%s", "%s", { %s } },' % (name, data.hex(), ", ".join(rows)))
out.append("}")
(here / "deflate_vectors.lua").write_text("\n".join(out) + "\n", encoding="utf-8")
print(len(cases) * len(variants), "vecteurs")
