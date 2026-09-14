from pathlib import Path
import zipfile, hashlib, json

root=Path(__file__).resolve().parents[1]
current=root/'uswap-danielle/uswap-danielle'
destination=root/'docs/backend-review/danielle-2'
archive=Path('D:/uswap-danielle_2.zip')
destination.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive) as z:
    for entry in z.infolist():
        relative=Path(*Path(entry.filename).parts[1:])
        if not relative.parts or entry.is_dir():continue
        target=(destination/relative).resolve()
        if not target.is_relative_to(destination.resolve()):raise ValueError('Unsafe archive path')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(entry))
def eligible(p):return not any(x in p.parts for x in ('node_modules','dist','.git','coverage')) and p.name not in ('.env','tsconfig.tsbuildinfo')
old={p.relative_to(current).as_posix():p for p in current.rglob('*') if p.is_file() and eligible(p.relative_to(current))}
new={p.relative_to(destination).as_posix():p for p in destination.rglob('*') if p.is_file()}
result={'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'new':sorted(new.keys()-old.keys()),'absent_from_zip':sorted(old.keys()-new.keys()),'changed':[],'identical':[]}
for name in sorted(new.keys()&old.keys()):
    equal=old[name].read_bytes().replace(b'\r\n',b'\n')==new[name].read_bytes().replace(b'\r\n',b'\n')
    result['identical' if equal else 'changed'].append(name)
(root/'docs/backend-review/comparison.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
