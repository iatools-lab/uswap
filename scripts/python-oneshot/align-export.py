from pathlib import Path
p=Path('uswap-danielle/uswap-danielle/src/users/users.service.ts')
s=p.read_text(encoding='utf-8')
a=s.index('    const fold = (value: string) =>',s.index('  async export('))
b=s.index('    const cell = ',a)
s=s[:a]+'''    // Reuse the directory predicates; export every matching page, not just the visible one.
    const first = await this.page({...query, page:'1', limit:'100'});
    const rows = [...first.data];
    for (let page = 2; page <= first.totalPages; page++) {
      const batch = await this.page({...query, page:String(page), limit:'100'});
      rows.push(...batch.data);
    }
'''+s[b:]
p.write_text(s,encoding='utf-8')
p=Path('scripts/check-auth-browser.cjs')
s=p.read_text(encoding='utf-8').replace("'**/users',route", "'**/users/page?*',route").replace("unroute('**/users')", "unroute('**/users/page?*')")
p.write_text(s,encoding='utf-8')
