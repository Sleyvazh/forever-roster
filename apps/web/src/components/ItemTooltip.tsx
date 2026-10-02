import { BOND_LABEL, compareItems, INVENTORY_LABEL, itemLinks, money, statLine, subclassFr, TRIGGER_LABEL } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { get, type GameItem, type ItemSources } from "../api";
import { glyphFor } from "./ItemGlyphs";

/* Icônes introuvables sur le serveur (pas encore téléchargées) : retenues pour toute la page. */
const failedIcons = new Set<string>();
const listeners = new Set<() => void>();
let failures = 0;
function markFailed(icon: string) {
  if (failedIcons.has(icon)) return;
  failedIcons.add(icon); failures++;
  listeners.forEach(l => l());
}
/** Pour réafficher un repli quand une icône s'avère introuvable. */
export function useIconFailures() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => failures);
}
export const iconUsable = (icon?: string) => !!icon && !failedIcons.has(icon);

/** Icône d'objet servie par notre serveur (/icons/items/, fichiers de Blizzard hors dépôt) ; repli : cadre de la couleur de qualité. */
export function ItemIcon({ item, size = 36, className }: { item?: Pick<GameItem, "quality" | "details" | "inventoryType"> | null; size?: number; className?: string }) {
  useIconFailures();
  const icon = item?.details?.icon;
  const style = { width: size, height: size, ["--qc" as string]: item ? `var(--q${item.quality})` : "var(--line-2)" };
  if (!iconUsable(icon)) {
    return (
      <span className={`iicon none ${className ?? ""}`} style={style} aria-hidden="true">
        <svg><use href={`#g-${glyphFor(item?.inventoryType)}`} /></svg>
      </span>
    );
  }
  return (
    <span className={`iicon ${className ?? ""}`} style={style} aria-hidden="true">
      <img src={`/icons/items/${icon}.jpg`} width={size} height={size} alt="" loading="lazy" decoding="async" onError={() => markFailed(icon!)} />
    </span>
  );
}

/** « Où l'obtenir » : recettes, patrons et artisans connus (chargé seulement pour un objet fabriqué). */
function ItemSourcesBlock({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["item-sources", id], queryFn: () => get<ItemSources>(`/gamedata/items/${id}/sources`), staleTime: 60_000 });
  const list = q.data?.crafted ?? [];
  if (q.isPending) return <div className="t-src t-where">Où l'obtenir…</div>;
  if (!list.length) return null;
  return (
    <div className="t-where">
      <div className="t-yellow">Où l'obtenir</div>
      {list.map(r => (
        <div key={r.spellId} className="t-row">
          Fabriqué : {r.profession} ({r.reqSkill})
          <div className="t-dim t-in">{r.trainer ? "Appris chez un entraîneur" : r.patterns.length ? [...new Set(r.patterns.map(p => p.name))].join(", ") : "Patron inconnu"}</div>
          <div className={`t-in ${r.crafters.length ? "t-green" : "t-dim"}`}>
            {r.crafters.length ? `Connu par : ${r.crafters.map(c => (c.mine ? `${c.name} (toi)` : `${c.name} (${c.owner})`)).join(", ")}` : "Personne dans tes groupes ne le connaît."}
          </div>
          {!!r.wanted?.length && <div className="t-in t-yellow">
            Recherché par : {r.wanted!.map(c => (c.mine ? `${c.name} (toi)` : `${c.name} (${c.owner})`)).join(", ")}
          </div>}
        </div>
      ))}
    </div>
  );
}


/**
 * Infobulle d'objet comme en jeu : qualité, lien, emplacement, armure ou dégâts, caractéristiques,
 * niveaux, effets, set, prix. `compare` ajoute les écarts avec un autre objet (équipé ou objectif BiS).
 */
export function ItemTooltipBody({ item, compare, compareLabel, owned, note }: {
  item: GameItem; compare?: GameItem | null; compareLabel?: string; owned?: Set<string>; note?: ReactNode;
}) {
  const d = item.details ?? {};
  const lines = (d.stats ?? []).map(([t, v]) => statLine(t, v));
  const primary = lines.filter(l => l.kind === "primary"), equip = lines.filter(l => l.kind === "equip");
  const sub = subclassFr(item.kind.split(" · ").at(-1));
  const diffs = compare ? compareItems(compare, item) : [];
  const setOwned = d.set ? d.set.items.filter(n => owned?.has(n)).length : 0;
  return (
    <>
      <div className="t-head">
        <ItemIcon item={item} size={38} />
        <div>
          <div className={`t-name tq${item.quality}`}>{item.name}</div>
          {d.bond ? <div className="t-row">{BOND_LABEL[d.bond]}</div> : null}
          {d.unique && <div className="t-row">Unique</div>}
        </div>
      </div>
      {(INVENTORY_LABEL[item.inventoryType] || sub) && (
        <div className="t-row t-split"><span>{INVENTORY_LABEL[item.inventoryType] ?? ""}</span><span>{sub}</span></div>
      )}
      {d.dmg && (
        <>
          <div className="t-row t-split"><span>{d.dmg.min} - {d.dmg.max} Dégâts</span><span>Vitesse {d.dmg.speed.toFixed(2).replace(".", ",")}</span></div>
          <div className="t-row">({String(d.dmg.dps).replace(".", ",")} dégâts par seconde)</div>
        </>
      )}
      {d.armor ? <div className="t-row">{d.armor} Armure</div> : null}
      {primary.map((l, i) => <div key={`p${i}`} className="t-row">{l.text}</div>)}
      {item.reqLevel > 0 && <div className="t-row">Niveau {item.reqLevel} requis</div>}
      <div className="t-row t-ilvl">Niveau d'objet {item.itemLevel}</div>
      {equip.map((l, i) => <div key={`e${i}`} className="t-green">Équipé : {l.text}</div>)}
      {(d.effects ?? []).map((e, i) => <div key={`f${i}`} className="t-green">{TRIGGER_LABEL[e.trigger]} : {e.text}</div>)}
      {d.set && (
        <div className="t-set">
          <div className="t-yellow">{d.set.name} ({setOwned}/{d.set.items.length})</div>
          {d.set.items.map(n => <div key={n} className={owned?.has(n) ? "t-row t-in" : "t-dim t-in"}>{n}</div>)}
          {d.set.bonuses.map((b, i) => <div key={i} className={setOwned >= b.n ? "t-green" : "t-dim"}>({b.n}) Ensemble : {b.text}</div>)}
        </div>
      )}
      {d.sell ? <div className="t-row t-sell">Prix de vente : {money(d.sell)}</div> : null}
      {item.crafted && <ItemSourcesBlock id={item.id} />}
      {item.origin === "era" && <div className="t-src">Données de Classic Era : l'objet n'est pas encore connu sur Forever, ses stats peuvent différer.</div>}
      {compare && diffs.length > 0 && (
        <div className="t-cmp">
          <div className="t-src">{compareLabel ?? "Par rapport à"} {compare.name} :</div>
          {diffs.map(x => <div key={x.label} className={x.delta > 0 ? "t-up" : "t-down"}>{x.delta > 0 ? "+" : ""}{String(x.delta).replace(".", ",")} {x.label}</div>)}
        </div>
      )}
      {note}
    </>
  );
}

/** Infobulle flottante, placée à côté de l'élément survolé sans jamais sortir de l'écran. */
export function FloatingTip({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: rect.right + 8, top: rect.top });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = rect.right + 8, top = rect.top;
    if (left + w > innerWidth - 12) left = rect.left - w - 8;
    if (left < 12) { left = Math.max(12, Math.min(rect.left, innerWidth - w - 12)); top = rect.bottom + 6; }
    if (top + h > innerHeight - 12) top = Math.max(12, innerHeight - h - 12);
    setPos({ left, top });
  }, [rect]);
  return <div className="itip" ref={ref} role="tooltip" style={pos}>{children}</div>;
}

/**
 * Enveloppe : affiche l'infobulle de l'objet au survol ou au focus clavier.
 * Avec `link`, l'objet entier est un lien vers sa fiche Wowhead (nouvel onglet).
 */
export function ItemHover({ item, compare, compareLabel, children, className, link }: {
  item?: GameItem | null; compare?: GameItem | null; compareLabel?: string; children: ReactNode; className?: string; link?: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  if (!item) return <>{children}</>;
  const show = (el: HTMLElement) => setRect(el.getBoundingClientRect());
  const events = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget), onMouseLeave: () => setRect(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget), onBlur: () => setRect(null),
  };
  const tip = rect && <FloatingTip rect={rect}><ItemTooltipBody item={item} compare={compare} compareLabel={compareLabel} /></FloatingTip>;
  if (link) {
    return (
      <a className={`ihover ilink ${className ?? ""}`} href={itemLinks(item.id).wowhead} target="_blank" rel="noopener noreferrer" {...events}>
        {children}<span className="sr-only"> (Wowhead, nouvel onglet)</span>{tip}
      </a>
    );
  }
  return <span className={`ihover ${className ?? ""}`} tabIndex={0} {...events}>{children}{tip}</span>;
}
