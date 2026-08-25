#!/usr/bin/env python3
"""Paid-call-free browser smoke for the public Pegasus Spatial shell.

Run against a local server whose SPATIAL_PAID_CALLS_ENABLED is 0. The script
does not sign in, seed data, or call any image/3D provider.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3200")
    parser.add_argument("--screenshot", default="/private/tmp/pegasus-spatial-login.png")
    args = parser.parse_args()

    console_errors: list[str] = []
    failed_responses: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on(
            "response",
            lambda response: failed_responses.append(f"{response.status} {response.url}")
            if response.status >= 400
            else None,
        )
        page.goto(f"{args.base_url.rstrip('/')}/login", wait_until="networkidle")
        assert page.title().startswith("Pegasus Spatial"), page.title()
        page.get_by_text("Pegasus Spatial", exact=True).first.wait_for(state="visible")
        page.get_by_text("飞马空间 Agent", exact=False).first.wait_for(state="visible")
        page.get_by_role("button", name="登录").wait_for(state="visible")

        desktop_overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        assert desktop_overflow <= 1, f"desktop horizontal overflow: {desktop_overflow}px"

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(250)
        mobile_overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        assert mobile_overflow <= 1, f"mobile horizontal overflow: {mobile_overflow}px"

        screenshot = Path(args.screenshot)
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)

        # An unowned/unauthenticated durable job status must not disclose
        # whether either identifier exists.
        response = page.request.get(
            f"{args.base_url.rstrip('/')}/api/conversations/not-owned/spatial/jobs/not-owned"
        )
        assert response.status == 401, f"unauthenticated spatial status={response.status}"

        unexpected = [
            item for item in failed_responses if "/api/conversations/not-owned/" not in item
        ]
        assert not unexpected, f"unexpected failed responses: {unexpected}"
        assert not console_errors, f"browser console errors: {console_errors}"
        browser.close()

    print(f"spatial-ui-smoke passed screenshot={args.screenshot}")


if __name__ == "__main__":
    main()
