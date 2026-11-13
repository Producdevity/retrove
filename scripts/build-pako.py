"""Bundle only the low-level routines used by the Darwin one-shot zlib API."""
import hashlib
import posixpath
import re
import tarfile
from pathlib import Path

vendor = Path(__file__).resolve().parents[1] / 'web/vendor'
archive = vendor / 'source/pako-1.0.11.tgz'
if hashlib.sha256(archive.read_bytes()).hexdigest() != '0d4028dc0352a740c30cbfd772917f2744986d42bfa0b06ec7642bffe7ad3941':
    raise SystemExit('Unexpected pako source digest')
parts = ['// Pako 1.0.11. Bundled for ESM; original source and license notices follow.\n']
seen = {}
with tarfile.open(archive) as tar:
    def module(path):
        if path in seen:
            return seen[path]
        text = tar.extractfile(path).read().decode()
        def dependency(match):
            child = posixpath.join(posixpath.dirname(path), match[1] + '.js')
            return module(posixpath.normpath(child))
        text = re.sub(r"require\('([^']+)'\)", dependency, text)
        name = 'pako_' + Path(path).stem
        seen[path] = name
        parts.append('const ' + name + ' = (() => {\nconst module = {exports: {}};\n'
                     'const exports = module.exports;\n' + text + '\nreturn module.exports;\n})();\n')
        return name
    for name in ['zstream', 'inflate', 'deflate', 'crc32']:
        module('package/lib/zlib/' + name + '.js')
    (vendor / 'pako-LICENSE.txt').write_bytes(tar.extractfile('package/LICENSE').read())
parts.append('export const ZStream = pako_zstream, crc32 = pako_crc32;\n'
             'export const {inflateInit2, inflate, inflateEnd} = pako_inflate;\n'
             'export const {deflateInit2, deflate, deflateEnd} = pako_deflate;\n')
(vendor / 'pako-zlib.mjs').write_text('\n'.join(parts))
