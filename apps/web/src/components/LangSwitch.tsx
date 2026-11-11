import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { patch } from "../api";
import { getLang, loadLang, rememberLang, t, useLang, type Lang } from "../i18n";
import { meQuery } from "../me";

/**
 * Langue du compte : un compte qui a choisi sa langue la retrouve sur tous ses appareils (elle remplace celle de ce
 * navigateur). À monter une fois, en haut de l'application.
 */
export function useAccountLang() {
  const me = useQuery(meQuery);
  const pref = me.data?.user?.lang;
  useEffect(() => {
    if ((pref === "fr" || pref === "en") && pref !== getLang()) { rememberLang(pref); void loadLang(pref); }
  }, [pref]);
}

/**
 * FR | EN, de même largeur (comme le thème) : dans le menu du compte et en bas de chaque page. Le choix est gardé dans ce
 * navigateur et, connecté, dans le compte. Sans choix, la langue du navigateur.
 */
export function LangSwitch() {
  const lang = useLang();
  const qc = useQueryClient();
  const me = useQuery(meQuery);
  const choose = (l: Lang) => {
    if (l === lang) return;
    rememberLang(l);
    if (me.data?.user) void patch("/account/preferences", { lang: l }).then(() => qc.invalidateQueries({ queryKey: ["me"] })).catch(() => { /* gardée dans ce navigateur */ });
    void loadLang(l);
  };
  const opts: [Lang, string, string][] = [["fr", "FR", "Français"], ["en", "EN", "English"]];
  return (
    <div className="theme-seg lang-seg" role="group" aria-label={t("Langue")}>
      {opts.map(([k, short, long]) => (
        <button key={k} type="button" lang={k} aria-pressed={lang === k} title={long} aria-label={long} onClick={() => choose(k)}>{short}</button>
      ))}
    </div>
  );
}
