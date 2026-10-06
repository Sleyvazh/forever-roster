//! Jeton de l'appareil, rangé dans le coffre du système : Gestionnaire d'identification de Windows
//! (« Roster Companion »), jamais dans un fichier ni dans le journal.

const SERVICE: &str = "Roster Companion";
const ACCOUNT: &str = "jeton-appareil";

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| tracing::error!("coffre du système indisponible : {e}"))
        .ok()
}

pub fn load() -> Option<String> {
    match entry()?.get_password() {
        Ok(t) if t.starts_with("rc_") => Some(t),
        Ok(_) => None,
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            tracing::error!("jeton illisible dans le coffre du système : {e}");
            None
        }
    }
}

pub fn store(token: &str) {
    if let Some(e) = entry()
        && let Err(err) = e.set_password(token)
    {
        tracing::error!("jeton non enregistré dans le coffre du système : {err}");
    }
}

pub fn clear() {
    if let Some(e) = entry() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => tracing::error!("jeton non effacé du coffre du système : {err}"),
        }
    }
}
