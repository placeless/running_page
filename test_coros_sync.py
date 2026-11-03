"""COROS cutover and authentication regression tests (no live credentials)."""

import asyncio
import json
import sys
from datetime import UTC, date, datetime
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
    assert generated[0][1]["refresh_file_names"] == {"new.fit"}


def test_recent_activity_selection_checks_cached_fits_each_run():
    activities = {
        "old": {"date": 20261015},
        "recent": {"date": 20261101},
        "today": {"date": 20261103},
        "missing": {"date": 20260701},
    }
    cached = {"old", "recent", "today"}
    selected, refreshed = coros_sync.select_download_ids(
        activities, cached, today=date(2026, 11, 3), refresh_recent_days=7
    )
    assert selected == ["missing", "recent", "today"]
    assert refreshed == 2
    selected, refreshed = coros_sync.select_download_ids(
        activities, cached, today=date(2026, 11, 3), refresh_recent_days=0
    )
    assert selected == ["missing"]
    assert refreshed == 0


def test_coros_run_refreshes_existing_latest_fit(monkeypatch, tmp_path):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    (fit_dir / "42.fit").write_bytes(b"already downloaded")
    today = datetime.now(UTC).date()
    calls = []

    class FakeCoros:
        def __init__(self, _account, _password):
            self.req = self

        async def init(self):
            pass

        async def fetch_activity_ids_types(self, only_run):
            return [
                {
                    "labelId": "42",
                    "sportType": 100,
                    "date": int(today.strftime("%Y%m%d")),
                }
            ]

        async def download_activity(self, label_id, sport_type, file_type):
            calls.append(label_id)
            return label_id, "42.fit"

        async def aclose(self):
            pass

    published = []
    monkeypatch.setattr(coros_sync, "Coros", FakeCoros)
    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})
    monkeypatch.setattr(
        coros_sync,
        "make_activities_file",
        lambda *args, **kwargs: published.append(kwargs),
    )
    asyncio.run(
        coros_sync.download_and_generate(
            "account",
            "password",
            False,
            "fit",
            date(2026, 6, 30),
            refresh_recent_days=7,
        )
    )
    assert calls == ["42"]
    assert published[0]["refresh_file_names"] == {"42.fit"}
    assert published[0]["activity_local_dates"] == {"42": today}


def test_invalid_refresh_window_fails_before_download():
    with pytest.raises(ValueError, match="refresh_recent_days"):
        coros_sync.select_download_ids(
            {}, set(), today=date(2026, 11, 3), refresh_recent_days=31
        )


def test_refresh_file_names_bypass_import_manifest(monkeypatch, tmp_path):
    from gpxtrackposter import track_loader

    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    for name in ("recent.fit", "old.fit", "new.fit"):
        (fit_dir / name).write_bytes(b"fit data")
    monkeypatch.setattr(
        track_loader, "load_synced_file_list", lambda: ["recent.fit", "old.fit"]
    )
    paths = list(
        track_loader.TrackLoader._list_data_files(
            str(fit_dir), "fit", refresh_file_names={"recent.fit"}
        )
    )
    assert {Path(path).name for path in paths} == {"recent.fit", "new.fit"}


def test_import_manifest_deduplicates_refreshed_fits(monkeypatch, tmp_path):
    import synced_data_file_logger

    manifest = tmp_path / "imported.json"
    monkeypatch.setattr(synced_data_file_logger, "SYNCED_FILE", str(manifest))
    recent = ["recent.fit"]
    synced_data_file_logger.save_synced_data_file_list(recent)
    synced_data_file_logger.save_synced_data_file_list(recent)
    assert recent == ["recent.fit"]
    assert json.loads(manifest.read_text()) == ["recent.fit"]


@pytest.mark.parametrize(
    ("download_status", "download_body", "expected_error"),
    [
        (200, b"\x0e\x10\x00\x00\x00\x00\x00\x00.FITupdated", None),
        (200, b"invalid-fit-body", ValueError),
        (503, b"unavailable", httpx.HTTPStatusError),
    ],
)
def test_coros_refresh_preserves_cached_fit_on_error(
    monkeypatch, tmp_path, download_status, download_body, expected_error
):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    old_file = fit_dir / "123.fit"
    old_file.write_bytes(b"old-fit")

    def handler(request):
        if request.method == "POST":
            return httpx.Response(
                200, json={"data": {"fileUrl": "https://example.com/latest.fit"}}
            )
        return httpx.Response(download_status, content=download_body)

    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})

    async def exercise():
        coros = coros_sync.Coros("account", "password")
        coros.base_url = "https://teamapi.coros.com"
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            coros.req = client
            coros.download_req = client
            if expected_error is not None:
                with pytest.raises(expected_error):
                    await coros.download_activity(123, 100, "fit")
            else:
                assert await coros.download_activity(123, 100, "fit") == (
                    123,
                    "123.fit",
                )

    asyncio.run(exercise())
    assert old_file.read_bytes() == (
        download_body if expected_error is None else b"old-fit"
    )
    assert sorted(p.name for p in fit_dir.iterdir()) == ["123.fit"]


def test_coros_download_never_forwards_api_credentials(monkeypatch, tmp_path):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    observed = []
    original_client = httpx.AsyncClient

    def handler(request):
        observed.append((request.url.host, request.url.path, dict(request.headers)))
        if request.url.path == "/account/login":
            return httpx.Response(200, json={"data": {"accessToken": "test-token"}})
        if request.url.path == "/activity/query":
            return httpx.Response(200, json={"result": 0, "data": {"count": 0}})
        if request.url.path == "/activity/detail/download":
            return httpx.Response(
                200, json={"data": {"fileUrl": "https://files.example.com/a.fit"}}
            )
        return httpx.Response(200, content=b"\x0e\x10\x00\x00\x00\x00\x00\x00.FITsafe")

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})
    monkeypatch.setattr(
        coros_sync.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_client(*args, transport=transport, **kwargs),
    )

    async def exercise():
        client = coros_sync.Coros("account", "hash")
        await client.login()
        try:
            assert await client.download_activity(123, 100, "fit") == (123, "123.fit")
        finally:
            await client.req.aclose()
            await client.download_req.aclose()

    asyncio.run(exercise())
    assert (fit_dir / "123.fit").is_file()
    api_download = next(
        headers
        for host, path, headers in observed
        if path == "/activity/detail/download"
    )
    signed_download = next(
        headers for host, path, headers in observed if host == "files.example.com"
    )
    assert api_download["accesstoken"] == "test-token"
    assert "CPL-coros-token=test-token" in api_download["cookie"]
    assert "accesstoken" not in signed_download
    assert "cookie" not in signed_download
    assert "authorization" not in signed_download


@pytest.mark.parametrize(
    "url",
    [
        "http://files.example.com/a.fit",
        "https://localhost/a.fit",
        "https://127.0.0.1/a.fit",
        "https://[::1]/a.fit",
        "https://user:secret@files.example.com/a.fit",
        "https://files.example.com:8080/a.fit",
        "https://internal.local/a.fit",
        "https://singlehost/a.fit",
        "file:///tmp/a.fit",
    ],
)
def test_coros_download_rejects_unsafe_file_urls(url):
    with pytest.raises(ValueError, match="unsafe"):
        coros_sync.validate_download_url(url)


def test_coros_download_can_pin_exact_storage_hosts(monkeypatch):
    monkeypatch.setenv("COROS_DOWNLOAD_ALLOWED_HOSTS", "files.example.com")
    assert coros_sync.validate_download_url("https://files.example.com/a.fit")
    with pytest.raises(ValueError, match="unsafe"):
        coros_sync.validate_download_url("https://evil.files.example.com/a.fit")


def test_coros_download_redirects_are_anonymous_and_validated(monkeypatch, tmp_path):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    saved_file = fit_dir / "123.fit"
    saved_file.write_bytes(b"existing")
    requests = []
    target = "https://files.example.com/a.fit"

    def handler(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"data": {"fileUrl": target}})
        return httpx.Response(302, headers={"location": "http://localhost/secret"})

    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})

    async def exercise():
        coros = coros_sync.Coros("account", "password")
        coros.base_url = "https://teamapi.coros.com"
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            coros.req = client
            coros.download_req = client
            with pytest.raises(ValueError, match="unsafe"):
                await coros.download_activity(123, 100, "fit")

    asyncio.run(exercise())
    assert len(requests) == 2
    assert saved_file.read_bytes() == b"existing"
    assert sorted(p.name for p in fit_dir.iterdir()) == ["123.fit"]


def test_coros_download_follows_safe_redirect_without_credentials(
    monkeypatch, tmp_path
):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    observed = []

    def handler(request):
        observed.append((request.url.host, request.headers))
        if request.method == "POST":
            return httpx.Response(
                200,
                json={"data": {"fileUrl": "https://files.example.com/redirect"}},
            )
        if request.url.host == "files.example.com":
            return httpx.Response(
                302, headers={"location": "https://cdn.example.net/file.fit"}
            )
        return httpx.Response(200, content=b"\x0e\x10\x00\x00\x00\x00\x00\x00.FITsafe")

    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})

    async def exercise():
        coros = coros_sync.Coros("account", "password")
        coros.base_url = "https://teamapi.coros.com"
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            coros.req = client
            coros.download_req = client
            assert await coros.download_activity(123, 100, "fit") == (123, "123.fit")

    asyncio.run(exercise())
    assert len(observed) == 3
    assert all(
        "accesstoken" not in headers and "cookie" not in headers
        for host, headers in observed
        if host != "teamapi.coros.com"
    )
    assert (fit_dir / "123.fit").is_file()


def test_coros_download_size_limit_preserves_original(monkeypatch, tmp_path):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    original = fit_dir / "123.fit"
    original.write_bytes(b"cached")
    monkeypatch.setattr(coros_sync, "FOLDER_DICT", {"fit": str(fit_dir)})
    monkeypatch.setattr(coros_sync, "MAX_DOWNLOAD_BYTES", 8)

    def handler(request):
        if request.method == "POST":
            return httpx.Response(
                200, json={"data": {"fileUrl": "https://files.example.com/a.fit"}}
            )
        return httpx.Response(200, content=b"an oversized synthetic test file")

    async def exercise():
        coros = coros_sync.Coros("account", "password")
        coros.base_url = "https://teamapi.coros.com"
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            coros.req = client
            coros.download_req = client
            with pytest.raises(ValueError, match="download limit"):
                await coros.download_activity(123, 100, "fit")

    asyncio.run(exercise())
    assert original.read_bytes() == b"cached"
    assert sorted(p.name for p in fit_dir.iterdir()) == ["123.fit"]


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
