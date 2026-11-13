"""Run browser runtime regressions with Playwright and installed Chromium or WebKit."""
import argparse
import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


def storage(tab):
    tab.evaluate("async () => (await import('/tests/files-cases.mjs')).writeSave('browser-test')")
    tab.reload()
    tab.evaluate("async () => (await import('/tests/files-cases.mjs')).isolated('other-bundle')")
    tab.evaluate("async () => (await import('/tests/files-cases.mjs')).verifySave('browser-test')")
    tab.evaluate("async () => (await import('/tests/files-cases.mjs')).leaveOrphan('browser-test')")
    tab.reload()
    tab.evaluate("async () => (await import('/tests/files-cases.mjs')).verifyRecovery('browser-test')")


def graphics(tab):
    for context in ("webgl", "webgl2"):
        result = tab.evaluate("async kind => (await import('/tests/gles-browser.mjs')).render(kind)", context)
        print(context, "pixel", result["pixel"], "MSAA samples", result["samples"], flush=True)


def quartz(tab):
    result = tab.evaluate("async () => (await import('/tests/quartz-browser.mjs')).renderQuartz()")
    print("Quartz pixels", result, flush=True)


def touch(tab):
    tab.evaluate("""async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 100; document.body.appendChild(canvas);
        window.touchTest = await (await import('/tests/touch-browser.mjs')).startTouchTest(canvas);
    }""")
    canvas = tab.locator("canvas")
    rect = canvas.bounding_box()
    tab.mouse.move(rect["x"] + 30, rect["y"] + 40)
    tab.mouse.down()
    tab.mouse.move(rect["x"] + 42, rect["y"] + 50)
    tab.mouse.up()
    tab.wait_for_function("touchTest.events.length >= 3", timeout=5000)
    events = tab.evaluate("touchTest.events")
    assert [e["phase"] for e in events] == [0, 1, 3], events
    assert [e["point"] for e in events] == [[20, 20], [32, 30], [32, 30]], events
    assert all(e["count"] == 1 and e["target"] == e["expected"] for e in events), events
    assert len({e["touch"] for e in events}) == 1, events
    tab.evaluate("touchTest.stop()")

    # A landscape iOS 7 app keeps its key window in portrait. Exercise both
    # interface rotations, with the physical canvas scaled down by the browser.
    for orientation in ("UIInterfaceOrientationLandscapeRight", "UIInterfaceOrientationLandscapeLeft"):
        tab.evaluate("""async orientation => {
            const c = document.querySelector('canvas');
            c.width = 1136; c.height = 640; c.style.width = '284px'; c.style.height = '160px';
            window.touchTest = await (await import('/tests/touch-browser.mjs')).startTouchTest(c, orientation);
        }""", orientation)
        rect = canvas.bounding_box()
        tab.mouse.click(rect["x"] + 30, rect["y"] + 40)
        tab.wait_for_function("touchTest.events.length >= 2", timeout=5000)
        events = tab.evaluate("touchTest.events")
        assert [e["phase"] for e in events] == [0, 3], events
        assert all(e["point"] == [50, 60] and e["target"] == e["expected"] for e in events), events
        tab.evaluate("touchTest.stop()")


def movie(tab):
    result = tab.evaluate("async () => (await import('/tests/movie-browser.mjs')).movieTest()")
    print("MPMoviePlayerController pixel", result, flush=True)


def main(default_suite="all"):
    suites = {"storage": storage, "graphics": graphics, "touch": touch, "movie": movie, "quartz": quartz}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=["chromium", "webkit"], default="webkit")
    parser.add_argument("--executable", help="use an existing browser executable")
    parser.add_argument("--suite", choices=["all", *suites], default=default_suite)
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    def route(request):
        path = urlparse(request.request.url).path
        if path == "/":
            request.fulfill(content_type="text/html", body="<!doctype html><title>Runtime tests</title>")
            return
        target = (root / path.lstrip("/")).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            request.fulfill(status=404)
            return
        mime = "text/javascript" if target.suffix == ".mjs" else mimetypes.guess_type(target.name)[0]
        request.fulfill(content_type=mime or "application/octet-stream", body=target.read_bytes())

    with sync_playwright() as playwright:
        browser = getattr(playwright, options.browser).launch(executable_path=options.executable)
        try:
            for name, suite in suites.items():
                if options.suite not in ("all", name):
                    continue
                tab = browser.new_page()
                tab.route("http://127.0.0.1:8801/**", route)
                tab.goto("http://127.0.0.1:8801")
                suite(tab)
                print(name, "passed on", options.browser, browser.version, flush=True)
                tab.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
