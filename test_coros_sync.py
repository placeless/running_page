"""COROS cutover and authentication regression tests (no live credentials)."""

import asyncio
import json
import sys
from datetime import date
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "run_page"))
import coros_sync


@pytest.mark.parametrize(
    ("start_time", "expected"),
    [
        (1782777600, date(2026, 6, 30)),
        (1782777600000, date(2026, 6, 30)),
        ("20260630", date(2026, 6, 30)),
        ("2026-06-30T12:00:00+02:00", date(2026, 6, 30)),
    ],
)
def test_coros_activity_date_formats(start_time, expected):
    assert coros_sync.activity_date({"startTime": start_time}) == expected


def test_missing_coros_timestamp_does_not_import_old_activity():
    with pytest.raises(ValueError, match="startTime"):
        coros_sync.activity_date({"labelId": "123"})


def test_coros_prefers_local_calendar_date():
    assert coros_sync.activity_date(
        {"date": 20260630, "startTime": "2026-06-29T23:20:00Z"}
    ) == date(2026, 6, 30)


def test_region_probe_rejects_wrong_region_token(monkeypatch):
    requests = []
    original = httpx.AsyncClient

    def handler(request):
        host = request.url.host
        requests.append((host, request.url.path))
        if request.url.path.endswith("/account/login"):
            assert json.loads(request.content)["pwd"] == "hashed-password"
            return httpx.Response(200, json={"data": {"accessToken": "test-token"}})
        assert request.headers["accesstoken"] == "test-token"
        if host == "teameuapi.coros.com":
            return httpx.Response(200, json={"result": 1019, "data": {"count": 0}})
        return httpx.Response(200, json={"result": 0, "data": {"count": "0"}})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        coros_sync.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original(*args, transport=transport, **kwargs),
    )

    async def exercise():
        client = coros_sync.Coros("athlete@example.com", "hashed-password")
        await client.login()
        try:
            assert client.base_url == "https://teamapi.coros.com"
        finally:
            await client.req.aclose()

    asyncio.run(exercise())
    assert ("teameuapi.coros.com", "/activity/query") in requests
    assert ("teamapi.coros.com", "/activity/query") in requests


def test_coros_cutover_keeps_existing_archive_and_skips_old_downloads(
    monkeypatch, tmp_path
):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    (fit_dir / "new-cached.fit").write_bytes(b"existing")
    events = []

    class FakeCoros:
        def __init__(self, account, password):
            self.req = self

        async def init(self):
            pass

        async def fetch_activity_ids_types(self, only_run):
            return [
                {"labelId": "old", "sportType": 100, "date": 20260629},
                {"labelId": "new-cached", "sportType": 100, "date": 20260701},
                {"labelId": "new", "sportType": 100, "date": 20260702},
            ]

        async def download_activity(self, label_id, sport_type, file_type):
            events.append((label_id, sport_type, file_type))
            return label_id, f"{label_id}.fit"

        async def aclose(self):
            pass

    generated = []
    monkeypatch.setattr(coros_sync, "Coros", FakeCoros)
    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})
    monkeypatch.setattr(
        coros_sync,
        "make_activities_file",
        lambda *args, **kwargs: generated.append((args, kwargs)),
    )
    asyncio.run(
        coros_sync.download_and_generate(
            "account", "hash", False, "fit", date(2026, 6, 30)
        )
    )
    assert events == [("new", 100, "fit")]
    assert len(generated) == 1
    assert generated[0][1]["activity_local_dates"] == {
        "new-cached": date(2026, 7, 1),
        "new": date(2026, 7, 2),
    }


def test_coros_api_error_does_not_pass_as_empty_sync():
    class FakeRequest:
        async def get(self, url, params):
            return httpx.Response(
                200,
                json={"result": 1019, "data": None},
                request=httpx.Request("GET", url),
            )

    coros = coros_sync.Coros("account", "hash")
    coros.req = FakeRequest()
    coros.base_url = "https://teameuapi.coros.com"
    with pytest.raises(RuntimeError, match="refusing empty sync"):
        asyncio.run(coros.fetch_activity_ids_types(only_run=False))


def test_coros_pagination_stops_at_last_page():
    page_numbers = []

    class FakeRequest:
        async def get(self, url, params):
            page = params["pageNumber"]
            page_numbers.append(page)
            return httpx.Response(
                200,
                json={
                    "result": "0000",
                    "data": {
                        "count": 21,
                        "pageNumber": page,
                        "totalPage": 2,
                        "dataList": [{"labelId": str(page), "sportType": 100}],
                    },
                },
                request=httpx.Request("GET", url),
            )

    coros = coros_sync.Coros("account", "hash")
    coros.req = FakeRequest()
    coros.base_url = "https://teamapi.coros.com"
    results = asyncio.run(coros.fetch_activity_ids_types(only_run=False))
    assert page_numbers == [1, 2]
    assert [activity["labelId"] for activity in results] == ["1", "2"]


def test_coros_exhausted_page_omits_data_list_but_keeps_global_count():
    class FakeRequest:
        async def get(self, url, params):
            return httpx.Response(
                200,
                json={"result": "0000", "data": {"count": 135, "totalPage": 7}},
                request=httpx.Request("GET", url),
            )

    coros = coros_sync.Coros("account", "hash")
    coros.req = FakeRequest()
    coros.base_url = "https://teamapi.coros.com"
    # Simulate starting a fetch on page 8 by the query being beyond last page.
    # Here page 1 has no records despite 7 pages, which must still fail.
    with pytest.raises(RuntimeError, match="unexpected activity list"):
        asyncio.run(coros.fetch_activity_ids_types(only_run=False))
