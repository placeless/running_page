import argparse
import asyncio
import hashlib
import os
import time
from datetime import UTC, date, datetime

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


class Coros:
    def __init__(self, account, password, is_only_running=False):
        self.account = account
        self.password = password
        self.is_only_running = is_only_running
        self.headers = None
        self.req = None
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
        file_url = None
        fname = ""
        file_path = ""
        try:
            response = await self.req.post(download_url)
            response.raise_for_status()
            resp_json = response.json()
            file_url = resp_json.get("data", {}).get("fileUrl")
            if not file_url:
                print(f"No file URL found for label_id {label_id}")
                return None, None

            # Use the stable COROS activity ID rather than a signed URL's
            # basename (which can vary and may contain sensitive query data).
            fname = f"{int(label_id)}.{file_type}"
            file_path = os.path.join(download_folder, fname)

            async with self.req.stream("GET", file_url) as response:
                response.raise_for_status()
                async with aiofiles.open(file_path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        await f.write(chunk)
            return label_id, fname
        except Exception:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
            raise


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


def get_downloaded_ids(folder):
    return {os.path.splitext(i)[0] for i in os.listdir(folder) if not i.startswith(".")}


async def download_and_generate(account, password, only_run, file_type, since=None):
    folder = FOLDER_DICT[file_type]
    downloaded_ids = get_downloaded_ids(folder)
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
        activity_id_type_dict = {
            str(activity["labelId"]): activity["sportType"]
            for activity in activity_infos
        }
        print("activity_ids: ", len(activity_id_type_dict))
        print("downloaded_ids: ", len(downloaded_ids))
        to_generate_coros_ids = sorted(activity_id_type_dict.keys() - downloaded_ids)
        print("to_generate_activity_ids: ", len(to_generate_coros_ids))

        start_time = time.time()
        results = await gather_with_concurrency(
            10,
            [
                coros.download_activity(
                    label_id, activity_id_type_dict[label_id], file_type
                )
                for label_id in to_generate_coros_ids
            ],
        )
        print(f"Download finished. Elapsed {time.time() - start_time} seconds")
    finally:
        await coros.req.aclose()
    skipped = sum(result == (None, None) for result in results)
    if skipped:
        print(
            f"COROS exports unavailable for {skipped} activities (unsupported mode/format)"
        )
    if to_generate_coros_ids and skipped == len(to_generate_coros_ids):
        raise RuntimeError("COROS returned no usable exports for new activities")
    make_activities_file(SQL_FILE, folder, JSON_FILE, file_type)


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
            account, encrypted_pwd, is_only_running, file_type, options.since
        )
    )
