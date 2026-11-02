#!/usr/bin/env python3
import argparse
import json
import sys

from config import JSON_FILE, SQL_FILE
from generator import Generator
from stravalib.exc import Fault


def is_inactive_strava_app(error: Fault) -> bool:
    """Recognize Strava's Application/Status/Inactive API response."""
    response = getattr(error, "response", None)
    if response is not None:
        if response.status_code != 403:
            return False
        try:
            errors = response.json().get("errors", [])
        except (ValueError, AttributeError):
            errors = []
        if any(
            entry.get("resource") == "Application"
            and entry.get("field") == "Status"
            and entry.get("code") == "Inactive"
            for entry in errors
            if isinstance(entry, dict)
        ):
            return True
    # stravalib 0.10.4 includes the structured fault in its error message.
    message = str(error)
    return "403" in message and "Application" in message and "Inactive" in message


# for only run type, we use the same logic as garmin_sync
def run_strava_sync(
    client_id,
    client_secret,
    refresh_token,
    sync_types: list | None = None,
    only_run=False,
):
    if sync_types is None:
        sync_types = []
    generator = Generator(SQL_FILE)
    generator.set_strava_config(client_id, client_secret, refresh_token)
    # judge sync types is only running or not
    if not only_run and len(sync_types) == 1 and sync_types[0] == "running":
        only_run = True
    # if you want to refresh data change False to True
    generator.only_run = only_run
    generator.sync(False)

    activities_list = generator.load()
    with open(JSON_FILE, "w") as f:
        json.dump(activities_list, f)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("client_id", help="strava client id")
    parser.add_argument("client_secret", help="strava client secret")
    parser.add_argument("refresh_token", help="strava refresh token")
    parser.add_argument(
        "--only-run",
        dest="only_run",
        action="store_true",
        help="if is only for running",
    )
    options = parser.parse_args()
    if not all((options.client_id, options.client_secret, options.refresh_token)):
        parser.error(
            "Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET "
            "or STRAVA_CLIENT_REFRESH_TOKEN."
        )
    try:
        run_strava_sync(
            options.client_id,
            options.client_secret,
            options.refresh_token,
            only_run=options.only_run,
        )
    except Fault as error:
        if not is_inactive_strava_app(error):
            raise
        print(
            "::error::Strava API application is inactive (403). "
            "The application owner needs an eligible Strava subscription. "
            "Sign into https://www.strava.com/settings/api with the owning account "
            "and reactivate the app. See docs/fork-maintenance.md.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
