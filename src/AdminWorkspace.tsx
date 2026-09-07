import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Clock3, LayoutDashboard, LoaderCircle, LogOut, MapPin, RefreshCw, Search, ShieldCheck, UserRound, Users, Zap } from './icons';
import { api, ApiError, roles, type User } from './auth-api';
import './admin.css';

type Member = User & { isActive: boolean; stationId: string | null; createdAt: string };
type Station = { id: string; name: string; isActive: boolean; location: string | null; timezone: string; contactName: string | null; contactPhone: string | null };
const sections = [
  { path: '/app/admin', label: 'Vue d’ensemble', Icon: LayoutDashboard },
  { path: '/app/admin/utilisateurs', label: 'Utilisateurs', Icon: Users },
  { path: '/app/admin/stations', label: 'Stations', Icon: Building2 },
  { path: '/app/admin/compte', label: 'Mon compte', Icon: UserRound },
];
export const isAdminPath = (path: string) => sections.some(section => section.path === path);
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function AdminWorkspace({ user, busy, warning, error, onLogout, onExtend, onAccessLost }: {
  user: User; busy: boolean; warning: boolean; error: string;
  onLogout: () => void; onExtend: () => void; onAccessLost: () => void;
}) {
  const [path, setPath] = useState(location.pathname);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const title = useRef<HTMLHeadingElement>(null);
  const section = sections.find(section => section.path === path) || sections[0];
  const home = section.path === '/app/admin';

  useEffect(() => {
    const navigate = () => { setPath(location.pathname); setQuery(''); setRole(''); setStatus(''); setPage(1); };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  useEffect(() => { document.title = `${section.label} · Administration uSwap`; }, [section.label]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    Promise.all([api<Member[]>('/users'), api<Station[]>('/stations')]).then(([members, stations]) => {
      if (active) { setMembers(members); setStations(stations); }
    }).catch(error => {
      if (!active) return;
      setMembers(null); setStations(null);
      if (error instanceof ApiError && [401, 403].includes(error.status)) onAccessLost();
      else setLoadError('Les données n’ont pas pu être chargées. Réessayez.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id, revision]);

  function go(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (target === path) return;
    history.pushState(null, '', target); setPath(target);
    setQuery(''); setRole(''); setStatus(''); setPage(1);
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => title.current?.focus());
  }
  const link = (target: string) => ({ href: target, onClick: (event: MouseEvent<HTMLAnchorElement>) => go(event, target) });
  const filtered = (members || []).filter(member =>
    (!query || fold(`${member.fullName} ${member.email}`).includes(fold(query))) &&
    (!role || member.role === role) && (!status || String(member.isActive) === status));
  const lastPage = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, lastPage);
  const visibleMembers = home ? (members || []).slice(0, 5) : filtered.slice((currentPage - 1) * 8, currentPage * 8);
  const visibleStations = (stations || []).filter(station => !query || fold(`${station.name} ${station.location || ''}`).includes(fold(query)));
  const activeMembers = members?.filter(member => member.isActive).length;
  const activeStations = stations?.filter(station => station.isActive).length;

  function memberList() {
    return visibleMembers.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Collaborateur</th><th>Rôle</th><th>Statut</th>{!home && <th>Station rattachée</th>}</tr></thead>
      <tbody>{visibleMembers.map(member => <tr key={member.id}>
        <td><div className="admin-person"><span className="admin-avatar" aria-hidden="true">{initials(member.fullName)}</span><div><strong>{member.fullName}</strong><span>{member.email}</span></div></div></td>
        <td>{roles[member.role]}</td><td><span className={`admin-badge ${member.isActive ? 'active' : ''}`}>{member.isActive ? 'Actif' : 'Inactif'}</span></td>
        {!home && <td>{stations?.find(station => station.id === member.stationId)?.name || '—'}</td>}
      </tr>)}</tbody></table></div> : <div className="admin-empty"><Users size={26}/><h3>{query || role || status ? 'Aucun résultat' : 'Aucun utilisateur'}</h3><p>{query || role || status ? 'Essayez avec d’autres critères.' : 'Les comptes apparaîtront ici une fois créés.'}</p></div>;
  }

  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-main">Aller au contenu</a>
    <aside className="admin-sidebar">
      <a className="brand" {...link('/app/admin')} aria-label="uSwap, accueil administrateur"><span className="brand-symbol"><Zap fill="currentColor"/></span><span className="brand-lockup"><span className="brand-name">u<span className="brand-swap">Swap</span><span className="brand-dot">.</span></span><span className="brand-endorsement">Powered by <strong>uPowa</strong></span></span></a>
      
      <nav aria-label="Navigation administrateur">{sections.map(({ path: target, label, Icon }) => <a key={target} {...link(target)} aria-current={section.path === target ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{section.path === target && <i/>}</a>)}</nav>
      <div className="admin-sidebar-bottom"><button onClick={onLogout} disabled={busy}><LogOut size={18}/>Se déconnecter</button></div>
    </aside>
    <div className="admin-body">
      <header className="admin-topbar"><div><span className="admin-mobile-brand">uSwap<span>.</span></span><span className="admin-breadcrumb">Administration <ChevronRight size={13}/> {section.label}</span></div>
        <a className="admin-profile" {...link('/app/admin/compte')} aria-label="Ouvrir mon compte"><span className="admin-avatar dark">{initials(user.fullName)}</span><span><strong>{user.fullName}</strong><small>Administrateur</small></span><ChevronRight size={15}/></a>
      </header>
      <main id="admin-main" className="admin-content">
        {warning && <div className="session-warning" role="alert"><Clock3 size={18}/><div>Votre session va expirer.<button className="text-button" onClick={onExtend} disabled={busy}>Prolonger ma session</button></div></div>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="admin-page-heading"><div><p className="admin-eyebrow">{home ? `Bonjour, ${user.fullName.trim().split(/\s+/)[0]}` : 'ADMINISTRATION'}</p><h1 ref={title} tabIndex={-1}>{section.label}</h1></div>
          {section.path.endsWith('compte') ? null : <button className="admin-button secondary" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/>Actualiser</button>}
        </div>
        {section.path.endsWith('compte') ? <section className="admin-card admin-account"><div className="admin-card-heading"><h2>Mon profil</h2><ShieldCheck size={20}/></div><div className="admin-account-identity"><span className="admin-avatar dark">{initials(user.fullName)}</span><div><h3>{user.fullName}</h3><span className="admin-badge active">Compte actif</span></div></div><dl><div><dt>Adresse e-mail</dt><dd>{user.email}</dd></div><div><dt>Rôle</dt><dd>Administrateur</dd></div></dl><button className="admin-button secondary" onClick={onLogout} disabled={busy}><LogOut size={16}/>Se déconnecter</button></section>
        : loadError ? <div className="admin-card admin-empty" role="alert"><RefreshCw size={25}/><h2>Chargement indisponible</h2><p>{loadError}</p><button className="admin-button" onClick={() => setRevision(value => value + 1)}>Réessayer</button></div>
        : loading ? <div className="admin-loading" role="status"><LoaderCircle className="spin" size={24}/>Chargement de votre espace…</div>
        : home ? <>
          <section className="admin-stats" aria-label="Indicateurs du réseau">
            <a className="admin-stat" {...link('/app/admin/utilisateurs')}><span className="admin-stat-icon"><Users size={21}/></span><span>Utilisateurs<strong data-testid="user-count">{members?.length}</strong><small>{activeMembers} actif{activeMembers === 1 ? '' : 's'}</small></span><ArrowRight size={17}/></a>
            <a className="admin-stat" {...link('/app/admin/stations')}><span className="admin-stat-icon orange"><Building2 size={21}/></span><span>Stations<strong data-testid="station-count">{stations?.length}</strong><small>{activeStations} active{activeStations === 1 ? '' : 's'}</small></span><ArrowRight size={17}/></a>
            <div className="admin-stat"><span className="admin-stat-icon"><UserRound size={21}/></span><span>Swappeurs<strong>{members?.filter(member => member.role === 'SWAPPER').length}</strong></span></div>
          </section>
          <div className="admin-dashboard-grid">
            <section className="admin-card admin-recent"><div className="admin-card-heading"><div><h2>Derniers utilisateurs</h2></div><a className="admin-inline-link" {...link('/app/admin/utilisateurs')}>Tout voir <ArrowRight size={15}/></a></div>{memberList()}</section>
            <section className="admin-card admin-roles"><div className="admin-card-heading"><h2>Répartition des rôles</h2></div><div className="admin-role-list">{Object.entries(roles).map(([role, label], index) => { const count = members?.filter(member => member.role === role).length || 0; return <div key={role}><div><span><i className={`role-color color-${index}`}/>{label}</span><strong>{count}</strong></div><div className="admin-role-track" aria-hidden="true"><span className={`color-${index}`} style={{ width: `${members?.length ? count / members.length * 100 : 0}%` }}/></div></div>; })}</div></section>
          </div>
        </> : section.path.endsWith('utilisateurs') ? <section className="admin-card">
          <div className="admin-filters"><div className="admin-search"><Search size={17}/><input aria-label="Rechercher un utilisateur" placeholder="Rechercher un nom ou un e-mail" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }}/></div><select aria-label="Filtrer par rôle" value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="">Tous les rôles</option>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filtrer par statut" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Tous les statuts</option><option value="true">Actifs</option><option value="false">Inactifs</option></select></div>
          {memberList()}<div className="admin-pagination"><span>{filtered.length} résultat{filtered.length === 1 ? '' : 's'}</span><div><button aria-label="Page précédente" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17}/></button><span>{currentPage} / {lastPage}</span><button aria-label="Page suivante" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17}/></button></div></div>
        </section> : <><div className="admin-search station-search"><Search size={17}/><input aria-label="Rechercher une station" placeholder="Rechercher une station" value={query} onChange={event => setQuery(event.target.value)}/></div><div className="admin-station-grid">{visibleStations.map(station => <section className="admin-card admin-station" key={station.id}><div className="admin-station-top"><span className="admin-stat-icon orange"><Building2 size={23}/></span><span className={`admin-badge ${station.isActive ? 'active' : ''}`}>{station.isActive ? 'Active' : 'Inactive'}</span></div><h2>{station.name}</h2><p><MapPin size={15}/>{station.location || 'Adresse non renseignée'}</p><details><summary>Coordonnées de la station</summary><dl><div><dt>Contact</dt><dd>{station.contactName || 'Non renseigné'}</dd></div><div><dt>Téléphone</dt><dd>{station.contactPhone || 'Non renseigné'}</dd></div><div><dt>Fuseau horaire</dt><dd>{station.timezone}</dd></div></dl></details></section>)}</div>{!visibleStations.length && <div className="admin-card admin-empty"><Building2 size={28}/><h2>{query ? 'Aucune station trouvée' : 'Aucune station pour le moment'}</h2><p>{query ? 'Essayez avec un autre nom.' : 'Les stations apparaîtront ici une fois enregistrées.'}</p></div>}</>}
      </main>
    </div>
  </div>;
}
