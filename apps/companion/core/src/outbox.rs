//! Blocs à envoyer, rangés par l'addon (1.3+) dans sa sauvegarde à chaque déconnexion ou `/reload` :
//!
//! ```lua
//! ForeverRosterDB.outbox = { v = 1, at = <unix>, addon = "1.3.0", blocks = {
//!   { kind = "frc", key = "Tournicoti-Forever EU", sig = "…", text = "FRC;2;…" },
//!   { kind = "frb", key = "frb:<raid>", sig = "<updated>", lead = true, text = "FRB;2;…" },
//! } }
//! ```
//! (docs/addon-format.md, section Roster Companion). Les blocs mal formés sont écartés un par un.

use crate::lua::{LuaError, LuaValue, find_global};

pub const SAVED_VARIABLE: &str = "ForeverRosterDB";
/// Garde-fous : taille d'un bloc, nombre de blocs (50 persos et quelques bilans en pratique).
const MAX_TEXT: usize = 64 * 1024;
const MAX_BLOCKS: usize = 200;
const MAX_KEY: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    /// Perso (export FRC).
    Frc,
    /// Bilan de raid (export FRB).
    Frb,
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
            _ => continue,
        };
        let (Some(key), Some(sig), Some(text)) = (t.str("key"), t.str("sig"), t.str("text")) else {
            continue;
        };
        let prefix = if kind == BlockKind::Frc { "FRC;" } else { "FRB;" };
        if key.is_empty() || key.len() > MAX_KEY || sig.is_empty() || sig.len() > MAX_KEY || text.len() > MAX_TEXT || !text.starts_with(prefix) {
            continue;
        }
        if kind == BlockKind::Frb && !key.starts_with("frb:") {
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

/// Prénom affiché pour un bloc : celui de l'en-tête FRC, sinon « bilan de « nom du raid » ».
pub fn block_label(b: &Block) -> String {
    let head = b.text.lines().next().unwrap_or("");
    let f: Vec<&str> = head.split(';').collect();
    match b.kind {
        BlockKind::Frc => f.get(2).copied().unwrap_or(&b.key).to_string(),
        BlockKind::Frb => format!("bilan de « {} »", f.get(6).copied().filter(|s| !s.is_empty()).unwrap_or("raid")),
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
},
},
}
"#;

    #[test]
    fn lit_les_blocs_et_ecarte_les_mal_formes() {
        let ob = read_outbox(SV.as_bytes()).unwrap().unwrap();
        assert_eq!(ob.at, 1_790_000_000);
        assert_eq!(ob.addon, "1.3.1");
        assert_eq!(ob.blocks.len(), 2);
        assert_eq!(ob.blocks[0].kind, BlockKind::Frc);
        assert!(!ob.blocks[0].lead);
        assert!(ob.blocks[1].lead);
        assert_eq!(block_label(&ob.blocks[0]), "Tournicoti");
        assert_eq!(block_label(&ob.blocks[1]), "bilan de « Vroum Vroum »");
    }

    #[test]
    fn sans_outbox() {
        assert!(read_outbox(b"ForeverRosterDB = { [\"chars\"] = {} }").unwrap().is_none());
        assert!(read_outbox(b"AutreAddonDB = {}").unwrap().is_none());
        assert!(read_outbox(b"ForeverRosterDB = { [\"outbox\"] = { [\"v\"] = 2 } }").unwrap().is_none());
        assert!(read_outbox(b"ForeverRosterDB = {").is_err());
    }
}
