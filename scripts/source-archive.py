from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path('.')
with ZipFile('dist/source.zip','w',ZIP_DEFLATED) as out:
 for name in ['app','web','icons','scripts','tests']:
  for path in (root/name).rglob('*'):
   if path.is_file() and '__pycache__' not in path.parts: out.write(path,'reprise/'+str(path))
 for name in ['index.html','player.html','app.webmanifest','package.json','NOTICE.md','README.md','wrangler.jsonc']:
  if Path(name).exists(): out.write(name,'reprise/'+name)
