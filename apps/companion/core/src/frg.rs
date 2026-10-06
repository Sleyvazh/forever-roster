//! Ce qui a changé entre deux relevés des données des groupes (FRG), pour la notification « nouveautés prêtes » :
//! « raid « Molten Core » », « groupe « Les Veilleurs » »… Seulement des libellés : le texte n'est jamais interprété
//! autrement (docs/addon-format.md, section FRG).

use std::collections::BTreeMap;

/// Lignes rattachées à un raid par leur 2e champ (inscriptions, soft reserve, consommables, fiches, conseil…).
const RAID_LINES: [&str; 7] = ["R", "S", "C", "F", "T", "L", "I"];

#[derive(Debug, Default)]
struct Parsed {
    /// (groupe, raid) → lignes ; raid vide pour les lignes du groupe (patrons, BiS, conseil, objets reçus).
    parts: BTreeMap<(String, String), Vec<String>>,
    group_names: BTreeMap<String, String>,
    raid_names: BTreeMap<(String, String), String>,
}

fn parse(text: &str) -> Parsed {
    let mut p = Parsed::default();
    let mut group = String::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split(';').collect();
        match fields[0] {
            "FRG" => {
                group = fields.get(2).unwrap_or(&"").to_string();
                p.group_names.insert(group.clone(), fields.get(4..).map(|f| f.join(";")).unwrap_or_default());
            }
            "END" => {}
            kind if RAID_LINES.contains(&kind) && fields.len() > 1 => {
                let raid = fields[1].to_string();
                if kind == "R" {
                    p.raid_names.insert((group.clone(), raid.clone()), fields.get(3).unwrap_or(&"").to_string());
                }
                p.parts.entry((group.clone(), raid)).or_default().push(line.to_string());
            }
            _ => p.parts.entry((group.clone(), String::new())).or_default().push(line.to_string()),
        }
    }
    for lines in p.parts.values_mut() {
        lines.sort();
    }
    p
}

/// Libellés de ce qui est nouveau ou modifié dans `new` par rapport à `old` (raids retirés ignorés), au plus `max`.
pub fn changes(old: &str, new: &str, max: usize) -> Vec<String> {
    let (a, b) = (parse(old), parse(new));
    let mut out = Vec::new();
    for (key, lines) in &b.parts {
        if a.parts.get(key) == Some(lines) {
            continue;
        }
        let (group, raid) = key;
        let label = if raid.is_empty() {
            format!("groupe « {} »", b.group_names.get(group).map(String::as_str).unwrap_or("?"))
        } else {
            format!("raid « {} »", b.raid_names.get(key).map(String::as_str).unwrap_or("?"))
        };
        if !out.contains(&label) {
            out.push(label);
        }
    }
    let total = out.len();
    if total > max {
        out.truncate(max);
        out.push(format!("et {} autre{}", total - max, if total - max > 1 { "s" } else { "" }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD: &str = "FRG;1;g1;1790000000;Les Veilleurs\nR;r1;1790100000;Molten Core;present;John;softres\nR;r2;1790200000;Onyxia;;;journal\nP;15090;Warbear;Greta;\nEND;3\nS;r1;16901;John:0\nFRG;1;g2;1790000000;Testing\nR;r3;0;Zul'Gurub;;;journal\nEND;1";

    #[test]
    fn rien_de_change_malgre_les_dates_de_generation() {
        let new = OLD.replace("1790000000", "1790009999");
        assert!(changes(OLD, &new, 3).is_empty());
    }

    #[test]
    fn raid_modifie_par_sa_ligne_ou_ses_lignes_rattachees() {
        let new = OLD.replace("S;r1;16901;John:0", "S;r1;16901;John:1");
        assert_eq!(changes(OLD, &new, 3), vec!["raid « Molten Core »"]);
        let new = OLD.replace("Onyxia;;;journal", "Onyxia;late;John;journal");
        assert_eq!(changes(OLD, &new, 3), vec!["raid « Onyxia »"]);
    }

    #[test]
    fn groupe_modifie_raid_ajoute_et_raid_retire() {
        let new = OLD.replace("P;15090;Warbear;Greta;", "P;15090;Warbear;Greta,Sley;");
        assert_eq!(changes(OLD, &new, 3), vec!["groupe « Les Veilleurs »"]);
        let new = OLD.replace("END;1", "R;r4;1790300000;Blackwing Lair;;;council\nEND;2");
        assert_eq!(changes(OLD, &new, 3), vec!["raid « Blackwing Lair »"]);
        let new = OLD.replace("R;r2;1790200000;Onyxia;;;journal\n", "");
        assert!(changes(OLD, &new, 3).is_empty(), "un raid retiré n'est pas une nouveauté à charger");
    }

    #[test]
    fn premier_releve_et_limite() {
        assert_eq!(changes("", OLD, 2), vec!["groupe « Les Veilleurs »", "raid « Molten Core »", "et 2 autres"]);
        assert_eq!(changes("", OLD, 4).len(), 4);
    }
}
