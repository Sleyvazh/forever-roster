import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "../components/ExternalLink";
import { useSite, type SiteData } from "../site";
import { Contact, host, Sec, useTitle } from "./LegalPages";

/**
 * Legal notice and privacy policy in English (10/11/2026): the same text as LegalPages.tsx, which stays the reference
 * (French law). Any change there is made here too.
 */
const UPDATED = "November 10, 2026";

const gameOf = (game: SiteData["game"]) => (game === "retail" ? "WoW Retail" : "WoW Forever");

/** "Forever Roster (forever-roster.sleyvazh.fr, for WoW Forever) and Roster (…)": the open address first. */
function Sites() {
  const site = useSite();
  const one = (s: { game: SiteData["game"]; name: string; origin: string }) =>
    <><b>{s.name}</b> ({host(s.origin)}, for {gameOf(s.game)})</>;
  return site.other ? <>{one(site)} and {one(site.other)}</> : one(site);
}
const names = (site: SiteData) => (site.other ? `${site.name} and ${site.other.name}` : site.name);

function Head({ title }: { title: string }) {
  const site = useSite();
  return (
    <div className="page-head">
      <div><div className="eyebrow">{site.name}</div><h1>{title}</h1></div>
      <p className="small muted legal-date">Updated on {UPDATED}</p>
    </div>
  );
}

/* ---------- Legal notice ---------- */

export function LegalNoticeEn() {
  const site = useSite();
  useTitle("Legal notice");
  return (
    <article className="legal stack">
      <Head title="Legal notice" />
      <p className="legal-lead">
        {site.other
          ? <><Sites /> are one website with two addresses: same server, same code and same accounts. It is a free fan project, with no ads, made by a player in their spare time.</>
          : <><Sites /> is a free fan project, with no ads, made by a player in their spare time.</>}
      </p>
      <p className="hint">This is a translation. The French version of this page is the one that applies.</p>

      <Sec id="editeur" title="Publisher">
        <dl className="legal-dl">
          <dt>Publisher</dt><dd>Sleyvazh (pseudonym), private individual, on a non-professional basis</dd>
          <dt>Publication director</dt><dd>Sleyvazh</dd>
          <dt>Contact</dt><dd><Contact /></dd>
        </dl>
        <p>
          The publisher runs the website personally and on a non-professional basis. As allowed by article 1-1, II of French law
          no. 2004-575 of 21 June 2004 on confidence in the digital economy (LCEN), they remain anonymous to the public: the details
          that identify them (surname, first name, address) have been given to the host below.
        </p>
      </Sec>

      <Sec id="hebergeur" title="Host">
        <dl className="legal-dl">
          <dt>Company</dt><dd>OVH SAS (OVHcloud), SAS with a share capital of €50,000,000</dd>
          <dt>Registration</dt><dd>RCS Lille Métropole 424 761 419 00045</dd>
          <dt>Registered office</dt><dd>2 rue Kellermann, 59100 Roubaix, France</dd>
          <dt>Phone</dt><dd>1007 (from France)</dd>
          <dt>Website</dt><dd><ExternalLink href="https://www.ovhcloud.com/en/">ovhcloud.com</ExternalLink></dd>
        </dl>
        <p>
          The website runs on an OVHcloud virtual private server (VPS), in a data center located in France. The website's e-mails
          (address confirmation, forgotten password) are sent through OVHcloud's mail server.
        </p>
      </Sec>

      <Sec id="propriete" title="Intellectual property">
        <ul className="legal-list">
          <li>
            World of Warcraft, WoW, Battle.net and Blizzard Entertainment are trademarks of Blizzard Entertainment, Inc.
            {" "}{site.other
              ? `${names(site)} are fan projects, not affiliated with Blizzard Entertainment, which has neither approved nor endorsed them.`
              : `${names(site)} is a fan project, not affiliated with Blizzard Entertainment, which has neither approved nor endorsed it.`}
          </li>
          <li>
            The game's names, texts and images (items, spells, talents, icons of professions, roles, items and of the classes
            specific to WoW Retail) belong to Blizzard Entertainment. They are shown to describe the game.
          </li>
          <li>
            The class and specialization icons were made by <b>Pahpool</b> for the website. They remain their work: do not reuse
            them without their permission.
          </li>
          <li>Discord is a trademark of Discord Inc.</li>
          <li>
            The code of the website, the addon, the Discord bot and Roster Companion is published under the MIT license
            on <ExternalLink href="https://github.com/Sleyvazh/forever-roster">GitHub (Sleyvazh/forever-roster)</ExternalLink>.
          </li>
          <li>
            What players publish (nicknames, guild names, notes, images) belongs to its authors, who are responsible for it.
          </li>
        </ul>
      </Sec>

      <Sec id="signaler" title="Report content">
        <p>
          Does a nickname, a guild name, a text or an image published on the website seem unlawful to you? Write to <Contact /> with
          your name or nickname, the exact address of the page, the content in question and why it seems unlawful to you. Clearly
          unlawful content is removed as soon as possible.
        </p>
        <p className="hint">For a bug, an idea or a question about the website, use "Report a bug or an idea" in your account menu instead.</p>
      </Sec>

      <Sec id="donnees" title="Personal data">
        <p>
          What the website keeps about you, why, for how long, and how to exercise your rights: see
          the <Link to="/confidentialite">privacy policy</Link>.
        </p>
      </Sec>
    </article>
  );
}

/* ---------- Privacy policy ---------- */

type Basis = "Contract" | "Legitimate interest";
interface Row { title: string; data: ReactNode; why: ReactNode; basis: Basis; keep: ReactNode; who: ReactNode }

const ROWS: Row[] = [
  {
    title: "Your account",
    data: "E-mail address, nickname, password (hashed: nobody can read it back), creation date, account image, language of the website and of the game names, last addon version used.",
    why: "Signing you in, sending you the account e-mails, showing you in your guilds.",
    basis: "Contract",
    keep: "As long as the account exists.",
    who: "You. Your nickname and image: the members of your guilds. Your e-mail address is never shown to other players.",
  },
  {
    title: "Battle.net and Discord",
    data: "If you link them: Battle.net ID and BattleTag; Discord ID and username; your choice for the bot's direct messages (reminders, follow-ups, officers' requests).",
    why: "Signing you in with Battle.net; signing you up and notifying you from the Discord bot.",
    basis: "Contract",
    keep: "Until you unlink them (Account & security), or the account is deleted.",
    who: "You. Your BattleTag is also shared with the members of your guilds.",
  },
  {
    title: "Your characters",
    data: "Name, realm, race, class, specs, level, talents, gear and goals, professions and recipes, consumables counted by the addon, notes, portrait. What the addon and Roster Companion send: this information, your in-game signups and the addon version; the character's in-game GUID and full name (sent by the addon). On Forever, the level of a character sheet placed in a guild linked to the game follows the guild roster; for a character the roster doesn't know, the officer who set its level, and when; for a sheet created by an officer or given by another member, who did it and when (until you edit or sync it). On Roster: the character's Battle.net ID, item level and active spec read from Blizzard.",
    why: "Keeping your character sheet up to date and preparing raids; an accurate level for runs and the guild.",
    basis: "Contract",
    keep: "As long as the character exists (you can delete it), and at most as long as the account exists.",
    who: "You, and the members of the guilds you share with them: the full sheet, notes included.",
  },
  {
    title: "Guilds",
    data: "Guild name, members and roles (leader, officer, member), invitations, linked Discord channels, settings, guild log (who created a raid, changed a role…).",
    why: "Running the guild.",
    basis: "Contract",
    keep: "Until you leave the guild or the leader deletes it. The log of a deleted guild is no longer shown but stays in the database.",
    who: "The guild's members; the log: the leader and the officers.",
  },
  {
    title: "Raids and signups",
    data: "Signups (status, character, spec, note), lineup, reservations (soft reserve), loot council, officers' requests (\"Ask…\"), recurring raids.",
    why: "Organizing raids, on the website and on Discord.",
    basis: "Contract",
    keep: "Nothing is deleted automatically: as long as the raid exists, until an officer deletes it or the guild is deleted.",
    who: "The guild's members. The bot's announcements show the nicknames, characters and specs of those signed up in the guild's Discord channel.",
  },
  {
    title: "Signed up from Discord, without an account",
    data: "Discord ID and username, class, spec and status chosen in the bot, for a raid or a run.",
    why: "Counting the players who sign up from Discord without an account on the website.",
    basis: "Legitimate interest",
    keep: "Until you sign off (the bot's button), or the raid or guild is deleted. Runs: deleted automatically, like the run.",
    who: "The guild's members and the Discord channel of the announcement.",
  },
  {
    title: "Absences",
    data: "Dates or days of the week, optional reason.",
    why: "Marking you \"Absent\" for the raids on those days.",
    basis: "Contract",
    keep: "Until you remove it. A past absence is no longer shown but stays in the database as long as the account exists.",
    who: "Your guilds see \"Absent\". The reason: you and the officers, or the whole guild if you choose so.",
  },
  {
    title: "Raid reports: attendance and loot",
    data: "In-game first names of the raid's players, including those without an account on the website; attendance times; items received and how (council, votes, roll); consumable counts during a check; the character who recorded the report; officers' corrections of the item counts.",
    why: "Tracking attendance and the count of items received, for fair loot.",
    basis: "Legitimate interest",
    keep: "As long as the raid exists: nothing is deleted automatically.",
    who: "The guild's members.",
  },
  {
    title: "Crafting orders",
    data: "Requester, crafter, recipe, quantity, note, character who will receive the item.",
    why: "Putting the requester in touch with the guild's crafters.",
    basis: "Contract",
    keep: "Until it is cancelled (requester or officer). A completed order is no longer shown after 14 days but stays in the database as long as the guild exists.",
    who: "The guild's members and the orders' Discord channel, if linked.",
  },
  {
    title: "Dungeon runs",
    data: "Creator and their character's first name, signups (character, role, waiting list), the bot's direct messages to send.",
    why: "Forming a group of 5 for today or tomorrow.",
    basis: "Contract",
    keep: "Deleted automatically 2 hours after the planned time (or at the end of the day), with their Discord message. Direct messages: deleted 7 days after being sent.",
    who: "The guild's members and the run's Discord channel.",
  },
  {
    title: "In-game guild (Forever)",
    data: "The in-game guild roster recorded by a member's addon: full name, class, level, rank, guild notes (officer notes recorded by an officer, shown to officers only), online status and last login, joining and leaving; guild log (joins, departures, promotions, with names); levels reached and XP (exact time with the addon); characters attached to their players. Guild bank: tab contents, gold, deposit and withdrawal log (with names), the website account that sent each bank scan (never shown).",
    why: "Showing who plays what in the guild (mains and alts), the Race to 60, the guild's history and bank.",
    basis: "Legitimate interest",
    keep: "As long as the website guild is linked to the in-game guild (\"Unlink\" deletes the roster, log, levels and bank). A member who left is deleted 90 days after leaving, with their levels and attachment; the guild log after 12 months; a suggested in-game guild (and its scan) after 30 days. The \"First 60s\" podium stays. Guild bank log: 12 months; tab contents and gold: replaced at each scan, deleted when the guild is unlinked.",
    who: "The guild's members; officer notes: the officers; level-up announcements: the guild's Discord channel.",
  },
  {
    title: "Guild bank withdrawal requests (Forever)",
    data: "Requested item and quantity, the requester's short note (80 characters at most), the stage (waiting, prepared, handed over, refused, cancelled), the character of whoever handled it, the reason for a refusal; the \"banker\" role given to a member by an officer; the bot's direct messages to send (request ready or refused).",
    why: "Letting a player request an item from the guild bank, and officers and bankers prepare it and hand it over.",
    basis: "Contract",
    keep: "Open request: until it is closed. Closed request (handed over, refused, cancelled): deleted 90 days after closing, with its direct messages. Your open requests are cancelled when you leave the guild or an officer removes you; all requests are deleted when the guild is unlinked from the in-game guild.",
    who: "The guild's members see open requests and the last 20 closed ones, with the main character of the requester and of whoever handles them. The requester gets a direct message from the bot if they linked Discord and kept reminders on.",
  },
  {
    title: "Reports",
    data: "Type, title, text, page concerned, browser and system (read from your browser), addon version, optional screenshot (reduced, metadata removed), your nickname, the answer.",
    why: "Fixing bugs and answering you.",
    basis: "Legitimate interest",
    keep: "Until a website admin deletes it. If you delete your account, it stays for the admins, without your nickname or browser, on the website and in the Discord channel.",
    who: "You and the website admins. They are also posted in the admins' private Discord channel.",
  },
  {
    title: "Discord feedback (/feedback)",
    data: "The feedback text, signed or anonymous; the author's Discord ID; nickname for signed feedback; replies exchanged.",
    why: "Passing the team's replies on to the author and following up on the feedback.",
    basis: "Legitimate interest",
    keep: "Feedback not followed on the website: only the link between the feedback and its author is kept, 30 days (the text stays in Discord). Feedback followed by a guild: text and replies kept until an officer deletes them; the author's ID is deleted 30 days after the feedback is closed.",
    who: "The Discord server's team; the leader and officers of the guild that follows the feedback. Anonymous feedback never shows its author: only the bot knows their ID, to pass on the replies.",
  },
  {
    title: "Security: log and sessions",
    data: "Account events (logins, failures, sensitive changes) with the date, IP address, browser and system; open sessions (IP address, browser, last activity); failed logins with an unknown address (IP address and browser, without the address typed).",
    why: "Protecting accounts and showing you who signed in.",
    basis: "Legitimate interest",
    keep: "Log: deleted after 12 months; an action done in a guild stays in the guild's log, without IP address or browser. Sessions: deleted 30 days after they end (logout, expiry or 7 days without activity). If you delete your account, the IP address and browser are deleted from your log right away; its events remain, detached from the account.",
    who: "You (Account & security). Never other players.",
  },
  {
    title: "Roster Companion",
    data: "Computer name, system, app version, last IP address, sync dates, device token (hashed), in-game characters you chose to ignore. Pairing requests: the same information and the IP address.",
    why: "Syncing the game and the website without copy-paste.",
    basis: "Contract",
    keep: "Devices: as long as the account exists; an unlinked device is deleted 30 days later, with its last IP address. Pairing requests: deleted one day after they expire, at the next request.",
    who: "You.",
  },
  {
    title: "Battle.net import (Roster)",
    data: "List of your Battle.net account's characters: name, realm, class, level, faction.",
    why: "Choosing the characters to import.",
    basis: "Contract",
    keep: "Usable for 30 minutes, then deleted within the hour. The token given by Blizzard is never kept.",
    who: "You.",
  },
  {
    title: "Account e-mails",
    data: "Your address and the links sent (address confirmation: 24 hours; new password: 30 minutes), kept hashed.",
    why: "Confirming your address, resetting your password, warning you about a signup attempt with your address.",
    basis: "Contract",
    keep: "The website doesn't keep the content of e-mails. The links, hashed, are deleted 30 days after being used or expiring.",
    who: "OVHcloud, which delivers the e-mails.",
  },
  {
    title: "Server technical logs",
    data: "For each request: IP address, page called, response code, time.",
    why: "Diagnosing outages and spotting attacks.",
    basis: "Legitimate interest",
    keep: "Until the next website update, in practice a few days, and at most 30 MB per service: beyond that, the oldest are deleted.",
    who: "The publisher only.",
  },
];

function DataTable() {
  return (
    <div className="legal-tw">
      <table className="legal-t">
        <caption className="sr-only">Data kept by the website: content, purpose and legal basis, duration, recipients</caption>
        <thead><tr><th scope="col">Data</th><th scope="col">Why</th><th scope="col">How long</th><th scope="col">Who sees it</th></tr></thead>
        <tbody>{ROWS.map(r => (
          <tr key={r.title}>
            <th scope="row" data-l="Data"><b>{r.title}</b><span>{r.data}</span></th>
            <td data-l="Why">{r.why}<span className={`tag legal-basis${r.basis === "Contract" ? "" : " li"}`}>{r.basis}</span></td>
            <td data-l="How long">{r.keep}</td>
            <td data-l="Who sees it">{r.who}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const COOKIES: [string, string, string][] = [
  ["__Host-fr_sid", "Your login session (random token, unreadable by the page's scripts).", "30 days at most; closed earlier at logout or after 7 days without activity."],
  ["fr_oauth", "Protects the Battle.net login against attacks (link between your browser and the request in progress).", "10 minutes, only during the login."],
  ["fr_discord", "Protects linking your Discord account in the same way.", "10 minutes, only while linking."],
  ["fr-lang", "The website language you chose (French or English), also read by the server for the home page, its messages and its e-mails.", "1 year; absent: your browser's language."],
];
const STORAGE: [string, string][] = [
  ["fr-theme", "Chosen theme (light or dark); absent: your device's."],
  ["fr-news-seen", "Last news item read (gold dot on the \"News\" button)."],
  ["fr-steps-hidden", "Getting started steps hidden (Roster)."],
  ["fr-view-…", "Chosen views: guild character list, Guild › Members (by character or by player, in-game roster or website sheets), talent trees, \"This week\" banner."],
  ["fr-addon-fiches", "Old choice of character sheets for the addon import: only read, never written again."],
  ["fr-invite", "Token of a guild invitation link, with the e-mail typed when creating your account (to prefill it at login): kept 24 h at most, so the invitation survives the e-mail confirmation, and deleted as soon as you join the guild. On Roster: while you sign in (tab session)."],
  ["fr-guild", "Last guild opened, to land on its Home page."],
  ["fr-tab", "Last tab opened on a character sheet (tab session)."],
  ["fr-sync-key", "Your addon sync key (e.g. F9), read from the last text pasted, to remind you of it in the Sync panel."],
];

export function PrivacyEn() {
  const site = useSite();
  useTitle("Privacy");
  return (
    <article className="legal stack">
      <Head title="Privacy policy" />
      <div className="legal-lead stack">
        <p>
          This page says what data the website keeps about you, why, for how long and who sees it. It applies
          to {site.other ? <>both addresses of the website, <Sites />, which share the same server, database and accounts,</> : <><Sites />,</>} and
          to the Discord bot, the addon and Roster Companion when they exchange data with the website.
        </p>
        <ul className="legal-list">
          <li>The website is for organizing your characters and raids. It sells nothing, shows no ads and doesn't measure its audience.</li>
          <li>Your data is kept on a server in France, at OVHcloud.</li>
          <li>You can delete your account at any time, in <Link to="/account">Account &amp; security</Link>.</li>
        </ul>
        <p className="hint">This is a translation. The French version of this page is the one that applies.</p>
      </div>

      <nav className="panel pad legal-toc" aria-label="Contents">
        <ol>
          <li><a href="#responsable">Data controller</a></li>
          <li><a href="#donnees">Data, durations and recipients</a></li>
          <li><a href="#bases">Legal bases</a></li>
          <li><a href="#partage">Who it is shared with</a></li>
          <li><a href="#cookies">Cookies and local storage</a></li>
          <li><a href="#securite">Security</a></li>
          <li><a href="#droits">Your rights</a></li>
          <li><a href="#sans-compte">Players without an account</a></li>
        </ol>
      </nav>

      <Sec id="responsable" title="Data controller">
        <p>
          The data controller is the website's publisher: <b>Sleyvazh</b>, private individual, on a non-professional basis
          (see the <Link to="/mentions-legales">legal notice</Link>). For any question about your data: <Contact />.
          The website has no data protection officer: it isn't required to.
        </p>
      </Sec>

      <Sec id="donnees" title="Data, durations and recipients">
        <p>Here is everything the website keeps, as its code does it today.</p>
        <DataTable />
        <h3>When you delete your account</h3>
        <p>
          Deleted right away: your account, characters, signups, absences, images, sessions, devices, crafting orders and your
          Battle.net and Discord links. If you lead a guild, transfer or delete it first.
        </p>
        <p>
          What remains, unlinked from your account: your reports, without your nickname or browser; your name copied on some actions
          done in a guild (corrections of item counts, "Ask…" requests); your characters' first names in raid reports; the events of
          your security log, without IP address or browser, until they are deleted after 12 months (those of a guild's log stay with
          it). You can ask for them to be deleted (see "Your rights").
        </p>
        <h3>Backups</h3>
        <p>
          The database is backed up every night; each backup is kept 14 days on the server. Data deleted on the website therefore
          disappears from the server's backups at most 14 days later. A copy is also brought back each week to the publisher, off the
          server, to be able to rebuild the website after a failure; it is used only for that and has no maximum duration yet.
        </p>
      </Sec>

      <Sec id="bases" title="Legal bases">
        <ul className="legal-list">
          <li>
            <span className="tag legal-basis">Contract</span>: the service you ask for by creating an account or using the bot
            (account, characters, guilds, raids, absences, orders, runs, Roster Companion, account e-mails).
          </li>
          <li>
            <span className="tag legal-basis li">Legitimate interest</span>: the website's security (log, sessions, server logs),
            running guilds (raid reports, in-game guild roster, Discord signups without an account) and improving the website
            (reports, feedback). You can object to it (see "Your rights").
          </li>
          <li>
            The website doesn't ask for your consent, because it does nothing that needs it: no ads, no audience measurement, no
            resale of data.
          </li>
        </ul>
      </Sec>

      <Sec id="partage" title="Who it is shared with">
        <ul className="legal-list">
          <li><b>Other players</b>, only as the table says (column "Who sees it").</li>
          <li>
            <b>OVHcloud</b> (OVH SAS, Roubaix): hosts the server, in a data center in France, and delivers the website's e-mails.
          </li>
          <li>
            <b>Discord</b> (Discord Inc., United States), only if you link your Discord account or use the bot. Discord receives what
            the bot posts: announcements (nicknames, characters and specs of those signed up, Race to 60 level-ups), direct messages,
            feedback, and reports in the admins' private channel. The website receives your ID and username from Discord, nothing else
            (neither your e-mail nor your servers). This data is processed by Discord, including in the United States, under its own
            privacy policy.
          </li>
          <li>
            <b>Blizzard Entertainment</b>, for Battle.net login: the website receives your Battle.net ID and BattleTag. On Roster,
            for the import (your account's character list) and the "Update" button (the character's public profile: level, item
            level, active spec). The token given by Blizzard is never kept.
          </li>
          <li>
            <b>Have I Been Pwned</b>: when you choose a password, the website checks it doesn't appear in a known breach. Only the
            first 5 characters of its fingerprint (SHA-1), shared by hundreds of passwords, are sent: neither your password, nor your
            address, nor your IP address (the request comes from the server).
          </li>
          <li>
            <b>Your addon</b>: "Copy for the game" and Roster Companion put your guilds' data in the addon, on your computer. The addon
            can pass it on in game to the players of your guild and raid who have it too; each one keeps only the guilds they belong
            to. You can turn this sharing off in the addon's options.
          </li>
          <li><b>GitHub</b>: Roster Companion checks for its updates there, without sending any website data.</li>
        </ul>
        <p>
          No data is sold or transferred. The website loads nothing from another website (no font, image or script): no audience
          measurement tool, no ads, no social network button.
        </p>
      </Sec>

      <Sec id="cookies" title="Cookies and local storage">
        <p>
          The website only sets cookies needed for it to work and keeps a few display choices in your browser. They are exempt from
          consent (article 82 of the French Data Protection Act): that's why the website shows no cookie banner.
        </p>
        <h3>Cookies set by the website</h3>
        <div className="legal-tw">
          <table className="legal-t small-t">
            <caption className="sr-only">Cookies set by the website</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">What it's for</th><th scope="col">Duration</th></tr></thead>
            <tbody>{COOKIES.map(([n, why, d]) => (
              <tr key={n}><th scope="row" data-l="Name"><code>{n}</code></th><td data-l="What it's for">{why}</td><td data-l="Duration">{d}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <h3>Browser local storage</h3>
        <p>These values stay in your browser: they are never sent to the server.</p>
        <div className="legal-tw">
          <table className="legal-t small-t">
            <caption className="sr-only">Browser local storage</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">What it's for</th></tr></thead>
            <tbody>{STORAGE.map(([n, why]) => (
              <tr key={n}><th scope="row" data-l="Name"><code>{n}</code></th><td data-l="What it's for">{why}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Sec>

      <Sec id="securite" title="Security">
        <p>
          The website is served over HTTPS only. Passwords are hashed with Argon2id and login tokens are kept hashed: even a database
          leak would not reveal them. Every action is checked by the server: a player only sees the guilds they are a member of. The
          server is kept up to date, its access is restricted, and the database is backed up every night. The code is public: anyone
          can review it. If a data breach put you at risk, you would be told, as the GDPR requires.
        </p>
      </Sec>

      <Sec id="droits" title="Your rights">
        <ul className="legal-list">
          <li><b>Access</b>: <Link to="/account">Account &amp; security</Link> shows your account, sessions, devices and security log; your characters and guilds are on the website. For a full copy, write to <Contact />.</li>
          <li><b>Rectification</b>: edit your nickname, characters or absences directly, or write to the publisher.</li>
          <li><b>Erasure</b>: "Delete my account", in Account &amp; security, deletes your account right away. You can also delete a character, an absence or a signup, and unlink Battle.net, Discord or a device. For the rest (reports, log, raid reports), write to the publisher.</li>
          <li><b>Portability</b>: on request, a copy of your data in a readable file (JSON).</li>
          <li><b>Objection and restriction</b>: for what relies on legitimate interest, on request. The bot's direct messages can be turned off in Account &amp; security.</li>
        </ul>
        <p>
          To exercise these rights, write to <Contact />, from your account's address if possible: the publisher may ask you to prove
          the account is yours. Answer within one month at most.
        </p>
        <p>
          Without an answer, or if it doesn't suit you, you can file a complaint with the CNIL (the French data protection authority):
          Service des plaintes, 3 place de Fontenoy, 75007 Paris, or online
          at <ExternalLink href="https://www.cnil.fr/fr/plaintes">cnil.fr/fr/plaintes</ExternalLink>.
        </p>
      </Sec>

      <Sec id="sans-compte" title="Players without an account">
        <p>The website also keeps a little data about players who have no account on it:</p>
        <ul className="legal-list">
          <li>
            <b>Signed up from Discord</b>: your Discord ID and username, the class, spec and status chosen, for the raid or run
            concerned. Signing off with the bot's button deletes the signup.
          </li>
          <li>
            <b>Raid reports</b>: an officer's addon records the in-game first names of the players present in the raid, their
            attendance times, the items received and consumables. These reports stay in the guild as long as the raid exists.
          </li>
          <li>
            <b>Guild roster</b>: a member's addon records the in-game guild roster (full name, class, level, rank, notes, last login)
            and its log; a member who left is deleted 90 days after leaving, the log after 12 months.
          </li>
          <li>
            <b>Discord feedback</b>: your Discord ID, to pass the replies on to you, deleted as the table says.
          </li>
        </ul>
        <p>
          To have them deleted, ask the guild's officers, or write to <Contact /> giving your in-game first name or Discord username,
          and the guild or Discord server concerned. You have the same rights as a player with an account.
        </p>
      </Sec>

      <p className="hint">
        This page follows the website: it changes when the website does, and the date at the top shows its last update. An important
        change is announced in the News. See also the <Link to="/mentions-legales">legal notice</Link> of {site.name}.
      </p>
    </article>
  );
}
