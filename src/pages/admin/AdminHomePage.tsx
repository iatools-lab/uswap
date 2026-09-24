import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon } from "@phosphor-icons/react";
import { UserCreateModal } from "../../features/users/UserCreateModal";
import { LeaveIntegrationHealth } from "../../features/leaves/LeaveIntegrationHealth";
import { ScheduledReports } from "../../features/reports/ScheduledReports";
import { greetingFor } from "../../utils/greeting";
import { interceptNav } from "../../app/spaNav";
import { useSession } from "../../app/session";
import { api, ApiError } from "../../api/auth-api";
import {
  Building2,
  Clock3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  UserRound,
  Users,
} from "../../ui/icons";

type Station = { id: string; name: string; isActive: boolean };

export function AdminHomePage() {
  const { session, onAccessLost } = useSession();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dismissOnboarding, setDismissOnboarding] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({
    all: 0,
    active: 0,
    pending: 0,
    inactive: 0,
  });
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.all([
      api<{ statusCounts: Record<string, number> }>("/users/page?limit=1"),
      api<Station[]>("/stations"),
    ])
      .then(([membersData, stationsData]) => {
        if (!active) return;
        setCounts(membersData.statusCounts);
        setStations(stationsData);
      })
      .catch((errorData) => {
        if (!active) return;
        if (
          errorData instanceof ApiError &&
          [401, 403].includes(errorData.status)
        )
          onAccessLost();
        else setLoadError("Les données n’ont pas pu être chargées. Réessayez.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onAccessLost, revision]);

  if (!session) return null;

  function go(event: MouseEvent<HTMLAnchorElement>, target: string) {
    interceptNav(event, navigate, target);
  }

  const link = (target: string) => ({
    href: target,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => go(event, target),
  });

  const activeStations =
    stations?.filter((station) => station.isActive).length || 0;
  const onboardingSteps = [
    {
      id: 1,
      title: "Configurez vos stations",
      description:
        "Enregistrez les emplacements physiques de votre réseau uSwap.",
      completed: (stations?.length || 0) > 0,
      ctaLabel: "Créer une station",
      action: () => navigate("/app/admin/stations?tab=list"),
    },
    {
      id: 2,
      title: "Ajoutez vos collaborateurs",
      description: "Invitez les chefs de station et vos swappeurs terrain.",
      completed: counts.all > 0,
      ctaLabel: "Créer un utilisateur",
      action: () => setShowCreateModal(true),
    },
    {
      id: 3,
      title: "Validez les accès en attente",
      description: "Activez les comptes en attente de confirmation.",
      completed: counts.pending === 0 && counts.all > 0,
      ctaLabel: "Vérifier les accès",
      href: "/app/admin/utilisateurs?status=pending",
      action: (e: MouseEvent<HTMLAnchorElement>) =>
        go(e, "/app/admin/utilisateurs?status=pending"),
    },
    {
      id: 4,
      title: "Publiez votre premier planning",
      description:
        "Affectez les shifts de la semaine sur vos stations actives.",
      completed: false,
      ctaLabel: "Ouvrir le planning",
      action: () => navigate("/app/admin/plannings"),
    },
  ];
  const completedCount = onboardingSteps.filter((s) => s.completed).length;

  if (loadError)
    return (
      <div className="admin-card admin-empty" role="alert">
        <RefreshCw size={25} />
        <h2>Chargement indisponible</h2>
        <p>{loadError}</p>
        <button
          className="admin-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          Réessayer
        </button>
      </div>
    );

  if (loading)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        Chargement de votre espace…
      </div>
    );

  return (
    <div className="admin-home">
      <UserCreateModal
        open={showCreateModal}
        stations={stations || []}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setRevision((value) => value + 1);
          setShowCreateModal(false);
        }}
      />

      <div className="home-header">
        <div>
          <p className="home-welcome">
            {greetingFor(session.user.fullName)} 👋
          </p>
          <p className="home-subtitle">
            Aperçu général et configuration de votre réseau uSwap
          </p>
        </div>
        <div className="home-actions">
          <a
            className="admin-button secondary small"
            {...link("/app/admin/stations?tab=list")}
          >
            Gérer les stations
          </a>
          <button
            type="button"
            className="admin-button primary-cta small"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon size={16} weight="bold" />
            Créer un utilisateur
          </button>
        </div>
      </div>

      <section className="network-overview" aria-label="Gestion du réseau">
        <a
          className="network-card card-accent-navy"
          {...link("/app/admin/utilisateurs")}
          aria-label="Gérer les utilisateurs"
        >
          <div className="network-card-head">
            <span className="network-card-label">Utilisateurs</span>
            <span className="network-icon-wrap navy">
              <Users size={18} />
            </span>
          </div>
          <div className="network-card-body">
            <strong className="network-card-value" data-testid="user-count">
              {counts.all}
            </strong>
            <span className="network-badge active">
              <i className="dot" /> {counts.active} actifs
            </span>
          </div>
        </a>

        <a
          className="network-card card-accent-blue"
          {...link("/app/admin/stations?tab=list")}
          aria-label="Consulter les stations"
        >
          <div className="network-card-head">
            <span className="network-card-label">Stations</span>
            <span className="network-icon-wrap blue">
              <Building2 size={18} />
            </span>
          </div>
          <div className="network-card-body">
            <strong className="network-card-value" data-testid="station-count">
              {stations?.length || 0}
            </strong>
            <span className="network-badge active">
              <i className="dot" /> {activeStations} actives
            </span>
          </div>
        </a>

        <a
          className={`network-card ${counts.pending > 0 ? "card-accent-amber warning" : "card-accent-neutral"}`}
          {...link("/app/admin/utilisateurs?status=pending")}
        >
          <div className="network-card-head">
            <span className="network-card-label">Accès à activer</span>
            <span
              className={`network-icon-wrap ${counts.pending > 0 ? "amber" : "neutral"}`}
            >
              <UserRound size={18} />
            </span>
          </div>
          <div className="network-card-body">
            <strong className="network-card-value">{counts.pending}</strong>
            <span
              className={`network-badge ${counts.pending > 0 ? "warning" : "neutral"}`}
            >
              {counts.pending === 0 ? "À jour" : "Comptes en attente"}
            </span>
          </div>
        </a>
      </section>

      <LeaveIntegrationHealth />
      <ScheduledReports />

      {!dismissOnboarding && (
        <section
          className="onboarding-card"
          aria-label="Progression de la configuration"
        >
          <button
            type="button"
            className="onboarding-dismiss-btn"
            aria-label="Masquer l'onboarding"
            onClick={() => setDismissOnboarding(true)}
          >
            ✕
          </button>
          <div className="onboarding-head">
            <div className="onboarding-title-wrap">
              <span className="onboarding-spark-icon">✨</span>
              <div>
                <h3>Bienvenue sur uSwap 👋</h3>
                <p>
                  Encore quelques étapes pour opérationnaliser complètement
                  votre réseau.
                </p>
              </div>
            </div>
            <div className="onboarding-progress-wrap">
              <span className="onboarding-progress-text">
                <strong>
                  {completedCount} SUR {onboardingSteps.length}
                </strong>{" "}
                TERMINÉ
              </span>
              <div className="onboarding-progress-bar">
                <div
                  className="onboarding-progress-fill"
                  style={{
                    width: `${(completedCount / onboardingSteps.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="onboarding-grid">
            {onboardingSteps.map((step) => {
              const stepIcons: Record<number, React.ReactNode> = {
                1: <MapPin size={15} />,
                2: <Users size={15} />,
                3: <UserRound size={15} />,
                4: <Clock3 size={15} />,
              };
              return (
                <div
                  key={step.id}
                  className={`onboarding-step-item ${step.completed ? "is-completed" : "is-active"}`}
                >
                  <div className="step-header-line">
                    <span className="step-status-indicator">
                      {step.completed ? (
                        <span className="check-badge">✓</span>
                      ) : (
                        <span className="radio-badge">{step.id}</span>
                      )}
                    </span>
                    <h4 className="step-title">
                      {step.completed && (
                        <span className="step-num">{step.id}</span>
                      )}
                      <span className="step-icon">{stepIcons[step.id]}</span>
                      <span>{step.title}</span>
                    </h4>
                  </div>
                  <p className="step-desc">{step.description}</p>
                  {!step.completed &&
                    (step.href ? (
                      <a
                        className="admin-button secondary small step-btn"
                        href={step.href}
                        onClick={
                          step.action as (
                            e: MouseEvent<HTMLAnchorElement>,
                          ) => void
                        }
                      >
                        {step.ctaLabel}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="admin-button secondary small step-btn"
                        onClick={step.action as () => void}
                      >
                        {step.ctaLabel}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
