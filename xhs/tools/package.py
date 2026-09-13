"""Package the standalone app. No npm/Python third-party dependencies needed."""
from pathlib import Path
import re
import zipfile

root = Path(__file__).resolve().parents[1]
app = root / 'app'
allowed = {'.html','.css','.js','.png','.jpg','.jpeg','.gif','.webp','.svg','.woff','.woff2','.json'}
files = sorted(p for p in app.rglob('*') if p.is_file())
assert (app/'index.html').is_file()
assert len([p for p in files if p.suffix == '.html']) == 1
for file in files:
    assert file.suffix in allowed, file
    if file.suffix in {'.html','.js','.css'}:
        text = file.read_text(encoding='utf-8')
        assert not re.search(r'https?://|type=["\']module|target=["\']_blank|\bdownload\s*=|\bonclick\s*=', text), file
        if file.suffix == '.js':
            assert not re.search(r'\?\.|\?\?|\{\s*\.\.\.|\bimport\s|\bexport\s|\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebAssembly|requestFullscreen|new\s+(?:Worker|SharedWorker|WebSocket)|\.replaceAll\(|structuredClone|\.flatMap\(|Object\.fromEntries', text), file
    assert not file.is_symlink(), file
html=(app/'index.html').read_text(encoding='utf-8')
for ref in re.findall(r'(?:src|href)="([^"]+)"',html):
    if ref.startswith('#'): continue
    assert ref.startswith('./') and (app/ref).is_file(),ref
archive=root/'oraen-view-xhs.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for file in files: z.write(file,file.relative_to(app).as_posix())
assert archive.stat().st_size<=10*1024*1024
print('Packaged',len(files),'files:',archive,'bytes:',archive.stat().st_size)
