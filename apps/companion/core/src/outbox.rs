//! Blocs à envoyer, rangés par l'addon (1.3+) dans sa sauvegarde à chaque déconnexion ou `/reload` :
//!
//! ```lua
//! ForeverRosterDB.outbox = { v = 1, at = <unix>, addon = "1.6.2", blocks = {
//!   { kind = "frc", key = "Tournicoti-Forever EU", sig = "…", text = "FRC;2;…" },
//!   { kind = "frb", key = "frb:<raid>", sig = "<updated>", lead = true, text = "FRB;2;…" },
//!   { kind = "frl", key = "frl:<guilde>-<royaume>-<faction>", sig = "<forme stable>", text = "FRL;1;…" },
//! } }
//! ```
//! (docs/addon-format.md, sections FRL et Roster Companion). Les blocs mal formés sont écartés un par un.

use crate::lua::{LuaError, LuaValue, find_global};

pub const SAVED_VARIABLE: &str = "ForeverRosterDB";
/// Garde-fous : taille d'un bloc, nombre de blocs (50 persos et quelques bilans en pratique).
const MAX_TEXT: usize = 64 * 1024;
/// Relevé de guilde (FRL, addon 1.6.2) : une guilde de 1 000 membres.
pub const MAX_TEXT_FRL: usize = 256 * 1024;
const MAX_BLOCKS: usize = 200;
/// Clé d'un bloc : le nom de guilde (60 octets), le royaume et la faction tiennent dans 160.
const MAX_KEY: usize = 160;
const MAX_SIG: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    /// Perso (export FRC).
    Frc,
    /// Bilan de raid (export FRB).
    Frb,
    /// Relevé de la guilde (FRL, un bloc par guilde).
    Frl,
}

impl BlockKind {
    /// Début du texte d'un bloc de ce type, préfixe obligatoire de sa clé, taille maximale de son texte.
    fn rules(self) -> (&'static str, Option<&'static str>, usize) {
        match self {
            BlockKind::Frc => ("FRC;", None, MAX_TEXT),
            BlockKind::Frb => ("FRB;", Some("frb:"), MAX_TEXT),
            BlockKind::Frl => ("FRL;", Some("frl:"), MAX_TEXT_FRL),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    pub key: String,
    pub sig: String,
    /// Bilan relevé par le chef de raid : seul celui-là part tout seul.
    pub lead: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Outbox {
    pub at: i64,
    pub addon: String,
    pub blocks: Vec<Block>,
}

#[derive(Debug, thiserror::Error)]
pub enum OutboxError {
    #[error("sauvegarde illisible ({0})")]
    Parse(#[from] LuaError),
}

/// Outbox d'une sauvegarde ; None si l'addon n'en a pas écrit (addon plus ancien que 1.3, jamais déconnecté).
pub fn read_outbox(saved_variables: &[u8]) -> Result<Option<Outbox>, OutboxError> {
    let Some(LuaValue::Table(db)) = find_global(saved_variables, SAVED_VARIABLE)? else {
        return Ok(None);
    };
    let Some(ob) = db.table("outbox") else { return Ok(None) };
    if ob.num("v") != Some(1.0) {
        return Ok(None);
    }
    let mut out = Outbox {
        at: ob.num("at").filter(|n| n.is_finite()).map(|n| n as i64).unwrap_or(0),
        addon: ob.str("addon").unwrap_or("").chars().take(20).collect(),
        blocks: Vec::new(),
    };
    for b in ob.table("blocks").map(|t| t.array()).unwrap_or_default() {
        let Some(t) = b.as_table() else { continue };
        let kind = match t.str("kind") {
            Some("frc") => BlockKind::Frc,
            Some("frb") => BlockKind::Frb,
            Some("frl") => BlockKind::Frl,
            _ => continue,
        };
        let (Some(key), Some(sig), Some(text)) = (t.str("key"), t.str("sig"), t.str("text")) else {
            continue;
        };
        let (head, key_prefix, max_text) = kind.rules();
        if key.is_empty() || key.len() > MAX_KEY || sig.is_empty() || sig.len() > MAX_SIG || text.len() > max_text || !text.starts_with(head) {
            continue;
        }
        if key_prefix.is_some_and(|p| !key.starts_with(p) || key.len() == p.len()) {
            continue;
        }
        out.blocks.push(Block {
            kind,
            key: key.to_string(),
            sig: sig.to_string(),
            lead: t.get("lead").and_then(LuaValue::as_bool).unwrap_or(false),
            text: text.to_string(),
        });
        if out.blocks.len() >= MAX_BLOCKS {
            break;
        }
    }
    Ok(Some(out))
}

/// Nom affiché pour un bloc : le prénom de l'en-tête FRC, « bilan de « nom du raid » » ou « relevé de la guilde « nom » »
/// (l'addon traduit ces deux formes dans le compte rendu de l'onglet Synchro).
pub fn block_label(b: &Block) -> String {
    let head = b.text.lines().next().unwrap_or("");
    let f: Vec<&str> = head.split(';').collect();
    match b.kind {
        BlockKind::Frc => f.get(2).copied().unwrap_or(&b.key).to_string(),
        BlockKind::Frb => format!("bilan de « {} »", f.get(6).copied().filter(|s| !s.is_empty()).unwrap_or("raid")),
        BlockKind::Frl => format!("relevé de la guilde « {} »", f.get(2).copied().filter(|s| !s.is_empty()).unwrap_or("?")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SV: &str = r#"
ForeverRosterDB = {
["outbox"] = {
["v"] = 1,
["at"] = 1790000000,
["addon"] = "1.3.1",
["blocks"] = {
{
["kind"] = "frc",
["key"] = "Tournicoti-Forever EU",
["sig"] = "0a1b2c3d-118",
["text"] = "FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;1.3.1\nG;1:16866\nEND;1",
}, -- [1]
{
["kind"] = "frb",
["key"] = "frb:6f1c2a10-0000-4000-8000-000000000001",
["sig"] = "1790000500",
["lead"] = true,
["text"] = "FRB;2;6f1c2a10-0000-4000-8000-000000000001;1;2;Tournicoti;Vroum Vroum;Molten Core;1\nEND;0",
}, -- [2]
{
["kind"] = "frc",
["key"] = "Piege",
["sig"] = "x",
["text"] = "os.execute()",
}, -- [3]
{
["kind"] = "autre",
}, -- [4]
{
["kind"] = "frl",
["key"] = "frl:Les Veilleurs-Forever EU-Horde",
["sig"] = "5d2e9a01-4096",
["text"] = "FRL;1;Les Veilleurs;Horde;1790000000;Tournicoti;0;Officier;2;Forever EU;1.6.2\nM;Tournicoti Ventfeuille;DRUID;60;Officier;1;1;0;;;Player-4321-00000001\nM;Brindille;MAGE;24;Membre;3;0;30;;;Player-4321-00000002\nP;Tournicoti;60;0;0;1790000000;Player-4321-00000001\nEND;3",
}, -- [5]
{
["kind"] = "frl",
["key"] = "Les Veilleurs-Forever EU-Horde",
["sig"] = "x",
["text"] = "FRL;1;Sans préfixe de clé\nEND;0",
}, -- [6]
{
["kind"] = "frl",
["key"] = "frl:",
["sig"] = "x",
["text"] = "FRL;1;Clé vide\nEND;0",
}, -- [7]
{
["kind"] = "frl",
["key"] = "frl:Autre-Forever EU-Horde",
["sig"] = "x",
["text"] = "FRC;2;Mauvais type\nEND;0",
}, -- [8]
},
},
}
"#;

    #[test]
    fn lit_les_blocs_et_ecarte_les_mal_formes() {
        let ob = read_outbox(SV.as_bytes()).unwrap().unwrap();
        assert_eq!(ob.at, 1_790_000_000);
        assert_eq!(ob.addon, "1.3.1");
        assert_eq!(ob.blocks.len(), 3);
        assert_eq!(ob.blocks[0].kind, BlockKind::Frc);
        assert!(!ob.blocks[0].lead);
        assert!(ob.blocks[1].lead);
        assert_eq!(block_label(&ob.blocks[0]), "Tournicoti");
        assert_eq!(block_label(&ob.blocks[1]), "bilan de « Vroum Vroum »");
        // Relevé de la guilde (addon 1.6.2) : clé « frl:… », texte FRL ; sans ce préfixe, clé vide ou autre texte : écarté
        let frl = &ob.blocks[2];
        assert_eq!((frl.kind, frl.key.as_str(), frl.sig.as_str()), (BlockKind::Frl, GUILD_KEY, "5d2e9a01-4096"));
        assert!(frl.text.starts_with("FRL;1;Les Veilleurs;") && frl.text.ends_with("\nEND;3") && !frl.lead);
        assert_eq!(block_label(frl), "relevé de la guilde « Les Veilleurs »");
    }

    /// Blocs lus dans une outbox d'un seul bloc, écrite comme le jeu (chaîne Lua échappée).
    fn read_one(kind: &str, key: &str, text: &str) -> Vec<Block> {
        let sv = format!(
            "ForeverRosterDB = {{ [\"outbox\"] = {{ [\"v\"] = 1, [\"at\"] = 1, [\"blocks\"] = {{ {{ [\"kind\"] = \"{kind}\", [\"key\"] = \"{key}\", [\"sig\"] = \"s\", [\"text\"] = \"{}\" }} }} }} }}",
            text.replace('\n', "\\n")
        );
        read_outbox(sv.as_bytes()).unwrap().unwrap().blocks
    }
    const GUILD_KEY: &str = "frl:Les Veilleurs-Forever EU-Horde";

    #[test]
    fn releve_de_guilde_jusqu_a_256_kio() {
        // Guilde de 1 000 membres : un bloc FRL bien plus gros qu'un perso, accepté jusqu'à 256 Kio
        let line = format!("M;{};DRUID;60;Membre;3;0;12;;;Player-4321-0000ABCD\n", "x".repeat(200));
        let body = line.repeat((MAX_TEXT_FRL - 200) / line.len());
        let text = format!("FRL;1;Les Veilleurs;Horde;1;Tournicoti;0;Membre;1000;Forever EU;1.6.2\n{body}END;1000");
        assert!(text.len() > MAX_TEXT && text.len() <= MAX_TEXT_FRL, "{}", text.len());
        let blocks = read_one("frl", GUILD_KEY, &text);
        assert_eq!((blocks.len(), blocks[0].text.len()), (1, text.len()));
        // Au-delà de 256 Kio : écarté ; un perso (FRC) reste limité à 64 Kio
        let big = format!("{text}{}", "x".repeat(MAX_TEXT_FRL + 1 - text.len()));
        assert!(read_one("frl", GUILD_KEY, &big).is_empty());
        let frc = format!("FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1;1.6.2\n{}END;0", "x".repeat(MAX_TEXT));
        assert!(read_one("frc", "Tournicoti-Forever EU", &frc).is_empty());
    }

    #[test]
    fn sans_outbox() {
        assert!(read_outbox(b"ForeverRosterDB = { [\"chars\"] = {} }").unwrap().is_none());
        assert!(read_outbox(b"AutreAddonDB = {}").unwrap().is_none());
        assert!(read_outbox(b"ForeverRosterDB = { [\"outbox\"] = { [\"v\"] = 2 } }").unwrap().is_none());
        assert!(read_outbox(b"ForeverRosterDB = {").is_err());
    }
}
