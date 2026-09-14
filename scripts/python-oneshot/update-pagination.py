from pathlib import Path
p=Path('src/AdminWorkspace.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace('const [members, setMembers] = useState<Member[] | null>(null);','''const [members, setMembers] = useState<Member[] | null>(null);
  const [counts, setCounts] = useState<Record<string,number>>({all:0,active:0,pending:0,inactive:0});
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedQuery(query),250);return ()=>clearTimeout(timer);},[query]);''')
s=s.replace('    setLoading(true);','    setLoading(members === null);\n    setListLoading(true);',1)
s=s.replace('Promise.all([api<Member[]>("/users"), api<Station[]>("/stations")])','''const params = new URLSearchParams(home ? {limit:"1"} : {page:String(page),limit:"8",q:debouncedQuery,role,status,stationId:plannedStation,sort});
    Promise.all([api<{data:Member[];total:number;page:number;totalPages:number;statusCounts:Record<string,number>}>("/users/page?"+params), api<Station[]>("/stations")])''')
s=s.replace('setMembers(members);','setMembers(members.data);\n          setCounts(members.statusCounts);setTotal(members.total);setLastPage(members.totalPages);setCurrentPage(members.page);')
s=s.replace('if (active) setLoading(false);','if (active) {setLoading(false);setListLoading(false);}')
s=s.replace('}, [user.id, revision, path]);','}, [user.id, revision, path, page, debouncedQuery, role, status, plannedStation, sort]);')
a=s.index('  const filtered = (members || []).filter(')
b=s.index('  const visibleStations',a)
s=s[:a]+'  const visibleMembers = members || [];\n'+s[b:]
s=s.replace('const activeMembers = members?.filter((member) => member.isActive).length;','const activeMembers = counts.active;')
s=s.replace('{members?.length}','{counts.all}')
s=s.replace('members?.filter(m=>m.pendingActivation&&!m.disabledAt).length || 0','counts.pending')
s=s.replace('members?.filter(m => m.pendingActivation && !m.disabledAt).length || 0','counts.pending')
s=s.replace('members?.filter(m => m.pendingActivation && !m.disabledAt).length','counts.pending')
s=s.replace('statusCounts.filter(m=>!value||statusOf(m)===value).length','counts[value || "all"]')
s=s.replace('{memberList()}','{listLoading ? <div className="admin-loading" role="status">Chargement des utilisateurs…</div> : memberList()}')
s=s.replace('filtered.length','total').replace('disabled={currentPage === 1}','disabled={listLoading || currentPage === 1}').replace('disabled={currentPage === lastPage}','disabled={listLoading || currentPage === lastPage}')
p.write_text(s,encoding='utf-8')
p=Path('uswap-danielle/uswap-danielle/src/users/user-page.ts')
s=p.read_text(encoding='utf-8').replace('s."userId"','s."swapperId"')
p.write_text(s,encoding='utf-8')
