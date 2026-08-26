#!/usr/bin/env python3
"""Paid-call-free browser smoke for Pegasus Spatial.

The default mode verifies only the public login shell and auth fence. When a
fixture identity is supplied by the TypeScript E2E harness, this script also
verifies credential login, registration, conversation reload, Spatial Job UI,
and the ownership-scoped status API. It never submits chat or calls a provider.
"""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for authenticated fixture mode")
    return value


def login(page: Page, base_url: str, email: str, password: str) -> None:
    page.goto(f"{base_url}/login", wait_until="networkidle")
    page.locator('input[name="email"]').fill(email)
    page.locator('input[name="password"]').fill(password)
    page.get_by_role("button", name="登录", exact=True).click()
    page.wait_for_url(f"{base_url}/", wait_until="domcontentloaded")
    page.get_by_role("button", name="新项目").first.wait_for(state="visible")


def open_and_verify_fixture(
    page: Page,
    base_url: str,
    conversation_id: str,
    conversation_title: str,
    job_id: str,
) -> None:
    job_status_url = (
        f"{base_url}/api/conversations/{conversation_id}/spatial/jobs/{job_id}"
    )
    with page.expect_response(
        lambda candidate: candidate.url == job_status_url,
        timeout=10_000,
    ) as status_response:
        page.get_by_text(conversation_title, exact=True).first.click()
    reconciled = status_response.value
    assert reconciled.status == 200
    reconciled_payload = reconciled.json()
    assert reconciled_payload["job"]["status"] == "published"

    job_label = page.get_by_text(f"JOB {job_id}", exact=True)
    job_label.wait_for(state="attached")
    job_label.scroll_into_view_if_needed()
    job_label.wait_for(state="visible")
    page.get_by_text("空间世界", exact=True).wait_for(state="visible")
    page.get_by_text("已发布", exact=True).wait_for(state="visible")
    page.get_by_text("fixture-no-network", exact=True).wait_for(state="visible")
    page.get_by_text(
        "空间任务已经从本地持久记录恢复，并由 Job API 校准到已发布；本测试没有访问 Aholo、Lux3D 或图像供应商。",
        exact=True,
    ).wait_for(state="visible")

    # This fixture intentionally seeds no Workspace object or manifest bytes.
    # A published status is not permission to invent an openable asset button.
    card = job_label.locator("xpath=ancestor::section[1]")
    assert card.get_by_role("button").count() == 0, "fixture must not expose fake assets"

    response = page.request.get(job_status_url)
    assert response.status == 200, f"authenticated spatial status={response.status}"
    payload = response.json()
    assert payload["job"]["job_id"] == job_id
    assert payload["job"]["status"] == "published"
    assert payload["job"]["provider"] == "fixture-no-network"


def verify_registration(browser: Browser, base_url: str, invite_code: str) -> None:
    email = required_env("SPATIAL_E2E_REGISTER_EMAIL")
    password = required_env("SPATIAL_E2E_REGISTER_PASSWORD")
    context = browser.new_context(viewport={"width": 1280, "height": 820})
    page = context.new_page()
    page.goto(f"{base_url}/login", wait_until="networkidle")
    page.get_by_role("button", name="没有账号？注册", exact=True).click()
    page.locator('input[name="name"]').fill("邀请码注册测试员")
    page.locator('input[name="invite_code"]').fill(invite_code)
    page.locator('input[name="email"]').fill(email)
    page.locator('input[name="password"]').fill(password)
    page.get_by_role("button", name="注册", exact=True).click()
    page.wait_for_url(f"{base_url}/", wait_until="domcontentloaded")
    profile = page.request.get(f"{base_url}/api/user/profile")
    assert profile.status == 200, f"registered profile status={profile.status}"
    assert profile.json()["email"] == email
    context.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3200")
    parser.add_argument(
        "--screenshot",
        default=str(Path(tempfile.gettempdir()) / "pegasus-spatial-login.png"),
    )
    parser.add_argument("--fixture-conversation-id")
    parser.add_argument("--fixture-title")
    parser.add_argument("--fixture-job-id")
    parser.add_argument("--fixture-invite-code")
    parser.add_argument("--phase", choices=("public", "before-restart", "after-restart"), default="public")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

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
        page.goto(f"{base_url}/login", wait_until="networkidle")
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
            f"{base_url}/api/conversations/not-owned/spatial/jobs/not-owned"
        )
        assert response.status == 401, f"unauthenticated spatial status={response.status}"

        fixture_args = (
            args.fixture_conversation_id,
            args.fixture_title,
            args.fixture_job_id,
        )
        if any(fixture_args) and not all(fixture_args):
            raise RuntimeError("authenticated fixture arguments must be supplied together")
        if all(fixture_args):
            email = required_env("SPATIAL_E2E_LOGIN_EMAIL")
            password = required_env("SPATIAL_E2E_LOGIN_PASSWORD")
            # The public shell check above intentionally switches to a mobile
            # viewport. The authenticated workspace is a desktop IDE surface,
            # so restore its supported viewport before exercising it.
            page.set_viewport_size({"width": 1440, "height": 960})
            login(page, base_url, email, password)
            open_and_verify_fixture(
                page,
                base_url,
                args.fixture_conversation_id,
                args.fixture_title,
                args.fixture_job_id,
            )

            # A browser refresh destroys React state. Reopening the project must
            # reconstruct the Job card from Mongo's persisted tool_result.
            page.reload(wait_until="domcontentloaded")
            page.get_by_text(args.fixture_title, exact=True).first.wait_for(state="visible")
            open_and_verify_fixture(
                page,
                base_url,
                args.fixture_conversation_id,
                args.fixture_title,
                args.fixture_job_id,
            )
            page.screenshot(path=str(screenshot), full_page=True)

            if args.phase == "before-restart":
                if not args.fixture_invite_code:
                    raise RuntimeError("before-restart phase requires a fixture invite code")
                verify_registration(browser, base_url, args.fixture_invite_code)

        unexpected = [
            item for item in failed_responses if "/api/conversations/not-owned/" not in item
        ]
        assert not unexpected, f"unexpected failed responses: {unexpected}"
        assert not console_errors, f"browser console errors: {console_errors}"
        browser.close()

    print(f"spatial-ui-smoke passed phase={args.phase} screenshot={args.screenshot}")


if __name__ == "__main__":
    main()
