import argparse
import asyncio
import hashlib
import ipaddress
import json
import os
import tempfile
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import aiofiles
import httpx
from config import FOLDER_DICT, JSON_FILE, SQL_FILE

from utils import make_activities_file

COROS_API_HOSTS = ("teameuapi.coros.com", "teamapi.coros.com", "teamcnapi.coros.com")

COROS_TYPE_DICT = {
    "gpx": 1,
    "fit": 4,
    "tcx": 3,
}


TIME_OUT = httpx.Timeout(240.0, connect=360.0)
MAX_DOWNLOAD_REDIRECTS = 3
MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024


def validate_download_url(value):
    """Accept only public HTTPS file endpoints, never local network targets.

    COROS provides signed URLs on storage domains that may differ by region.
    COROS_DOWNLOAD_ALLOWED_HOSTS can pin exact observed domains without
    guessing provider-specific storage hostnames.
    """
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("COROS returned an unsafe download URL")
    try:
        url = httpx.URL(value)
        host = (url.host or "").lower().rstrip(".")
        if (
            url.scheme != "https"
            or not host
            or url.username
            or url.password
            or url.port not in (None, 443)
            or "." not in host
            or host == "localhost"
            or host.endswith((".localhost", ".local", ".internal"))
        ):
            raise ValueError("COROS returned an unsafe download URL")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError("COROS download URL must use a DNS hostname")

        allowed = os.getenv("COROS_DOWNLOAD_ALLOWED_HOSTS")
        if allowed and host not in {
            entry.strip().lower().rstrip(".") for entry in allowed.split(",")
        }:
            raise ValueError("COROS download URL host is not allowlisted")
    except (httpx.InvalidURL, ValueError) as exc:
        raise ValueError("COROS returned an unsafe download URL") from exc
    return url


class Coros:
    def __init__(self, account, password, is_only_running=False):
        self.account = account
        self.password = password
        self.is_only_running = is_only_running
        self.headers = None
        self.req = None
        self.download_req = None
        self.base_url = None

    async def login(self):
        headers = {
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9",
            "content-type": "application/json;charset=UTF-8",
            "dnt": "1",
            "origin": "https://t.coros.com",
            "referer": "https://t.coros.com/",
            "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        }
        data = {"account": self.account, "accountType": 2, "pwd": self.password}
        async with httpx.AsyncClient(timeout=TIME_OUT) as client:
            for host in COROS_API_HOSTS:
                base_url = f"https://{host}"
                try:
                    response = await client.post(
                        f"{base_url}/account/login", json=data, headers=headers
                    )
                    response.raise_for_status()
                    access_token = (response.json().get("data") or {}).get(
                        "accessToken"
                    )
                    if not access_token:
                        continue
                    auth_headers = {
                        "accesstoken": access_token,
                        "cookie": f"CPL-coros-region=2; CPL-coros-token={access_token}",
                    }
                    # A login token from the wrong region can be accepted but
                    # rejected by subsequent activity requests (COROS 1019).
                    probe = await client.get(
                        f"{base_url}/activity/query",
                        params={"modeList": "", "pageNumber": 1, "size": 1},
                        headers=auth_headers,
                    )
                    probe.raise_for_status()
                    payload = probe.json()
                    if payload.get("result") not in (None, 0, "0", "0000"):
                        continue
                    if not isinstance(payload.get("data"), dict):
                        continue
                    probe_data = payload["data"]
                    # An empty account omits dataList. A populated account
                    # must return it; otherwise this host is not usable.
                    if not (
                        isinstance(probe_data.get("dataList"), list)
                        or str(probe_data.get("count")) == "0"
                    ):
                        continue
                    self.base_url = base_url
                    self.headers = auth_headers
                    self.req = httpx.AsyncClient(timeout=TIME_OUT, headers=auth_headers)
                    # Never forward COROS access tokens or cookies to a signed
                    # file URL, which may be hosted outside coros.com.
                    self.download_req = httpx.AsyncClient(
                        timeout=TIME_OUT, follow_redirects=False, trust_env=False
                    )
                    print(f"COROS activity API region: {host}")
                    return
                except (httpx.HTTPError, ValueError, TypeError):
                    continue
        raise RuntimeError(
            "COROS authentication/activity access failed in every region. "
            "Check COROS_ACCOUNT and COROS_PASSWORD (and account MFA/region)."
        )

    async def init(self):
        await self.login()

    async def fetch_activity_ids_types(self, only_run):
        page_number = 1
        all_activities_ids_types = []

        mode_list_str = "100,101,102,103" if only_run else ""
        while True:
            url = f"{self.base_url}/activity/query"
            response = await self.req.get(
                url,
                params={
                    "modeList": mode_list_str,
                    "pageNumber": page_number,
                    "size": 20,
                },
            )
            response.raise_for_status()
            data = response.json()
            page = data.get("data")
            if data.get("result") not in (None, 0, "0", "0000") or not isinstance(
                page, dict
            ):
                raise RuntimeError("COROS activity query failed; refusing empty sync")
            activities = page.get("dataList")
            total_pages = page.get("totalPage")
            # COROS reports the *global* count even when a request is beyond
            # the final page, but omits dataList on that empty page.
            beyond_last_page = total_pages is not None and page_number > int(
                total_pages
            )
            if not activities and (str(page.get("count")) == "0" or beyond_last_page):
                break
            if not isinstance(activities, list) or not activities:
                raise RuntimeError(
                    "COROS returned an unexpected activity list "
                    f"(keys={sorted(page)}, count={page.get('count')!r}, "
                    f"page={page_number}, totalPage={total_pages})"
                )
            for activity in activities:
                label_id = activity["labelId"]
                activity["sportType"]
                if label_id is None:
                    continue
                all_activities_ids_types.append(activity)

            if total_pages is not None and page_number >= int(total_pages):
                break
            page_number += 1

        return all_activities_ids_types

    async def download_activity(self, label_id, sport_type, file_type):
        if sport_type == 101 and file_type == "gpx":
            print(
                f"Sport type {sport_type} is not supported in {file_type} file. The activity will be ignored"
            )
            return None, None
        download_folder = FOLDER_DICT[file_type]
        download_url = (
            f"{self.base_url}/activity/detail/download?labelId={label_id}&sportType={sport_type}"
            f"&fileType={COROS_TYPE_DICT[file_type]}"
        )
        response = await self.req.post(download_url)
        response.raise_for_status()
        file_url = (response.json().get("data") or {}).get("fileUrl")
        if not file_url:
            print(f"No file URL found for label_id {label_id}")
            return None, None
        if self.download_req is None:
            raise RuntimeError("COROS anonymous download client is not initialized")
        file_url = validate_download_url(file_url)

        # Use the stable COROS activity ID rather than a signed URL's
        # basename (which can vary and may contain sensitive query data).
        fname = f"{int(label_id)}.{file_type}"
        file_path = os.path.join(download_folder, fname)
        # Keep an existing cached FIT intact if a refresh is interrupted.
        fd, pending_path = tempfile.mkstemp(
            dir=download_folder, prefix=f".{fname}.", suffix=".part"
        )
        os.close(fd)
        try:
            for redirect in range(MAX_DOWNLOAD_REDIRECTS + 1):
                async with self.download_req.stream(
                    "GET", str(file_url), follow_redirects=False
                ) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        if redirect == MAX_DOWNLOAD_REDIRECTS:
                            raise ValueError("Too many COROS download redirects")
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("COROS download redirect has no location")
                        file_url = validate_download_url(
                            str(response.url.join(location))
                        )
                        continue
                    response.raise_for_status()
                    downloaded_bytes = 0
                    async with aiofiles.open(pending_path, "wb") as f:
                        async for chunk in response.aiter_bytes():
                            downloaded_bytes += len(chunk)
                            if downloaded_bytes > MAX_DOWNLOAD_BYTES:
                                raise ValueError("COROS export exceeds download limit")
                            await f.write(chunk)
                    break
            if os.path.getsize(pending_path) == 0:
                raise ValueError("COROS returned an empty activity file")
            if file_type == "fit":
                async with aiofiles.open(pending_path, "rb") as f:
                    if (await f.read(12))[8:12] != b".FIT":
                        raise ValueError("COROS returned an invalid FIT header")
            os.replace(pending_path, file_path)
        finally:
            if os.path.exists(pending_path):
                os.remove(pending_path)
        return label_id, fname


def activity_date(activity):
    """Read the COROS list timestamp, without relying on the export filename."""
    # COROS exposes the activity's local calendar date as YYYYMMDD.
    value = activity.get("date", activity.get("startTime"))
    if value is None:
        raise ValueError("COROS activity has no date/startTime; cannot enforce --since")
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        value = int(value)
        if 10_000_000 <= value <= 99_999_999:
            return datetime.strptime(str(value), "%Y%m%d").date()
        return datetime.fromtimestamp(
            value / 1000 if value > 100_000_000_000 else value,
            tz=UTC,
        ).date()
    return datetime.fromisoformat(str(value)).date()


def get_downloaded_ids(folder, file_type="fit"):
    """Only consider nonempty, valid-header FIT files as already downloaded."""
    downloaded = set()
    for name in os.listdir(folder):
        file = Path(folder) / name
        if name.startswith(".") or not name.endswith(f".{file_type}"):
            continue
        if not file.is_file() or file.is_symlink() or file.stat().st_size == 0:
            continue
        if file_type == "fit":
            with file.open("rb") as stream:
                if stream.read(12)[8:12] != b".FIT":
                    continue
        downloaded.add(file.stem)
    return downloaded


def save_private_audit_index(path, activities):
    """Persist only private COROS IDs for a count-only post-sync audit."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix=".coros-index-", suffix=".tmp", dir=destination.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump([str(activity["labelId"]) for activity in activities], stream)
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def select_download_ids(activities, downloaded_ids, *, today, refresh_recent_days):
    """Fetch missing activities and re-check cached recent ones on every run."""
    if not 0 <= refresh_recent_days <= 30:
        raise ValueError("refresh_recent_days must be between 0 and 30")
    missing = set(activities) - downloaded_ids
    if refresh_recent_days == 0:
        return sorted(missing), 0
    earliest = today - timedelta(days=refresh_recent_days - 1)
    refresh = {
        activity_id
        for activity_id, activity in activities.items()
        if activity_id in downloaded_ids and activity_date(activity) >= earliest
    }
    return sorted(missing | refresh), len(refresh)


async def download_and_generate(
    account, password, only_run, file_type, since=None, refresh_recent_days=7
):
    folder = FOLDER_DICT[file_type]
    downloaded_ids = get_downloaded_ids(folder, file_type)
    coros = Coros(account, password)
    await coros.init()
    try:
        activity_infos = await coros.fetch_activity_ids_types(only_run=only_run)
        if since is not None:
            activity_infos = [
                activity
                for activity in activity_infos
                if activity_date(activity) >= since
            ]
        audit_path = os.getenv("RUNNING_AUDIT_INDEX_FILE")
        if audit_path:
            save_private_audit_index(audit_path, activity_infos)
        activity_by_id = {
            str(activity["labelId"]): activity for activity in activity_infos
        }
        activity_id_type_dict = {
            activity_id: activity["sportType"]
            for activity_id, activity in activity_by_id.items()
        }
        print("activity_ids: ", len(activity_id_type_dict))
        print("downloaded_ids: ", len(downloaded_ids))
        to_download_ids, refreshed_count = select_download_ids(
            activity_by_id,
            downloaded_ids,
            today=datetime.now(UTC).date(),
            refresh_recent_days=refresh_recent_days,
        )
        print("to_download_activity_ids: ", len(to_download_ids))
        print("refresh_recent_cached_ids: ", refreshed_count)

        start_time = time.time()
        results = await gather_with_concurrency(
            10,
            [
                coros.download_activity(
                    label_id, activity_id_type_dict[label_id], file_type
                )
                for label_id in to_download_ids
            ],
        )
        print(f"Download finished. Elapsed {time.time() - start_time} seconds")
    finally:
        await coros.req.aclose()
        if getattr(coros, "download_req", None) is not None:
            await coros.download_req.aclose()
    skipped = sum(result == (None, None) for result in results)
    if skipped:
        print(
            f"COROS exports unavailable for {skipped} activities (unsupported mode/format)"
        )
    if to_download_ids and skipped == len(to_download_ids):
        raise RuntimeError("COROS returned no usable exports for new activities")
    downloaded_files = {name for _, name in results if name}
    local_dates = (
        {
            str(activity["labelId"]): activity_date(activity)
            for activity in activity_infos
            if activity.get("date") is not None
        }
        if file_type == "fit"
        else None
    )
    make_activities_file(
        SQL_FILE,
        folder,
        JSON_FILE,
        file_type,
        activity_local_dates=local_dates,
        refresh_file_names=downloaded_files,
    )


async def gather_with_concurrency(n, tasks):
    semaphore = asyncio.Semaphore(n)

    async def sem_task(task):
        async with semaphore:
            return await task

    return await asyncio.gather(*(sem_task(task) for task in tasks))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "account", nargs="?", help="COROS account (or COROS_ACCOUNT env)"
    )

    parser.add_argument(
        "password", nargs="?", help="COROS password (or COROS_PASSWORD env)"
    )
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        metavar="YYYY-MM-DD",
        help="only import activities on/after this date (preserve prior sources)",
    )
    parser.add_argument(
        "--refresh-recent-days",
        type=int,
        default=7,
        help="re-download cached COROS activities from the last N calendar days (0–30)",
    )

    parser.add_argument(
        "--only-run",
        dest="only_run",
        action="store_true",
        help="if is only for running",
    )

    parser.add_argument(
        "--tcx",
        dest="download_file_type",
        action="store_const",
        const="tcx",
        default="fit",
        help="to download personal documents or ebook",
    )
    parser.add_argument(
        "--gpx",
        dest="download_file_type",
        action="store_const",
        const="gpx",
        default="fit",
        help="to download personal documents or ebook",
    )
    options = parser.parse_args()

    account = options.account or os.getenv("COROS_ACCOUNT")
    password = options.password or os.getenv("COROS_PASSWORD")
    if not account or not password:
        parser.error("set COROS_ACCOUNT and COROS_PASSWORD as secrets")
    is_only_running = options.only_run
    file_type = options.download_file_type
    file_type = file_type if file_type in ["gpx", "tcx", "fit"] else "fit"
    encrypted_pwd = hashlib.md5(password.encode()).hexdigest()

    asyncio.run(
        download_and_generate(
            account,
            encrypted_pwd,
            is_only_running,
            file_type,
            options.since,
            options.refresh_recent_days,
        )
    )
