"""Regression tests for actionable Strava API errors (no network calls)."""

import sys
from pathlib import Path

from stravalib.exc import Fault

sys.path.insert(0, str(Path(__file__).resolve().parent / "run_page"))
from strava_sync import is_inactive_strava_app  # noqa: E402


class FakeResponse:
    def __init__(self, status, errors):
        self.status_code = status
        self.errors = errors

    def json(self):
        return {"errors": self.errors}


def test_inactive_app_is_identified():
    response = FakeResponse(
        403, [{"resource": "Application", "field": "Status", "code": "Inactive"}]
    )
    assert is_inactive_strava_app(Fault("Forbidden", response=response))


def test_unrelated_403_is_not_misdiagnosed():
    response = FakeResponse(
        403, [{"resource": "Activity", "field": "Access", "code": "Denied"}]
    )
    assert not is_inactive_strava_app(Fault("Forbidden", response=response))


def test_other_http_status_is_not_misdiagnosed():
    response = FakeResponse(
        401, [{"resource": "Application", "field": "Status", "code": "Inactive"}]
    )
    assert not is_inactive_strava_app(Fault("Unauthorized", response=response))


def test_legacy_stravalib_fault_message_is_recognized():
    fault = Fault(
        "403 Client Error: Forbidden [Forbidden: "
        "[{'resource': 'Application', 'field': 'Status', 'code': 'Inactive'}]]"
    )
    assert is_inactive_strava_app(fault)
