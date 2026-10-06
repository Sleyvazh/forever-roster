//! Lecture d'une sauvegarde d'addon WoW (`WTF\Account\<compte>\SavedVariables\<Addon>.lua`).
//!
//! Le jeu y écrit des affectations `Nom = valeur` où la valeur est une table, une chaîne, un nombre, un booléen
//! ou `nil`. Ce fichier n'est **jamais exécuté** : on le lit avec un analyseur de données qui ne connaît que ces
//! formes. Tout le reste (appel de fonction, opérateur, variable) est une erreur, sauf quelques valeurs que le jeu
//! écrit parfois pour des nombres spéciaux (`inf`, `nan`, `-nan(ind)`), lues comme nombres.
//!
//! Limites : profondeur de tables bornée (pas de débordement de pile sur un fichier piégé), taille vérifiée par
//! l'appelant.

use std::fmt;

/// Profondeur maximale des tables imbriquées (la sauvegarde de Forever Roster n'en a pas dix).
pub const MAX_DEPTH: usize = 128;

#[derive(Debug, Clone, PartialEq)]
pub enum LuaValue {
    Nil,
    Bool(bool),
    Num(f64),
    Str(String),
    Table(LuaTable),
}

/// Clé d'une table : entier (tableau), chaîne, ou autre valeur scalaire (rare).
#[derive(Debug, Clone, PartialEq)]
pub enum LuaKey {
    Int(i64),
    Str(String),
    Num(f64),
    Bool(bool),
}

/// Table dans l'ordre du fichier (le jeu écrit les clés dans un ordre quelconque : on le garde tel quel).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LuaTable {
    pub entries: Vec<(LuaKey, LuaValue)>,
}

impl LuaTable {
    /// Valeur d'une clé chaîne (la dernière gagne, comme en Lua).
    pub fn get(&self, key: &str) -> Option<&LuaValue> {
        self.entries.iter().rev().find_map(|(k, v)| match k {
            LuaKey::Str(s) if s == key => Some(v),
            _ => None,
        })
    }

    /// Partie « tableau » : valeurs des clés entières 1, 2, 3… dans l'ordre, jusqu'au premier trou.
    pub fn array(&self) -> Vec<&LuaValue> {
        let mut out = Vec::new();
        let mut i: i64 = 1;
        loop {
            let found = self.entries.iter().rev().find_map(|(k, v)| match k {
                LuaKey::Int(n) if *n == i => Some(v),
                LuaKey::Num(n) if *n == i as f64 => Some(v),
                _ => None,
            });
            match found {
                Some(LuaValue::Nil) | None => break,
                Some(v) => out.push(v),
            }
            i += 1;
        }
        out
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(LuaValue::as_str)
    }
    pub fn num(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(LuaValue::as_num)
    }
    pub fn table(&self, key: &str) -> Option<&LuaTable> {
        self.get(key).and_then(LuaValue::as_table)
    }
}

impl LuaValue {
    pub fn as_str(&self) -> Option<&str> {
        if let LuaValue::Str(s) = self { Some(s) } else { None }
    }
    pub fn as_num(&self) -> Option<f64> {
        if let LuaValue::Num(n) = self { Some(*n) } else { None }
    }
    pub fn as_bool(&self) -> Option<bool> {
        if let LuaValue::Bool(b) = self { Some(*b) } else { None }
    }
    pub fn as_table(&self) -> Option<&LuaTable> {
        if let LuaValue::Table(t) = self { Some(t) } else { None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LuaError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for LuaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ligne {} : {}", self.line, self.message)
    }
}
impl std::error::Error for LuaError {}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
    line: usize,
}

/// Lit toutes les affectations du fichier : `[(nom, valeur)]` dans l'ordre.
pub fn parse_saved_variables(src: &[u8]) -> Result<Vec<(String, LuaValue)>, LuaError> {
    let src = src.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(src);
    let mut p = Parser { src, pos: 0, line: 1 };
    let mut out = Vec::new();
    loop {
        p.skip_space()?;
        if p.eof() {
            return Ok(out);
        }
        let name = p.name().ok_or_else(|| p.err("nom de variable attendu"))?;
        p.skip_space()?;
        p.expect(b'=')?;
        let value = p.value(0)?;
        out.push((name, value));
        p.skip_space()?;
        if p.peek() == Some(b';') {
            p.pos += 1;
        }
    }
}

/// Valeur d'une variable globale de la sauvegarde (la dernière affectation gagne).
pub fn find_global(src: &[u8], name: &str) -> Result<Option<LuaValue>, LuaError> {
    Ok(parse_saved_variables(src)?.into_iter().rev().find(|(n, _)| n == name).map(|(_, v)| v))
}

impl<'a> Parser<'a> {
    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }
    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }
    fn peek_at(&self, off: usize) -> Option<u8> {
        self.src.get(self.pos + off).copied()
    }
    fn err(&self, message: &str) -> LuaError {
        LuaError {
            line: self.line,
            message: message.to_string(),
        }
    }
    fn bump(&mut self) -> Option<u8> {
        let c = self.peek()?;
        self.pos += 1;
        if c == b'\n' {
            self.line += 1;
        }
        Some(c)
    }

    fn expect(&mut self, c: u8) -> Result<(), LuaError> {
        if self.peek() == Some(c) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.err(&format!("« {} » attendu", c as char)))
        }
    }

    /// Espaces, retours à la ligne et commentaires (`-- …` et `--[[ … ]]`).
    fn skip_space(&mut self) -> Result<(), LuaError> {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\r' | b'\n' | 0x0B | 0x0C) => {
                    self.bump();
                }
                Some(b'-') if self.peek_at(1) == Some(b'-') => {
                    self.pos += 2;
                    if self.peek() == Some(b'[')
                        && let Some(level) = self.long_bracket_level()
                    {
                        self.long_string(level)?;
                        continue;
                    }
                    while let Some(c) = self.peek() {
                        if c == b'\n' {
                            break;
                        }
                        self.pos += 1;
                    }
                }
                _ => return Ok(()),
            }
        }
    }

    fn name(&mut self) -> Option<String> {
        let start = self.pos;
        match self.peek() {
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => {}
            _ => return None,
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == b'_' {
                self.pos += 1;
            } else {
                break;
            }
        }
        Some(String::from_utf8_lossy(&self.src[start..self.pos]).into_owned())
    }

    fn value(&mut self, depth: usize) -> Result<LuaValue, LuaError> {
        self.skip_space()?;
        match self.peek() {
            None => Err(self.err("valeur attendue, fin du fichier")),
            Some(b'{') => {
                if depth >= MAX_DEPTH {
                    return Err(self.err("tables trop imbriquées"));
                }
                self.table(depth + 1).map(LuaValue::Table)
            }
            Some(b'"' | b'\'') => self.short_string().map(LuaValue::Str),
            Some(b'[') => match self.long_bracket_level() {
                Some(level) => self.long_string(level).map(LuaValue::Str),
                None => Err(self.err("chaîne longue mal formée")),
            },
            Some(b'-') => {
                self.pos += 1;
                self.skip_space()?;
                match self.value(depth)? {
                    LuaValue::Num(n) => Ok(LuaValue::Num(-n)),
                    _ => Err(self.err("nombre attendu après « - »")),
                }
            }
            Some(c) if c.is_ascii_digit() || (c == b'.' && self.peek_at(1).is_some_and(|d| d.is_ascii_digit())) => self.number().map(LuaValue::Num),
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => {
                let word = self.name().unwrap_or_default();
                // Nombres spéciaux parfois écrits par le jeu : inf, nan, nan(ind)
                if self.peek() == Some(b'(') {
                    let close = self.src[self.pos..].iter().take(16).position(|&c| c == b')');
                    match close {
                        Some(n) if self.src[self.pos + 1..self.pos + n].iter().all(|c| c.is_ascii_alphanumeric()) => self.pos += n + 1,
                        _ => return Err(self.err("appel de fonction interdit dans une sauvegarde")),
                    }
                }
                match word.as_str() {
                    "true" => Ok(LuaValue::Bool(true)),
                    "false" => Ok(LuaValue::Bool(false)),
                    "nil" => Ok(LuaValue::Nil),
                    w if w.eq_ignore_ascii_case("inf") || w.eq_ignore_ascii_case("infinity") => Ok(LuaValue::Num(f64::INFINITY)),
                    w if w.eq_ignore_ascii_case("nan") => Ok(LuaValue::Num(f64::NAN)),
                    _ => Err(self.err(&format!("valeur inattendue « {word} »"))),
                }
            }
            Some(c) => Err(self.err(&format!("caractère inattendu « {} »", c as char))),
        }
    }

    fn table(&mut self, depth: usize) -> Result<LuaTable, LuaError> {
        self.expect(b'{')?;
        let mut t = LuaTable::default();
        let mut index: i64 = 1;
        loop {
            self.skip_space()?;
            match self.peek() {
                None => return Err(self.err("table non fermée (« } » manquant)")),
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(t);
                }
                Some(b'[') if self.long_bracket_level().is_none() => {
                    // [clé] = valeur
                    self.pos += 1;
                    let key = match self.value(depth)? {
                        LuaValue::Str(s) => LuaKey::Str(s),
                        LuaValue::Num(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => LuaKey::Int(n as i64),
                        LuaValue::Num(n) => LuaKey::Num(n),
                        LuaValue::Bool(b) => LuaKey::Bool(b),
                        _ => return Err(self.err("clé de table invalide")),
                    };
                    self.skip_space()?;
                    self.expect(b']')?;
                    self.skip_space()?;
                    self.expect(b'=')?;
                    let v = self.value(depth)?;
                    t.entries.push((key, v));
                }
                Some(c) if c.is_ascii_alphabetic() || c == b'_' => {
                    // nom = valeur, ou valeur positionnelle (true, false, nil…)
                    let save = (self.pos, self.line);
                    let word = self.name().unwrap_or_default();
                    self.skip_space()?;
                    if self.peek() == Some(b'=') && self.peek_at(1) != Some(b'=') {
                        self.pos += 1;
                        let v = self.value(depth)?;
                        t.entries.push((LuaKey::Str(word), v));
                    } else {
                        (self.pos, self.line) = save;
                        let v = self.value(depth)?;
                        t.entries.push((LuaKey::Int(index), v));
                        index += 1;
                    }
                }
                Some(_) => {
                    let v = self.value(depth)?;
                    t.entries.push((LuaKey::Int(index), v));
                    index += 1;
                }
            }
            self.skip_space()?;
            match self.peek() {
                Some(b',' | b';') => {
                    self.pos += 1;
                }
                Some(b'}') => {}
                None => return Err(self.err("table non fermée (« } » manquant)")),
                Some(c) => return Err(self.err(&format!("« , » ou « }} » attendu, trouvé « {} »", c as char))),
            }
        }
    }

    fn number(&mut self) -> Result<f64, LuaError> {
        let start = self.pos;
        if self.peek() == Some(b'0') && matches!(self.peek_at(1), Some(b'x' | b'X')) {
            self.pos += 2;
            let hs = self.pos;
            while self.peek().is_some_and(|c| c.is_ascii_hexdigit()) {
                self.pos += 1;
            }
            let digits = std::str::from_utf8(&self.src[hs..self.pos]).unwrap_or("");
            return u64::from_str_radix(digits, 16)
                .map(|n| n as f64)
                .map_err(|_| self.err("nombre hexadécimal illisible"));
        }
        while let Some(c) = self.peek() {
            let exp_sign = matches!(c, b'+' | b'-') && matches!(self.src.get(self.pos.wrapping_sub(1)), Some(b'e' | b'E'));
            if c.is_ascii_digit() || c == b'.' || c == b'e' || c == b'E' || exp_sign {
                self.pos += 1;
            } else {
                break;
            }
        }
        let text = std::str::from_utf8(&self.src[start..self.pos]).unwrap_or("");
        text.parse::<f64>().map_err(|_| self.err(&format!("nombre illisible « {text} »")))
    }

    fn short_string(&mut self) -> Result<String, LuaError> {
        let quote = self.bump().unwrap_or(b'"');
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = self.bump().ok_or_else(|| self.err("chaîne non fermée"))?;
            match c {
                c if c == quote => break,
                b'\n' => return Err(self.err("retour à la ligne dans une chaîne")),
                b'\\' => {
                    let e = self.bump().ok_or_else(|| self.err("chaîne non fermée"))?;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'a' => out.push(0x07),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0C),
                        b'v' => out.push(0x0B),
                        b'\\' => out.push(b'\\'),
                        b'"' => out.push(b'"'),
                        b'\'' => out.push(b'\''),
                        b'\n' => out.push(b'\n'),
                        b'\r' => {
                            out.push(b'\n');
                            if self.peek() == Some(b'\n') {
                                self.bump();
                            }
                        }
                        b'x' => {
                            let h = self.src.get(self.pos..self.pos + 2).ok_or_else(|| self.err("échappement \\x incomplet"))?;
                            let s = std::str::from_utf8(h).map_err(|_| self.err("échappement \\x illisible"))?;
                            let b = u8::from_str_radix(s, 16).map_err(|_| self.err("échappement \\x illisible"))?;
                            self.pos += 2;
                            out.push(b);
                        }
                        b'z' => {
                            while self.peek().is_some_and(|c| c.is_ascii_whitespace()) {
                                self.bump();
                            }
                        }
                        b'u' => {
                            self.expect(b'{')?;
                            let hs = self.pos;
                            while self.peek().is_some_and(|c| c.is_ascii_hexdigit()) {
                                self.pos += 1;
                            }
                            let s = std::str::from_utf8(&self.src[hs..self.pos]).unwrap_or("");
                            let cp = u32::from_str_radix(s, 16).map_err(|_| self.err("échappement \\u illisible"))?;
                            self.expect(b'}')?;
                            let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        d if d.is_ascii_digit() => {
                            let mut n: u32 = (d - b'0') as u32;
                            for _ in 0..2 {
                                match self.peek() {
                                    Some(c) if c.is_ascii_digit() => {
                                        n = n * 10 + (c - b'0') as u32;
                                        self.pos += 1;
                                    }
                                    _ => break,
                                }
                            }
                            if n > 255 {
                                return Err(self.err("échappement décimal trop grand"));
                            }
                            out.push(n as u8);
                        }
                        other => return Err(self.err(&format!("échappement inconnu « \\{} »", other as char))),
                    }
                }
                c => out.push(c),
            }
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    /// `[[`, `[=[`, `[==[`… : niveau du crochet long, sans avancer ; None si ce n'en est pas un.
    fn long_bracket_level(&self) -> Option<usize> {
        if self.peek() != Some(b'[') {
            return None;
        }
        let mut level = 0;
        loop {
            match self.peek_at(1 + level) {
                Some(b'=') => level += 1,
                Some(b'[') => return Some(level),
                _ => return None,
            }
        }
    }

    fn long_string(&mut self, level: usize) -> Result<String, LuaError> {
        self.pos += level + 2;
        // Un retour à la ligne juste après l'ouverture est ignoré
        if self.peek() == Some(b'\r') {
            self.bump();
        }
        if self.peek() == Some(b'\n') {
            self.bump();
        }
        let start = self.pos;
        loop {
            match self.peek() {
                None => return Err(self.err("chaîne longue non fermée")),
                Some(b']') => {
                    let close = (1..=level).all(|i| self.peek_at(i) == Some(b'=')) && self.peek_at(level + 1) == Some(b']');
                    if close {
                        let s = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
                        self.pos += level + 2;
                        return Ok(s);
                    }
                    self.bump();
                }
                Some(_) => {
                    self.bump();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(src: &str) -> LuaValue {
        let mut all = parse_saved_variables(src.as_bytes()).unwrap();
        assert_eq!(all.len(), 1);
        all.remove(0).1
    }

    #[test]
    fn lit_une_sauvegarde_ecrite_par_le_jeu() {
        let src = "\u{FEFF}\nForeverRosterDB = {\n[\"version\"] = \"1.3.0\",\n[\"chars\"] = {\n[\"Tournicoti-Forever EU\"] = {\n[\"sentSig\"] = \"0001a2b3-118\",\n[\"level\"] = 60,\n},\n},\n[\"list\"] = {\n\"a\", -- [1]\n\"b\", -- [2]\n},\n[\"flag\"] = true,\n[\"ratio\"] = -0.5,\n[\"big\"] = 1e+20,\n}\n";
        let v = one(src);
        let t = v.as_table().unwrap();
        assert_eq!(t.str("version"), Some("1.3.0"));
        let c = t.table("chars").unwrap().table("Tournicoti-Forever EU").unwrap();
        assert_eq!(c.num("level"), Some(60.0));
        let list: Vec<_> = t.table("list").unwrap().array().into_iter().filter_map(LuaValue::as_str).collect();
        assert_eq!(list, vec!["a", "b"]);
        assert_eq!(t.get("flag").and_then(LuaValue::as_bool), Some(true));
        assert_eq!(t.num("ratio"), Some(-0.5));
        assert_eq!(t.num("big"), Some(1e20));
    }

    #[test]
    fn echappements_et_utf8() {
        let v = one(r#"X = "FRC;2;Tournicoti\nG;1:16866\nbilan de « Vroum » \"ok\" \\ \065\066\x43 \u{E9}""#);
        assert_eq!(v.as_str().unwrap(), "FRC;2;Tournicoti\nG;1:16866\nbilan de « Vroum » \"ok\" \\ ABC é");
        assert_eq!(one("X = [==[ligne ]] dedans]==]").as_str(), Some("ligne ]] dedans"));
        assert_eq!(one("X = [[\nfin]]").as_str(), Some("fin"));
    }

    #[test]
    fn nombres_speciaux_ecrits_par_le_jeu() {
        let t = one("X = { inf, -inf, nan, -nan(ind), 0x1F, .5 }");
        let a = t.as_table().unwrap().array();
        assert_eq!(a.len(), 6);
        assert_eq!(a[0].as_num(), Some(f64::INFINITY));
        assert_eq!(a[1].as_num(), Some(f64::NEG_INFINITY));
        assert!(a[2].as_num().unwrap().is_nan());
        assert!(a[3].as_num().unwrap().is_nan());
        assert_eq!(a[4].as_num(), Some(31.0));
        assert_eq!(a[5].as_num(), Some(0.5));
    }

    #[test]
    fn plusieurs_variables_et_commentaires() {
        let all = parse_saved_variables(b"-- en-tete\nA = 1\n--[[ long\ncommentaire ]] B = { x = 2; y = 'z' }\nA = 3").unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(find_global(b"A = 1\nA = 3", "A").unwrap(), Some(LuaValue::Num(3.0)));
        assert_eq!(find_global(b"A = 1", "B").unwrap(), None);
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_des_donnees() {
        for bad in [
            "X = os.execute(\"calc\")",
            "X = loadstring(\"x\")()",
            "X = 1 + 2",
            "X = { a = b }",
            "X = \"non fermée",
            "X = { 1, 2",
            "X = function() end",
            "X = \"a\nb\"",
        ] {
            assert!(parse_saved_variables(bad.as_bytes()).is_err(), "{bad} aurait dû être refusé");
        }
    }

    #[test]
    fn profondeur_bornee() {
        let deep = format!("X = {}{}", "{".repeat(MAX_DEPTH + 5), "}".repeat(MAX_DEPTH + 5));
        let e = parse_saved_variables(deep.as_bytes()).unwrap_err();
        assert!(e.message.contains("imbriquées"));
        let ok = format!("X = {}{}", "{".repeat(50), "}".repeat(50));
        assert!(parse_saved_variables(ok.as_bytes()).is_ok());
    }

    #[test]
    fn erreur_avec_numero_de_ligne() {
        let e = parse_saved_variables(b"X = {\n[\"a\"] = 1,\n[\"b\"] = @,\n}").unwrap_err();
        assert_eq!(e.line, 3);
    }
}
