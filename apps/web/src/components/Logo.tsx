/**
 * Logo Forever Roster : un infini tressé traversé d'une épée (« Lame éternelle »).
 * Dessin original. L'or suit la couleur du texte (currentColor) ; les jours du tressage
 * prennent la couleur du fond (--logo-gap, par défaut --bg) pour rester justes dans les deux thèmes.
 */
export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={`logo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M60.0 30.0 L59.8 31.4 L59.5 32.8 L58.9 34.2 L58.2 35.4 L57.3 36.5 L56.3 37.5 L55.1 38.3 L53.9 38.9 L52.6 39.3 L51.4 39.7 L50.1 39.8 L48.8 39.9 L47.5 39.8 L46.3 39.6 L45.2 39.3 L44.0 38.9 L42.9 38.5 L41.9 38.0 L40.9 37.5 L40.0 36.9 L39.0 36.3 L38.2 35.6 L37.3 35.0 L36.5 34.3 L35.7 33.6 L34.9 32.9 L34.2 32.1 L33.4 31.4 L32.7 30.7 L32.0 30.0 L31.2 29.2 L30.5 28.5 L29.7 27.8 L29.0 27.0 L28.2 26.3 L27.4 25.6 L26.6 24.9 L25.7 24.3 L24.9 23.6 L24.0 23.0 L23.0 22.4 L22.0 21.9 L21.0 21.4 L19.9 21.0 L18.8 20.6 L17.6 20.3 L16.4 20.1 L15.1 20.1 L13.8 20.1 L12.6 20.3 L11.3 20.6 L10.0 21.0 L8.8 21.7 L7.6 22.4 L6.6 23.4 L5.7 24.5 L5.0 25.7 L4.4 27.1 L4.1 28.5 L4.0 30.0 L4.1 31.4 L4.4 32.8 L5.0 34.2 L5.7 35.4 L6.6 36.5 L7.6 37.5 L8.8 38.3 L10.0 38.9 L11.3 39.3 L12.6 39.7 L13.8 39.8 L15.1 39.9 L16.4 39.8 L17.6 39.6 L18.8 39.3 L19.9 38.9 L21.0 38.5 L22.0 38.0 L23.0 37.5 L24.0 36.9 L24.9 36.3 L25.7 35.6 L26.6 35.0 L27.4 34.3 L28.2 33.6 L29.0 32.9 L29.7 32.1 L30.5 31.4 L31.2 30.7 L32.0 30.0 L32.7 29.2 L33.4 28.5 L34.2 27.8 L34.9 27.0 L35.7 26.3 L36.5 25.6 L37.3 24.9 L38.2 24.3 L39.0 23.6 L40.0 23.0 L40.9 22.4 L41.9 21.9 L42.9 21.4 L44.0 21.0 L45.2 20.6 L46.3 20.3 L47.5 20.1 L48.8 20.1 L50.1 20.1 L51.4 20.3 L52.6 20.6 L53.9 21.0 L55.1 21.7 L56.3 22.4 L57.3 23.4 L58.2 24.5 L58.9 25.7 L59.5 27.1 L59.8 28.5 L60.0 30.0Z" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinejoin="round"/><path d="M38.2 35.6 L37.7 35.3 L37.3 34.9 L36.8 34.6 L36.4 34.2 L36.0 33.8 L35.6 33.4 L35.1 33.1 L34.7 32.7 L34.3 32.3 L33.9 31.9 L33.5 31.5 L33.1 31.1 L32.7 30.7 L32.3 30.3 L32.0 30.0 L31.6 29.6 L31.2 29.2 L30.8 28.8 L30.4 28.4 L30.0 28.0 L29.6 27.6 L29.2 27.2 L28.8 26.8 L28.4 26.5 L27.9 26.1 L27.5 25.7 L27.1 25.3 L26.6 25.0 L26.2 24.6 L25.7 24.3" fill="none" stroke="var(--logo-gap, var(--bg))" strokeWidth="9.4" strokeLinecap="butt"/><path d="M38.2 35.6 L37.7 35.3 L37.3 34.9 L36.8 34.6 L36.4 34.2 L36.0 33.8 L35.6 33.4 L35.1 33.1 L34.7 32.7 L34.3 32.3 L33.9 31.9 L33.5 31.5 L33.1 31.1 L32.7 30.7 L32.3 30.3 L32.0 30.0 L31.6 29.6 L31.2 29.2 L30.8 28.8 L30.4 28.4 L30.0 28.0 L29.6 27.6 L29.2 27.2 L28.8 26.8 L28.4 26.5 L27.9 26.1 L27.5 25.7 L27.1 25.3 L26.6 25.0 L26.2 24.6 L25.7 24.3" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="butt"/><g><path d="M32 3 L34.2 8 L34.2 44 L32 48 L29.8 44 L29.8 8 Z" fill="currentColor" stroke="var(--logo-gap, var(--bg))" strokeWidth="1.8" strokeLinejoin="round"/><path d="M23 44 H41" stroke="var(--logo-gap, var(--bg))" strokeWidth="6" strokeLinecap="round"/><path d="M23 44 H41" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/><rect x="30.6" y="46" width="2.8" height="8" fill="currentColor"/><rect x="29.3" y="54.5" width="5.4" height="5.4" fill="currentColor" transform="rotate(45 32 57.2)"/></g>
    </svg>
  );
}

/**
 * Logo de Roster (WoW Retail) : la même épée que Forever Roster, pointe en haut, au milieu d'un W au trait
 * (choix de Flo, 06/10 : dessin A). Dessin original ; le W passe devant la lame, la garde se loge sous le W.
 */
export function RosterLogo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={`logo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M32 2 L34.2 7 L34.2 48 L32 51 L29.8 48 L29.8 7 Z" fill="currentColor"/><path d="M24 48 H40" stroke="var(--logo-gap, var(--bg))" strokeWidth="6" strokeLinecap="round"/><path d="M24 48 H40" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/><rect x="30.7" y="49.5" width="2.6" height="6.5" fill="currentColor"/><rect x="29.7" y="56" width="4.6" height="4.6" fill="currentColor" transform="rotate(45 32 58.3)"/><path d="M6 10 L18.5 42 L32 16 L45.5 42 L58 10" fill="none" stroke="var(--logo-gap, var(--bg))" strokeWidth="8.0" strokeLinejoin="miter" strokeMiterlimit="5" /><path d="M6 10 L18.5 42 L32 16 L45.5 42 L58 10" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinejoin="miter" strokeMiterlimit="5" />
    </svg>
  );
}

/**
 * Logo de Roster Companion (appli de synchro, lot K1) : l'épée commune aux deux sites dans deux flèches de synchro
 * (choix de Flo, 06/10 : dessin A). Dessin original, lisible en 16 px.
 */
export function CompanionLogo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={`logo ${className ?? ""}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M11.15 22.28 A23 23 0 0 1 51.92 20.50" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round"/>
      <path d="M55.14 26.97 L56.52 17.95 L47.18 22.51 Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M52.85 41.72 A23 23 0 0 1 12.08 43.50" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round"/>
      <path d="M8.86 37.03 L7.48 46.05 L16.82 41.49 Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <g transform="translate(9.6 12.2) scale(.7)">
        <path d="M32 3 L34.6 8.5 L34.6 44 L32 48 L29.4 44 L29.4 8.5 Z" fill="currentColor"/>
        <path d="M22 44 H42" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round"/>
        <rect x="30.2" y="46" width="3.6" height="7.5" fill="currentColor"/>
        <rect x="28.8" y="53.8" width="6.4" height="6.4" fill="currentColor" transform="rotate(45 32 57)"/>
      </g>
    </svg>
  );
}
