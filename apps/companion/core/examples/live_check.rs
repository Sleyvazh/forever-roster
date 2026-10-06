//! Vérification de bout en bout contre un vrai serveur (local) : appairage, envoi, perso inconnu créé, bilan du chef,
//! données des groupes avec ETag, ForeverRoster_Data écrit, appareil délié.
//!
//! Lancé par un script qui démarre le site de test et valide le code (le programme affiche « CODE XXXX-XXXX »).
//! Variables : RC_SITE (adresse du site), RC_RAID (raid du site), RC_GROUP (nom du groupe).

use std::io::Write;
use std::time::Duration;

use rc_core::api::{ApiError, Client, DeviceDescription, PairPoll, Sites};
use rc_core::datafile::write_data_addon;
use rc_core::sync::{Engine, GameState};
use rc_core::wow::{Game, scan_root};

type R<T> = Result<T, Box<dyn std::error::Error>>;

fn check(cond: bool, what: &str) -> R<()> {
    if cond { Ok(()) } else { Err(format!("échec : {what}").into()) }
}

#[tokio::main]
async fn main() -> R<()> {
    let site = std::env::var("RC_SITE")?;
    let raid = std::env::var("RC_RAID")?;
    let group = std::env::var("RC_GROUP")?;
    let client = Client::new(
        Sites {
            forever: site.clone(),
            retail: site,
        },
        "0.1.0",
    )?;

    // 1. Appairage : le script valide le code sur le site
    let start = client
        .pair_start(&DeviceDescription {
            name: "PC-TEST".into(),
            platform: "Linux (test)".into(),
            app_version: "0.1.0".into(),
        })
        .await?;
    println!("CODE {}", start.user_code);
    std::io::stdout().flush()?;
    let mut interval = start.interval;
    let token = loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        match client.pair_poll(&start.pair_id).await? {
            PairPoll::Approved { token, .. } => break token,
            PairPoll::Pending => {}
            PairPoll::SlowDown => interval += 1,
            other => return Err(format!("appairage : {other:?}").into()),
        }
    };
    let me = client.me(&token).await?;
    println!("relié : {} ({})", me.device.name, me.user.display_name);

    // 2. Dossier de jeu factice : sauvegarde avec un perso et le bilan du raid relevé par le chef
    let tmp = tempfile::tempdir()?;
    let root = tmp.path().join("World of Warcraft");
    let game_dir = root.join("_classic_beta_");
    let sv_dir = game_dir.join("WTF/Account/12345678#1/SavedVariables");
    std::fs::create_dir_all(&sv_dir)?;
    std::fs::create_dir_all(game_dir.join("Interface/AddOns/ForeverRoster"))?;
    std::fs::write(
        game_dir.join("Interface/AddOns/ForeverRoster/ForeverRoster.toc"),
        "## Interface: 16001\n## Version: 1.3.1\n",
    )?;
    std::fs::write(
        root.join(".build.info"),
        "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\neu|1|1.60.1.70170|wow_classic_beta\n",
    )?;
    let now = rc_core::now();
    let frc = "FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;1.3.1\\nG;1:16866\\nP;Leatherworking;300;300\\nEND;2";
    let frb = format!(
        "FRB;2;{raid};{};{};Tournicoti;Molten Core;Molten Core;1\\nA;Tournicoti;{};{};120\\nEND;1",
        now - 7200,
        now - 60,
        now - 7200,
        now - 60
    );
    std::fs::write(
        sv_dir.join("ForeverRoster.lua"),
        format!(
            "\nForeverRosterDB = {{\n[\"outbox\"] = {{\n[\"v\"] = 1,\n[\"at\"] = {now},\n[\"addon\"] = \"1.3.1\",\n[\"blocks\"] = {{\n{{\n[\"kind\"] = \"frc\",\n[\"key\"] = \"Tournicoti-Forever EU\",\n[\"sig\"] = \"s1\",\n[\"text\"] = \"{frc}\",\n}}, -- [1]\n{{\n[\"kind\"] = \"frb\",\n[\"key\"] = \"frb:{raid}\",\n[\"sig\"] = \"{now}\",\n[\"lead\"] = true,\n[\"text\"] = \"{frb}\",\n}}, -- [2]\n}},\n}},\n}}\n"
        ),
    )?;
    let installs = scan_root(&root);
    check(installs.len() == 1 && installs[0].game == Some(Game::Forever), "dossier de Forever détecté")?;
    let inst = &installs[0];

    // 3. Envoi : le perso est inconnu (l'appli demande), le bilan du chef est enregistré
    let engine = Engine {
        api: &client,
        game: Game::Forever,
        token: &token,
    };
    let mut gs = GameState::default();
    check(gs.collect(&inst.accounts(), now) == 2, "deux blocs lus")?;
    let o = engine.push(&mut gs, now).await?;
    println!("envoi : {o:?}");
    check(o.unknown == 1 && o.accepted == 1, "perso inconnu + bilan enregistré")?;
    let o = engine.resolve(&mut gs, &["Tournicoti-Forever EU".to_string()], &[], now).await?;
    check(o.accepted == 1 && gs.unknown.is_empty(), "fiche créée")?;
    check(
        gs.sent.contains_key("Tournicoti-Forever EU") && gs.sent.contains_key(&format!("frb:{raid}")),
        "accusés de réception",
    )?;
    check(engine.push(&mut gs, now).await?.sent == 0, "rien de renvoyé")?;

    // 4. Données des groupes, puis 304
    check(engine.pull(&mut gs, now).await?, "données des groupes reçues")?;
    check(gs.frg.as_deref().is_some_and(|t| t.contains(&group)), "le groupe est dans les données")?;
    check(!engine.pull(&mut gs, now + 1).await?, "ETag : rien de nouveau")?;

    // 5. ForeverRoster_Data
    let data = gs.data_file("0.1.0", now);
    check(write_data_addon(&inst.addons_dir(), &data, now)?, "addon de données créé")?;
    let lua = std::fs::read_to_string(inst.addons_dir().join("ForeverRoster_Data/Data.lua"))?;
    check(lua.contains("Tournicoti-Forever EU") && lua.contains("frgAt"), "Data.lua complet")?;
    check(inst.data_addon_installed(), "addon de données vu installé")?;

    // 6. Délier : le jeton ne sert plus
    client.unlink(&token).await?;
    check(
        matches!(engine.pull(&mut gs, now + 2).await, Err(ApiError::Unauthorized)),
        "jeton refusé après déliaison",
    )?;
    println!("OK");
    Ok(())
}
