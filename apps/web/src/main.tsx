import "@fontsource/marcellus-sc/400.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApiError } from "./api";
import { App } from "./App";
import { applyTheme, readTheme } from "./components/ThemeToggle";
import { initialLang, loadLang, useLang } from "./i18n";

// Thème choisi, appliqué avant le premier rendu (pas de script inline : la CSP l'interdit).
applyTheme(readTheme());

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** Changer de langue redessine tout le site (les données déjà chargées restent). */
function Root() {
  const lang = useLang();
  return <App key={lang} />;
}

// Le catalogue de la langue est chargé avant le premier rendu : pas d'éclair de français pour qui a choisi l'anglais
void loadLang(initialLang()).catch(() => loadLang("fr")).finally(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
));
