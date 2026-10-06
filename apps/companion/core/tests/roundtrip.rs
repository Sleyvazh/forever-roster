//! Aller-retour avec l'addon : la simulation Lua de l'addon (addon/tests/wow_sim.lua) écrit sa sauvegarde comme
//! le jeu, ce test la lit et écrit ForeverRoster_Data (et ses copies chargées à la demande), puis la simulation relit
//! ces fichiers et vérifie les accusés, et l'actualisation sans /reload.
//! Prérequis : lua5.1 (installé par la CI). En local sans lua5.1, le test est passé, avec un message.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

use rc_core::datafile::{DataFile, Report, write_data_addon};
use rc_core::outbox::{BlockKind, block_label, read_outbox};

/// Appelé par la simulation Lua (RC_SV : sauvegarde écrite par l'addon ; RC_ADDONS : dossier des addons ;
/// RC_STEP : 1 pour les premières données, 2 pour de nouvelles données des groupes).
#[test]
fn helper_ecrit_data_lua() {
    let (Ok(sv), Ok(addons)) = (std::env::var("RC_SV"), std::env::var("RC_ADDONS")) else {
        return;
    };
    let step = std::env::var("RC_STEP").unwrap_or_default();
    let bytes = std::fs::read(&sv).expect("sauvegarde écrite par l'addon");
    let ob = read_outbox(&bytes).expect("sauvegarde lisible").expect("outbox présente");
    assert!(
        ob.blocks
            .iter()
            .any(|b| b.kind == BlockKind::Frc && b.key == "Tournicoti-Forever EU" && b.text.starts_with("FRC;2;Tournicoti;"))
    );
    assert!(ob.blocks.iter().any(|b| b.kind == BlockKind::Frb && b.lead), "bilan du chef de raid");
    let acks: BTreeMap<String, String> = ob.blocks.iter().map(|b| (b.key.clone(), b.sig.clone())).collect();
    // Nom de groupe piégé : guillemets et fin de chaîne longue ; s'il était exécuté, la simulation s'arrêterait
    let (frg, frg_at) = if step == "2" {
        (
            "FRG;1;g2;1790000000;Les Retardataires\nR;r2;0;Molten Core;;\nEND;1".to_string(),
            rc_core::now() + 120,
        )
    } else {
        (
            "FRG;1;g1;1790000000;Les \"Veilleurs\" ]] os.exit(3) --\nR;r1;0;Onyxia;;\nEND;1".to_string(),
            rc_core::now() + 60,
        )
    };
    let d = DataFile {
        app: "0.1.0".into(),
        frg: Some(frg),
        frg_at,
        acks,
        report: Some(Report {
            at: rc_core::now(),
            items: ob.blocks.iter().map(block_label).collect(),
        }),
    };
    let at = rc_core::now() + if step == "2" { 120 } else { 0 };
    write_data_addon(std::path::Path::new(&addons), &d, at).expect("ForeverRoster_Data écrit");
}

#[test]
fn aller_retour_avec_l_addon() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize().unwrap();
    if Command::new("lua5.1").arg("-v").output().is_err() {
        assert!(std::env::var("CI").is_err(), "lua5.1 manquant sur la CI");
        eprintln!("lua5.1 absent : aller-retour avec l'addon non vérifié");
        return;
    }
    let exe = std::env::current_exe().unwrap();
    let out = Command::new("lua5.1")
        .arg("addon/tests/wow_sim.lua")
        .current_dir(&root)
        .env("RC_HELPER", &exe)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "simulation en échec :\n{stdout}\n{stderr}");
    assert!(stdout.contains("aller-retour avec Roster Companion : bon"), "{stdout}");
}
