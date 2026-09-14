import {PlanningInbox} from "./PlanningInbox";
import {Planner} from "./Planner";

import { AccountMenu } from "./AccountMenu";

import { AccountSettings } from "./AccountSettings";

import { useEffect, useState } from "react";

import { api, ApiError, roles, rolePaths, type User } from "./auth-api";

import {

  Building2,

  Clock3,

  LayoutDashboard,

  LoaderCircle,

  LogOut,

  RefreshCw,

  UserRound,

  Zap,

} from "./icons";

import "./admin.css";

import { Operations, type OperationData } from "./Operations";



type Data = OperationData;

export const isRolePath = (user: User, path: string) =>

  [rolePaths[user.role], `${rolePaths[user.role]}/compte`, `${rolePaths[user.role]}/plannings`].includes(path);

export function RoleWorkspace({

  user,

  busy,

  warning,

  error,

  onLogout,

  onExtend,

  onAccessLost,

}: {

  user: User;

  busy: boolean;

  warning: boolean;

  error: string;

  onLogout: () => void;

  onExtend: () => void;

  onAccessLost: () => void;

}) {

  const [planning, setPlanning] = useState(location.pathname.endsWith("/plannings"));

  const [account, setAccount] = useState(location.pathname.endsWith("/compte"));

  const [data, setData] = useState<Data | null>(null);

  const [failure, setFailure] = useState(false);

  const [revision, setRevision] = useState(0);

  const [planningResetKey, setPlanningResetKey] = useState(0);

  const title =

    user.role === "SUPERVISOR"

      ? "Supervision"

      : user.role === "STATION_CHIEF"

        ? "Ma station"

        : "Mon espace";

  useEffect(() => {

    document.title = `${account ? "Paramètres du compte" : planning ? "Plannings" : title} · uSwap`;

  }, [account, planning, title]);

  useEffect(() => {

    const pop = () => {setAccount(location.pathname.endsWith("/compte"));setPlanning(location.pathname.endsWith("/plannings"));};

    window.addEventListener("popstate", pop);

    return () => window.removeEventListener("popstate", pop);

  }, []);

  useEffect(() => {

    let active = true;

    setData(null);

    setFailure(false);

    api<Data>("/workspace")

      .then((value) => {

        if (active) setData(value);

      })

      .catch((error) => {

        if (!active) return;

        if (error instanceof ApiError && [401, 403].includes(error.status))

          onAccessLost();

        else setFailure(true);

      });

    return () => {

      active = false;

    };

  }, [user.id, user.role, revision]);

  function go(next: boolean) {

    history.pushState(null, "", rolePaths[user.role] + (next ? "/compte" : ""));

    setAccount(next);setPlanning(false);

    window.scrollTo(0, 0);

  }

  return (

    <div className="admin-workspace role-workspace">

      <a className="admin-skip" href="#role-main">

        Aller au contenu

      </a>

      <aside className="admin-sidebar">

        <a className="brand" href={rolePaths[user.role]}>

          <span className="brand-symbol">

            <Zap weight="fill" />

          </span>

          <span className="brand-lockup">

            <span className="brand-name">

              uSwap<span className="brand-dot">.</span>

            </span>

            <span className="brand-endorsement">

              Powered by <strong>uPowa</strong>

            </span>

          </span>

        </a>

        <nav aria-label={`Navigation ${roles[user.role]}`}>

          <a

            href={rolePaths[user.role]}

            onClick={(event) => {

              event.preventDefault();

              go(false);

            }}

            aria-current={!account && !planning ? "page" : undefined}

          >

            <LayoutDashboard />

            {title}

          </a>

          {<a href={`${rolePaths[user.role]}/plannings`} onClick={e=>{e.preventDefault();history.pushState(null,"",`${rolePaths[user.role]}/plannings`);if(planning)setPlanningResetKey(n=>n+1);setPlanning(true);setAccount(false);}} aria-current={planning?"page":undefined}><Clock3/>Plannings</a>}

          <a

            href={`${rolePaths[user.role]}/compte`}

            onClick={(event) => {

              event.preventDefault();

              go(true);

            }}

            aria-current={account ? "page" : undefined}

          >

            <UserRound />

            Mon compte

          </a>

        </nav>



      </aside>

      <div className="admin-body">

        <header className="admin-topbar">

          <span className="admin-mobile-brand">

            uSwap<span>.</span>

          </span>

          <span className="admin-breadcrumb">{roles[user.role]}</span>

          <PlanningInbox user={user}/><AccountMenu user={user} busy={busy} onLogout={onLogout} settingsPath={`${rolePaths[user.role]}/compte`}/>

        </header>

        <main id="role-main" className="admin-content">

          {warning && (

            <div className="session-warning" role="alert">

              <Clock3 />

              <div>

                Votre session va expirer.

                <button

                  className="text-button"

                  onClick={onExtend}

                  disabled={busy}

                >

                  Prolonger ma session

                </button>

              </div>

            </div>

          )}

          {error && (

            <p className="error-message" role="alert">

              {error}

            </p>

          )}

          <div className="admin-page-heading">

            <div>

              <p className="admin-eyebrow">

                Bonjour, {user.fullName.trim().split(/\s+/)[0]}

              </p>

              <h1>{account ? "Paramètres du compte" : planning ? "Plannings" : title}</h1>

            </div>



          </div>

          {account ? (

            <AccountSettings user={user}/>

          ) : planning ? (<Planner key={planningResetKey} user={user}/>) : failure ? (

            <section className="admin-card admin-empty" role="alert">

              <h2>Chargement indisponible</h2>

              <button

                className="admin-button"

                onClick={() => setRevision((value) => value + 1)}

              >

                Réessayer

              </button>

            </section>

          ) : !data ? (

            <div className="admin-loading" role="status">

              <LoaderCircle className="spin" />

              Chargement de votre espace…

            </div>

          ) : user.role === "STATION_CHIEF" && !data.station ? (

            <section className="admin-card admin-empty">

              <Building2 size={36} />

              <h2>Aucune station rattachée</h2>

              <p>

                Votre administrateur doit rattacher votre compte à une station.

              </p>

            </section>

          ) : (

            <Operations

              user={user}

              data={data}

              onChanged={() => setRevision((value) => value + 1)}

            />

          )}

        </main>

      </div>

    </div>

  );

}