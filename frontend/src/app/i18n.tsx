import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { enExtra } from "./i18n-extra";

export type Language = "fr" | "en";
const STORAGE_KEY = "uswap:language";

function selectedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // Fall back to the document language when storage is unavailable.
  }
  return document.documentElement.lang === "en" ? "en" : "fr";
}

const normalizeTranslationKey = (value: string) =>
  value.replace(/\s+/g, " ").trim();

const en: Record<string, string> = {
  Accueil: "Home",
  Utilisateurs: "Users",
  Stations: "Stations",
  Plannings: "Schedules",
  "Journal d’audit": "Audit log",
  "Réglages globaux": "Global settings",
  "Paramètres du compte": "Account settings",
  "Mes stations": "My stations",
  "Carte des stations": "Station map",
  Congés: "Leave",
  "Mon compte": "My account",
  Compte: "Account",
  Supervision: "Supervision",
  Administrateur: "Administrator",
  Superviseur: "Supervisor",
  Planning: "Schedule",
  Pointages: "Attendance",
  Pointage: "Clock-in",
  "Suivez l’activité du réseau et accédez rapidement aux tâches prioritaires.":
    "Monitor network activity and access priority tasks quickly.",
  "Gérez les collaborateurs, leurs rôles, leurs stations et leurs accès.":
    "Manage staff, roles, stations and access.",
  "Configurez les stations, leurs règles, leurs shifts et leur localisation.":
    "Configure stations, rules, shifts and locations.",
  "Créez, publiez et ajustez les horaires des équipes.":
    "Create, publish and adjust team schedules.",
  "Examinez les demandes et suivez les périodes approuvées.":
    "Review requests and track approved leave.",
  "Consultez les actions enregistrées et leur contexte.":
    "Review recorded actions and their context.",
  "Définissez les règles communes de la plateforme.":
    "Set platform-wide rules.",
  "Mettez à jour vos informations et vos préférences de compte.":
    "Update your details and account preferences.",
  "Aller au contenu": "Skip to content",
  "Navigation administrateur": "Administrator navigation",
  "Navigation SUPERVISEUR": "Supervisor navigation",
  "Navigation SWAPPEUR": "Swapper navigation",
  "Votre session va expirer.": "Your session is about to expire.",
  "Prolonger ma session": "Extend my session",
  "Chargement de la page…": "Loading page…",
  "Connexion · uSwap": "Sign in · uSwap",
  Connexion: "Sign in",
  "Bienvenue sur uSwap": "Welcome to uSwap",
  "uSwap, Powered by uPowa — accueil": "uSwap, powered by uPowa — home",
  "La gestion de vos stations,": "Manage your stations,",
  "en un seul endroit.": "all in one place.",
  "Profil à ouvrir": "Choose a profile",
  "Choisir un profil": "Choose a profile",
  "Choisir un compte": "Choose an account",
  "Adresse e-mail": "Email address",
  "Votre adresse e-mail": "Your email address",
  "Saisissez une adresse e-mail valide.": "Enter a valid email address.",
  "Mot de passe": "Password",
  "Mot de passe oublié ?": "Forgot password?",
  "Votre mot de passe": "Your password",
  "Masquer le mot de passe": "Hide password",
  "Afficher le mot de passe": "Show password",
  "Saisissez votre mot de passe.": "Enter your password.",
  "La touche Verr. Maj est activée.": "Caps Lock is on.",
  "Se connecter": "Sign in",
  "Connexion en cours…": "Signing in…",
  "Première connexion ?": "First time here?",
  "Activer mon accès": "Activate my account",
  "Vérification de votre session…": "Checking your session…",
  "Ce mot de passe est trop long.": "This password is too long.",
  "Connexion impossible.": "Unable to sign in.",
  "Ouvrir le menu du compte": "Open account menu",
  Paramètres: "Settings",
  "Se déconnecter": "Sign out",
  "Déconnexion…": "Signing out…",
  "Station :": "Station:",
  "Gérez vos informations personnelles et la sécurité de votre compte.":
    "Manage your personal information and account security.",
  "Examinez les demandes et anticipez les remplacements de votre périmètre.":
    "Review requests and plan cover for your area.",
  "Consultez votre solde et suivez vos demandes de congé.":
    "View your balance and track leave requests.",
  "Consultez les horaires publiés et les affectations de votre périmètre.":
    "View published schedules and assignments in your area.",
  "Contrôlez les présences, corrigez les pointages et consultez leur historique.":
    "Monitor attendance, correct clock-ins and review their history.",
  "Supervisez les présences, les absences et les remplacements du réseau.":
    "Oversee network attendance, absences and shift cover.",
  "Retrouvez vos prochains shifts et effectuez vos pointages.":
    "See your upcoming shifts and clock in or out.",
  "Compte actif": "Active account",
  "Identité et périmètre d’accès": "Identity and access",
  "Les informations utilisées pour personnaliser votre espace de travail.":
    "Information used to personalize your workspace.",
  Profil: "Profile",
  Notifications: "Notifications",
  Sécurité: "Security",
  "Nom complet": "Full name",
  "Station de rattachement": "Assigned station",
  "Une modification d’identité ou de rattachement doit être réalisée par un administrateur.":
    "An administrator must change your identity or assigned station.",
  "Sécurité du compte": "Account security",
  "Demandez un lien sécurisé pour choisir un nouveau mot de passe. Le lien est envoyé à":
    "Request a secure link to choose a new password. The link will be sent to",
  "Réinitialiser mon mot de passe": "Reset my password",
  "Langue de l’interface": "Interface language",
  Français: "French",
  Anglais: "English",
  "Choisir la langue": "Choose language",
  "uSwap, accueil administrateur": "uSwap, administrator home",
  "uSwap, accueil superviseur": "uSwap, supervisor home",
  "uSwap, accueil swappeur": "uSwap, swapper home",
  "Synchronisation en attente": "Sync pending",
  "Mode hors connexion": "Offline mode",
  "opération conservée": "operation saved",
  "opérations conservées": "operations saved",
  "sur cet appareil": "on this device",
  "Votre dernier planning reste disponible":
    "Your latest schedule is still available",
  "Une nouvelle version de uSwap est prête.":
    "A new version of uSwap is ready.",
  "Actualisez pour utiliser les dernières améliorations.":
    "Refresh to get the latest improvements.",
  "Mise à jour…": "Updating…",
  Actualiser: "Refresh",
  "Plus tard": "Later",
  "uSwap sur votre écran d’accueil": "Add uSwap to your home screen",
  Installer: "Install",
  Fermer: "Close",
  "Fermer la notification de mise à jour": "Dismiss update notice",
  "Fermer la proposition d’installation": "Dismiss install prompt",
  Annuler: "Cancel",
  Enregistrer: "Save",
  Rechercher: "Search",
  "Aucun résultat": "No results",
  "Aucune donnée": "No data",
  "Chargement…": "Loading…",
  Réessayer: "Try again",
  "Voir tout": "View all",
  "Aujourd’hui": "Today",
  "Cette semaine": "This week",
  "Ce mois": "This month",
  Disponible: "Available",
  Indisponible: "Unavailable",
  "À l’heure": "On time",
  "En retard": "Late",
  Absent: "Absent",
  Présent: "Present",
  "Non affecté": "Unassigned",
  Brouillon: "Draft",
  Publié: "Published",
  Publiés: "Published",
  Tous: "All",
  "Tous les statuts": "All statuses",
  "Toutes les stations": "All stations",
  "Aucune demande trouvée": "No requests found",
  "Aucun shift à venir": "No upcoming shifts",
  "Voir le planning": "View schedule",
  "Demandes affichées": "Requests shown",
  "Compte uSwap": "uSwap account",
  Rôle: "Role",
  "Paramètres de notification": "Notification settings",
  "Choisissez comment recevoir les informations importantes.":
    "Choose how to receive important updates.",
  "Toutes les stations autorisées": "All permitted stations",
  "Aucune notification pour le moment.": "No notifications yet.",
  "Tout marquer lu": "Mark all as read",
  "Filtrer par catégorie": "Filter by category",
  Toutes: "All",
  "Examiner les accès": "Review access",
  "Voir la demande de congé": "View leave request",
  "Voir l’incident": "View incident",
  "Pointer mon service": "Clock in",
  "Voir le pointage": "View attendance",
  "Voir le remplacement": "View cover request",
  "Ouvrir le suivi": "Open tracking",
  "Gérer mes préférences": "Manage preferences",
  "Mes préférences": "My preferences",
  Opérations: "Operations",
  Autres: "Other",
  "Aucune notification dans": "No notifications in",
  "notification non lue": "unread notification",
  "notifications non lues": "unread notifications",
  "Rubriques du compte": "Account sections",
  "Préférences de notification": "Notification preferences",
  "Consultez et ajustez les notifications que vous recevez.":
    "Review and adjust the notifications you receive.",
  Activées: "Enabled",
  Désactivées: "Disabled",
  "Canal de notification": "Notification channel",
  "Notifications dans l’application": "In-app notifications",
  "Notifications par e-mail": "Email notifications",
  "Notifications push": "Push notifications",
  "Récapitulatif quotidien": "Daily summary",
  "Heures de silence": "Quiet hours",
  Début: "Start",
  Fin: "End",
  "Période de conservation": "Retention period",
  jours: "days",
  "Dernière mise à jour": "Last updated",
  "Tableau de bord indisponible": "Dashboard unavailable",
  "Tableau de bord": "Dashboard",
  "Shifts du jour": "Today's shifts",
  "Aucun shift sur cette période": "No shifts in this period",
  "Aucune affectation publiée pour aujourd’hui.": "No assignments have been published for today.",
  "Aucun shift ne correspond à ce filtre.": "No shifts match this filter.",
  Horaire: "Time",
  Swappeur: "Swapper",
  Statut: "Status",
  "Vue chronologique des affectations publiées.": "Timeline of published assignments.",
  Filtrer: "Filter",
  Attendu: "Expected",
  "Au-delà de la tolérance": "Beyond the grace period",
  "Sans pointage valide": "No valid clock-in",
  "Shifts terminés": "Completed shifts",
  "Pointage clôturé": "Clock-out recorded",
  Remplacements: "Replacements",
  "traité aujourd’hui": "handled today",
  "traités aujourd’hui": "handled today",
  "Heures de la semaine": "Hours this week",
  "Limite dépassée de": "Over the limit by",
  "h restantes": "h remaining",
  "Comptes actifs sur le périmètre": "Active accounts in this area",
  "Ces chiffres concernent vos propres shifts.": "These figures cover your own shifts.",
  "Pilotage des opérations": "Operations overview",
  "Votre périmètre, en un coup d’œil": "Your area at a glance",
  "Repérez les shifts à couvrir, puis suivez les présences, incidents et services à venir par station.": "See which shifts need cover, then track attendance, incidents and upcoming services by station.",
  "Voir les pointages": "View attendance",
  "Ouvrir le planning": "Open schedule",
  "Prochains shifts": "Upcoming shifts",
  "Les services publiés, regroupés par station.": "Published services, grouped by station.",
  "Aucun shift publié": "No published shifts",
  "Les prochains services apparaîtront ici après publication.": "Upcoming services will appear here once published.",
  "Shifts regroupés par station": "Shifts grouped by station",
  "Prochain :": "Next:",
  "Affectations publiées, classées par heure de début": "Published assignments, ordered by start time",
  "Horaires publiés et personnes affectées": "Published schedules and assigned people",
  "En cours": "In progress",
  "À venir": "Upcoming",
  "Espace personnel": "Personal space",
  "Retrouvez ici votre présence et vos prochains services.": "See your attendance and upcoming shifts here.",
  "Votre présence": "Your attendance",
  "Sur ": "Across ",
  "shift terminé": "completed shift",
  "s terminés": "completed shifts",
  "Vos indicateurs apparaîtront après votre premier shift terminé.": "Your stats will appear after your first completed shift.",
  "Shift en cours": "Current shift",
  "Prochain shift": "Next shift",
  "Présent · en retard": "Present · late",
  "Début déjà pointé": "Clock-in recorded",
  "Créneau en cours": "Shift in progress",
  Accessible: "Available",
  "Temps effectué": "Time worked",
  "Durée prévue": "Scheduled duration",
  "Prendre mon service": "Start my shift",
  "Terminer mon service": "End my shift",
  "Ce shift est clôturé.": "This shift is closed.",
  "Le pointage sera disponible 15 minutes avant le début du shift.": "Clock-in opens 15 minutes before the shift starts.",
  "Les prochains shifts publiés et affectés à votre compte apparaîtront ici. Vos anciens services restent consultables dans l’historique.": "Published shifts assigned to you will appear here. Past shifts remain available in your history.",
  "Historique de pointage": "Attendance history",
  "Aucun pointage antérieur sur cette période": "No earlier attendance records in this period",
  "Aucun résultat pour ce filtre": "No results for this filter",
  "Mes affectations": "My assignments",
  "Mes plannings": "My schedules",
  "Consultez vos services à venir et vos périodes terminées.": "View upcoming services and completed periods.",
  "Prochain service": "Next shift",
  "Aucun planning pour le moment": "No schedules yet",
  "Aucun planning ne correspond": "No schedules match",
  "Essayez un autre statut ou un autre terme de recherche.": "Try another status or search term.",
  "Shifts inclus": "Shifts included",
  "Chargement des plannings…": "Loading schedules…",
  "Chargement indisponible": "Unable to load",
  "Aucun planning terminé": "No completed schedules",
  "Aucun planning à venir": "No upcoming schedules",
  "Aucun planning publié": "No published schedules",
  "Changez de période pour consulter vos autres plannings.": "Choose another period to view your other schedules.",
  "Vos plannings apparaîtront ici dès qu’une affectation vous sera publiée.": "Your schedules will appear here once an assignment is published.",
  "Créez votre premier planning pour commencer à affecter des swappeurs.": "Create your first schedule to start assigning swappers.",
  "Vos horaires apparaîtront ici dès leur publication.": "Your schedules will appear here once published.",
  "Consultation seule : vous voyez les plannings publiés de votre station et vos propres shifts.": "View only: you can see published schedules for your station and your own shifts.",
  "Créer un brouillon": "Create draft",
  "Générer automatiquement": "Generate automatically",
  "Rechercher un planning": "Search schedules",
  "Nom, station ou période…": "Name, station or period…",
  "Filtrer mes plannings par période": "Filter my schedules by period",
  "Aucun pointage sur cette période.": "No attendance records in this period.",
  "Pilotage du réseau": "Network overview",
  "Plannings sur la période": "Schedules in this period",
  "Heures planifiées": "Scheduled hours",
  "Actions attendues": "Actions needed",
  "Services attribués par station": "Shifts assigned by station",
  "Gérer les stations": "Manage stations",
  "Répartition des présences": "Attendance breakdown",
  "Configuration du réseau": "Network setup",
  "Suivi administratif": "Administration",
  "Demandes de congé et rapports programmés.": "Leave requests and scheduled reports.",
  "Filtrer par": "Filter by",
  "Statut des plannings": "Schedule status",
  "Chargement du tableau de bord…": "Loading dashboard…",
  "Tableau de bord actualisé.": "Dashboard refreshed.",
  "Aucun service publié": "No published service",
  "Une seule semaine publiée": "Only one week published",
  "Mes plannings publiés": "My published schedules",
  Présents: "Present",
  Absents: "Absent",
  Attendus: "Expected",
  "de couverture": "coverage",
  "Journée opérationnelle du": "Operational day of",
  "heure de Douala": "Douala time",
  Entrée: "Clock-in",
  Sortie: "Clock-out",
  "Indicateurs du jour": "Today's metrics",
  "shifts terminés": "completed shifts",
  "Historique de pointage complet": "Full attendance history",
  "Le pointage concerné par la notification est mis en évidence.": "The attendance record linked to this notification is highlighted.",
  "Retrouvez l'ensemble de vos pointages.": "View all your attendance records.",
  "Ce pointage n’est plus présent dans l’historique chargé. Les autres pointages restent consultables ci-dessous.": "This record is no longer in the loaded history. Other records remain available below.",
  "La fin de service sera disponible à": "Clock-out will be available at",
  "Le pointage de ce shift n’est plus disponible. Contactez le superviseur en cas de correction nécessaire.": "Clock-in is no longer available for this shift. Contact your supervisor if a correction is needed.",
  Organisation: "Organisation",
  Activité: "Activity",
  Priorités: "Priorities",
  Réseau: "Network",
  Présence: "Attendance",
  Du: "From",
  Au: "To",
  "à affecter au planning": "to assign in schedules",
  "de congé en attente": "leave requests pending",
  "à activer": "to activate",
  "Consultez les plannings publiés de votre station et vos propres shifts.": "View published schedules for your station and your own shifts.",
  "shift": "shift",
  "shifts": "shifts",
  Révision: "Revision",
  lendemain: "next day",
  Terminé: "Completed",
  Justifié: "Justified",
  "Non pointé": "Not clocked in",
  "Absence justifiée": "Justified absence",
  Absences: "Absences",
  "Shift en cours, sans pointage": "Shift in progress, not clocked in",
  "Période en cours": "Current period",
  "Choisir une période": "Choose a period",
  Personnalisée: "Custom",
  Jour: "Day",
  Semaine: "Week",
  Mois: "Month",
  Année: "Year",
  "Tous les plannings": "All schedules",
  "Activité consolidée des six dernières semaines": "Consolidated activity over the last six weeks",
  Dates: "Dates",
  "Choisir une période personnalisée": "Choose a custom period",
  "Échelle de période": "Period scale",
  "Dates personnalisées": "Custom dates",
  "Date de début": "Start date",
  "Date de fin": "End date",
  "Période précédente": "Previous period",
  "Choisir une date": "Choose a date",
  "Période suivante": "Next period",
  "Évolution des heures planifiées par semaine": "Scheduled hours by week",
  "Résumé des plannings": "Schedule summary",
  "service planifié": "scheduled shift",
  "services planifiés": "scheduled shifts",
  "planning publié": "published schedule",
  "plannings publiés": "published schedules",
  "Indicateurs clés": "Key metrics",
  "Voir les services attribués par station": "View assigned shifts by station",
  "Services attribués": "Assigned shifts",
  "Voir le détail des présences": "View attendance details",
  "Présence des équipes": "Team attendance",
  "Chargement des présences…": "Loading attendance…",
  "Voir l’évolution des heures planifiées": "View scheduled hours trend",
  "Voir les actions attendues": "View actions needed",
  "Actions à faire": "Actions to do",
  "Décisions et affectations en attente": "Pending decisions and assignments",
  "Aucune action urgente": "No urgent actions",
  "Calcul des actions…": "Calculating actions…",
  "Calcul en cours…": "Calculating…",
  "Stations configurées": "Stations configured",
  "Équipe enregistrée": "Team members added",
  "Accès validés": "Access approved",
  "Planning publié": "Schedule published",
};

type I18nContextValue = {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The current tab still switches language when storage is unavailable.
    }
  }, []);
  const t = useCallback(
    (text: string) => translate(text, language),
    [language],
  );
  const value: I18nContextValue = {
    language,
    locale: language === "en" ? "en-GB" : "fr-FR",
    setLanguage,
    t,
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const syncLanguage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY)
        setLanguageState(event.newValue === "en" ? "en" : "fr");
    };
    window.addEventListener("storage", syncLanguage);
    return () => window.removeEventListener("storage", syncLanguage);
  }, []);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translate static UI labels without requiring each leaf component to consume context. */
export function currentLocale(language = selectedLanguage()) {
  return language === "en" ? "en-GB" : "fr-FR";
}

export function translate(
  text: string,
  language: Language = selectedLanguage(),
): string {
  const key = normalizeTranslationKey(text);
  if (language !== "en") return key;
  const direct = enExtra[key] ?? en[key];
  if (direct) return direct;
  if (key.includes(" · "))
    return key
      .split(" · ")
      .map((part) => translate(part, language))
      .join(" · ");
  return key;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label={t("Choisir la langue")}
    >
      {(["fr", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={language === option}
          aria-label={option === "fr" ? t("Français") : t("Anglais")}
          onClick={() => setLanguage(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
