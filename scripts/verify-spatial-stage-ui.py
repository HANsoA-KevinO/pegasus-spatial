#!/usr/bin/env python3
"""Browser smoke for the standalone mixed Spatial Scene Stage.

This check never seeds a runnable job and never calls an external provider. A
mocked Scene exercises revision browsing while keeping all provider calls at 0.
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3200")
    parser.add_argument("--conversation-id", default="stage-empty-browser-smoke")
    parser.add_argument(
        "--screenshot",
        default=str(Path(tempfile.gettempdir()) / "pegasus-spatial-stage.png"),
    )
    parser.add_argument(
        "--embedded-screenshot",
        default=str(Path(tempfile.gettempdir()) / "pegasus-spatial-stage-embedded.png"),
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    console_errors: list[str] = []
    failed_responses: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, color_scheme="dark")
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
        page.route(
            "**/api/conversations",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body="[]",
            ),
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"conversation_id":"stage-empty-browser-smoke",'
                    '"title":"空世界舞台浏览器测试","messages":[],"settings":{},'
                    '"output":{"files":{},"manifest":{}},"is_running":false}'
                ),
            ),
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}/team",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"team":{"team_id":"team_fixture","status":"completed",'
                    '"created_at":"2026-08-27T00:00:00.000Z","updated_at":"2026-08-27T00:00:00.000Z"},'
                    '"agents":[],"counts":{"total":0,"running":0,"standby":0,"completed":0,"failed":0},'
                    '"latest_root_run":null,"latest_event_seq":0}'
                ),
            ),
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}/compaction",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body='{"compaction":null}',
            ),
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}/spatial/scenes",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"scenes":[{"scene_id":"scene_fixture","title":"可编辑客厅",'
                    '"current_version":2,"current_revision_id":"revision_2",'
                    '"agent_viewpoint":null}]}'
                ),
            ),
        )

        def fulfill_scene(route) -> None:
            version_one = "version=1" in route.request.url
            version = 1 if version_one else 2
            revision_id = f"revision_{version}"
            route.fulfill(
                status=200,
                content_type="application/json",
                body=(
                    '{"scene":{"scene_id":"scene_fixture","title":"可编辑客厅",'
                    '"current_version":2,"current_revision_id":"revision_2",'
                    '"agent_viewpoint":null},'
                    f'"revision":{{"revision_id":"{revision_id}","version":{version},'
                    '"change_summary":"自动 revision","world":null,"instances":[]},'
                    '"history":[{"revision_id":"revision_2","version":2,"change_summary":"当前版本"},'
                    '{"revision_id":"revision_1","version":1,"change_summary":"初始版本"}]}'
                ),
            )

        page.route(
            f"**/api/conversations/{args.conversation_id}/spatial/scenes/scene_fixture?*",
            fulfill_scene,
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}/spatial/scenes/scene_fixture/render-session",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body='{"session":{"session_id":"session_fixture","lease_token":"lease_fixture"}}',
            ),
        )
        page.route(
            f"**/api/conversations/{args.conversation_id}/spatial/scenes/scene_fixture/render-command",
            lambda route: route.fulfill(status=200, content_type="application/json", body='{"command":null}'),
        )
        page.goto(
            f"{base_url}/spatial/{args.conversation_id}",
            wait_until="networkidle",
        )
        page.get_by_text("SCENE STAGE · 空间创作台", exact=True).wait_for(state="visible")
        page.get_by_text("可编辑客厅", exact=True).first.wait_for(state="visible")
        page.get_by_text("Revision 历史（只读）", exact=True).wait_for(state="visible")
        page.get_by_text("从这里提出修改", exact=True).wait_for(state="visible")
        page.get_by_text("VERIFICATION BOUNDARY", exact=True).wait_for(state="visible")
        page.get_by_role("link", name="返回 Agent").wait_for(state="visible")
        page.get_by_label("Aholo 混合空间查看器").wait_for(state="visible")
        page.get_by_role("button", name="v1 初始版本").click()
        page.get_by_text("SCENE v1 · 只读历史", exact=True).wait_for(state="visible")
        page.get_by_role("button", name="返回当前 revision").click()
        page.get_by_text("SCENE v2", exact=True).wait_for(state="visible")

        overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        assert overflow <= 1, f"stage has horizontal overflow: {overflow}px"

        screenshot = Path(args.screenshot)
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)

        page.get_by_role("link", name="返回 Agent").click()
        page.wait_for_url(f"{base_url}/")
        page.get_by_role("tab", name="场景").click()
        page.get_by_role("button", name="v2 可编辑客厅 scene_fixture").click()
        page.get_by_text("SCENE · v2", exact=True).wait_for(state="visible")
        page.get_by_role("button", name="对象 0").wait_for(state="visible")
        page.get_by_role("button", name="版本 2").click()
        page.get_by_text("版本历史 · 只读", exact=True).wait_for(state="visible")
        page.get_by_role("button", name="从这里提出修改").wait_for(state="visible")
        page.locator("#pegasus-chat-input").wait_for(state="visible")
        page.get_by_text("空间舞台", exact=True).wait_for(state="detached")

        embedded_overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        assert embedded_overflow <= 1, f"embedded stage has horizontal overflow: {embedded_overflow}px"
        embedded_screenshot = Path(args.embedded_screenshot)
        embedded_screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(embedded_screenshot), full_page=True)
        assert not failed_responses, f"failed responses: {failed_responses}"
        assert not console_errors, f"browser console errors: {console_errors}"
        browser.close()

    print(
        "spatial-stage-ui passed "
        f"screenshot={args.screenshot} embedded_screenshot={args.embedded_screenshot} provider_calls=0"
    )


if __name__ == "__main__":
    main()
