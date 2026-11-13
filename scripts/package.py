"""Build static files and an editable source download from the committed tree."""
import io
import subprocess
import tarfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
dist.mkdir(exist_ok=True)
source_tree = subprocess.check_output(["git", "archive", "HEAD"], cwd=root)
with tarfile.open(fileobj=io.BytesIO(source_tree)) as tar:
    with zipfile.ZipFile(dist / "bioshock-web.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for member in tar.getmembers():
            if not member.isfile() or member.name.startswith(".openai/"):
                continue
            data = tar.extractfile(member).read()
            archive.writestr("bioshock-web/" + member.name, data)
            if (member.name in ("index.html", "app.webmanifest", "README.md") or
                    member.name.startswith("web/") or member.name == "tests/fixtures/smoke.ipa"):
                target = dist / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    # Only the hosted instance serves the downloadable source zip.
    index = dist / "index.html"
    revision = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=root, text=True).strip()
    page = index.read_text().replace('name="runtime-build" content="source"',
                                     f'name="runtime-build" content="{revision}"')
    index.write_text(page.replace("</main>", '<footer><a href="bioshock-web.zip" download>Download source</a></footer>\n  </main>'))
