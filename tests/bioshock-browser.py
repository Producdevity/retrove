"""Exercise BioShock 1.3.5 via the same file picker and diagnostics as mobile Safari."""
import argparse
import json
import mimetypes
import time
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright


def run(options):
    root = options.site_root.resolve()
    with sync_playwright() as playwright:
        browser = playwright.webkit.launch(executable_path=options.executable)
        try:
            page = browser.new_page(viewport={"width": 428, "height": 821}, has_touch=True, is_mobile=True)
            def serve(route):
                path = unquote(urlparse(route.request.url).path).lstrip("/") or "index.html"
                target = (root / path).resolve()
                if not target.is_relative_to(root) or not target.is_file():
                    route.fulfill(status=404)
                    return
                kind = "text/javascript" if target.suffix in (".mjs", ".js") else mimetypes.guess_type(target.name)[0]
                route.fulfill(content_type=kind or "application/octet-stream", body=target.read_bytes())
            page.route("http://127.0.0.1:8801/**", serve)
            page.goto("http://127.0.0.1:8801/#diagnostics")
            page.locator("#file").set_input_files(str(options.ipa.resolve()))
            started = time.monotonic()
            rendered = False
            log = ""
            snapshot = {}
            timed_out = False
            while time.monotonic() - started < options.timeout:
                page.wait_for_timeout(350)
                log, stopped = page.evaluate("() => [document.querySelector('#log').value, document.querySelector('#stop').hidden]")
                marker = "Latest runtime snapshot\n"
                if marker not in log:
                    if stopped:
                        break
                    continue
                snapshot = json.JSONDecoder().raw_decode(log.split(marker, 1)[1])[0]
                error = snapshot.get("fault")
                counts = snapshot.get("render", {})
                rendered = counts.get("presentedFrames", 0) >= 10 and counts.get("drawCalls", 0) >= 10
                if error or rendered or stopped:
                    break
            else:
                timed_out = True
            if options.log:
                options.log.write_text(log)
            if options.screenshot:
                page.screenshot(path=str(options.screenshot))
            if timed_out:
                raise RuntimeError(f"Timed out after {options.timeout}s in {snapshot.get('phase')}: {snapshot.get('activeImports')}")
            assert snapshot, log[:1200]
            assert '"crc32": "bf4c8604"' in log, "Expected the original English 1.3.5 executable"
            assert snapshot["completedInitializers"] == snapshot["initializers"] == 1084, snapshot["phase"]
            assert snapshot["imports"] == 686 and snapshot["unsupportedCount"] == 0, "Import resolution regressed"
            assert '"delegate": "IPhoneAppDelegate"' in log and "UIKit event loop" in log
            if options.startup_zip:
                assert snapshot.get("fault"), "Expected the resource boundary in the two-file startup archive"
                assert "Platform_InitEngine" in json.dumps(snapshot["fault"]), snapshot["fault"]["message"]
                assert any(path.endswith("/Default.ini") for path in snapshot["missingAssets"]), snapshot["missingAssets"]
                print("1,084/1,084 initializers, 686/686 imports, IPhoneAppDelegate and UE engine initialization verified.")
            else:
                assert rendered and not snapshot.get("fault"), (snapshot.get("fault") or snapshot["phase"])
                print("Original IPA produced", counts["presentedFrames"], "frames and", counts["drawCalls"], "draws.")
        finally:
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--startup-zip", action="store_true", help="assert the known executable-only resource boundary")
    parser.add_argument("--site-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--executable", help="use an installed Playwright WebKit executable")
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--log", type=Path)
    parser.add_argument("--screenshot", type=Path)
    run(parser.parse_args())
