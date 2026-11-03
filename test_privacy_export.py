import copy
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import polyline
import pytest

sys.path.insert(0, str(Path(__file__).parent / "run_page"))

from privacy_export import (
    export_public_activities,
    load_policy,
    meters_between,
    redact_route,
    validate_public_activities,
)

NOW = dt.datetime(2026, 11, 10, tzinfo=dt.UTC)
ZONE = {"latitude": 43.0, "longitude": -5.0, "radius_m": 400}
ROUTES = {
    "version": 1,
    "mode": "routes",
    "start_end_meters": 300,
    "delay_hours": 72,
    "zones": [ZONE],
}


def example_activity(route=None, date="2026-10-02 19:32:18"):
    return {
        "run_id": 987654,
        "name": "Home evening training — apartment address",
        "type": "Run",
        "subtype": "Run",
        "start_date": date,
        "start_date_local": date,
        "distance": 15_000,
        "moving_time": "1:12:30",
        "summary_polyline": route,
        "location_country": "Private street address",
        "country_code": "ES",
        "region": "Asturias",
        "average_heartrate": 155,
        "average_speed": 3.2,
        "elevation_gain": 100,
        "streak": 3,
        "provider_secret": "must not escape",
    }


def test_missing_policy_is_aggregate_only(monkeypatch):
    monkeypatch.delenv("RUNNING_PRIVACY_CONFIG", raising=False)
    assert load_policy()["mode"] == "aggregate"
    source = example_activity(polyline.encode([(42.0, -5.0), (42.1, -5.0)]))
    before = copy.deepcopy(source)
    public = export_public_activities([source], now=NOW)
    assert source == before
    assert public[0]["summary_polyline"] is None
    assert public[0]["route_segments"] == []
    assert public[0]["name"] == "Run"
    assert public[0]["location_country"] is None
    assert public[0]["run_id"] == 1
    assert public[0]["start_date_local"] == "2026-10-02"
    assert "provider_secret" not in public[0]
    validate_public_activities(public)


def test_workflow_delay_override_preserves_private_policy(monkeypatch, tmp_path):
    path = tmp_path / "privacy.json"
    path.write_text(json.dumps(ROUTES), encoding="utf-8")
    monkeypatch.setenv("RUNNING_PRIVACY_CONFIG", str(path))
    monkeypatch.setenv("RUNNING_PRIVACY_DELAY_HOURS", "24")
    policy = load_policy()
    assert policy["mode"] == "routes"
    assert policy["zones"] == ROUTES["zones"]
    assert policy["delay_hours"] == 24
    # At UTC midnight on Nov 10, the 24 h hold plus the extra 24 h date
    # margin includes the 8th but not the 9th.
    activities = [
        example_activity(date="2026-11-08 20:00:00"),
        example_activity(date="2026-11-09 08:00:00"),
    ]
    exported = export_public_activities(activities, now=NOW)
    assert [x["start_date_local"] for x in exported] == ["2026-11-08"]


def test_zero_delay_publishes_current_date_without_hidden_extra_day(
    monkeypatch, tmp_path
):
    path = tmp_path / "privacy.json"
    path.write_text(json.dumps(ROUTES), encoding="utf-8")
    monkeypatch.setenv("RUNNING_PRIVACY_CONFIG", str(path))
    monkeypatch.setenv("RUNNING_PRIVACY_DELAY_HOURS", "0")
    policy = load_policy()
    assert policy["delay_hours"] == 0
    assert policy["mode"] == "routes"
    assert policy["zones"] == ROUTES["zones"]
    activities = [
        example_activity(date="2026-11-09 20:00:00"),
        example_activity(date="2026-11-10 07:00:00"),
        example_activity(date="2026-11-11 09:00:00"),
    ]
    result = export_public_activities(activities, now=NOW)
    assert [item["start_date_local"] for item in result] == [
        "2026-11-09",
        "2026-11-10",
    ]


@pytest.mark.parametrize("value", ["-1", "24.0", "today", "", "721"])
def test_invalid_workflow_delay_is_rejected(monkeypatch, value):
    monkeypatch.delenv("RUNNING_PRIVACY_CONFIG", raising=False)
    monkeypatch.setenv("RUNNING_PRIVACY_DELAY_HOURS", value)
    with pytest.raises(ValueError, match="delay_hours|RUNNING_PRIVACY_DELAY_HOURS"):
        load_policy()


def test_unknown_sport_metadata_cannot_be_used_as_private_text():
    source = example_activity()
    source["type"] = "Run from personal residence"
    source["subtype"] = "Private clinic"
    public = export_public_activities([source], now=NOW)[0]
    assert public["type"] == public["name"] == "Activity"
    assert public["subtype"] is None


def test_zero_distance_weight_training_keeps_safe_sport_type():
    source = example_activity()
    source.update(
        type="WeightTraining",
        subtype="WeightTraining",
        distance=0,
        average_speed=0,
        summary_polyline=None,
    )
    result = export_public_activities([source], now=NOW)[0]
    assert result["name"] == result["type"] == "WeightTraining"
    assert result["subtype"] == "WeightTraining"
    assert result["distance"] == 0
    assert result["route_segments"] == []


def test_route_segments_break_at_private_zone_and_never_bridge():
    # Ends are far outside the circle; the route crosses the zone twice.
    points = [
        (43.0, -5.06),
        (43.0, -5.04),
        (43.0, -5.02),
        (43.0, -4.999),
        (43.0, -4.985),
        (43.0, -4.97),
        (43.0, -4.95),
    ]
    segments = redact_route(polyline.encode(points), ROUTES)
    assert len(segments) == 2
    for encoded in segments:
        coords = polyline.decode(encoded)
        assert len(coords) >= 2
        assert all(meters_between(p, (43, -5)) > 400 for p in coords)
    public = export_public_activities(
        [example_activity(polyline.encode(points))], policy=ROUTES, now=NOW
    )
    assert len(public[0]["route_segments"]) == 2
    validate_public_activities(public, policy=ROUTES)


def test_sparse_segment_crossing_zone_is_removed():
    # Neither endpoint is inside, but a straight line would cross the home.
    points = [(43, -5.04), (43, -5.02), (43, -4.98), (43, -4.96)]
    segments = redact_route(polyline.encode(points), ROUTES)
    assert len(segments) == 0


def test_endpoint_trim_covers_start_and_end():
    points = [(42.0 + i * 0.0005, -5) for i in range(50)]
    segments = redact_route(polyline.encode(points), ROUTES)
    assert len(segments) == 1
    kept = polyline.decode(segments[0])
    assert meters_between(points[0], kept[0]) >= 300
    assert meters_between(points[-1], kept[-1]) >= 300


def test_too_short_route_drops_gps_but_preserves_metrics():
    route = polyline.encode([(42, -5), (42.0002, -5), (42.0004, -5)])
    a = export_public_activities([example_activity(route)], policy=ROUTES, now=NOW)[0]
    assert a["summary_polyline"] is None
    assert a["route_segments"] == []
    assert a["distance"] == 15_000


def test_delay_excludes_recent_activities():
    examples = [
        example_activity(date="2026-11-09 08:00:00"),
        example_activity(date="2026-10-01 08:00:00"),
    ]
    assert len(export_public_activities(examples, now=NOW)) == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"version": 1, "mode": "routes", "start_end_meters": 50, "zones": [ZONE]},
        {"version": 1, "mode": "routes", "start_end_meters": 300, "zones": []},
        {
            "version": 1,
            "mode": "routes",
            "start_end_meters": 300,
            "zones": [{**ZONE, "radius_m": 50}],
        },
        {"version": 1, "mode": "public"},
        {"version": 0, "mode": "aggregate"},
    ],
)
def test_invalid_policy_fails_closed(bad):
    with pytest.raises(ValueError):
        export_public_activities([example_activity()], policy=bad, now=NOW)


def test_validator_rejects_unsafe_fields_and_raw_tracks():
    public = export_public_activities([example_activity()], now=NOW)
    public[0]["name"] = "Home address"
    with pytest.raises(ValueError):
        validate_public_activities(public)
    public[0]["name"] = "Run"
    public[0]["summary_polyline"] = "_p~iF~ps|U"
    with pytest.raises(ValueError):
        validate_public_activities(public)


def test_private_policy_file_is_explicit_and_required_if_set(monkeypatch, tmp_path):
    path = tmp_path / "privacy.json"
    monkeypatch.setenv("RUNNING_PRIVACY_CONFIG", str(path))
    with pytest.raises(FileNotFoundError):
        load_policy()


def test_cli_exports_and_checks_protected_segments_without_mutating_input(tmp_path):
    sample = example_activity(
        polyline.encode(
            [
                (43, -5.06),
                (43, -5.04),
                (43, -5.02),
                (43, -4.999),
                (43, -4.985),
                (43, -4.97),
                (43, -4.95),
            ]
        )
    )
    policy_file = tmp_path / "privacy.json"
    input_file = tmp_path / "raw.json"
    public_file = tmp_path / "public.json"
    policy_file.write_text(json.dumps(ROUTES))
    input_file.write_text(json.dumps([sample]))
    before = input_file.read_bytes()
    env = {**__import__("os").environ, "RUNNING_PRIVACY_CONFIG": str(policy_file)}
    script = str(Path(__file__).parent / "run_page" / "privacy_export.py")
    for args in (
        ["--input", str(input_file), "--output", str(public_file)],
        ["--check", str(public_file)],
    ):
        subprocess.run(
            [sys.executable, script, *args],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
    assert input_file.read_bytes() == before
    output = json.loads(public_file.read_text())
    assert len(output) == 1
    assert len(output[0]["route_segments"]) == 2


def test_atomic_write_does_not_replace_existing_file_on_bad_policy(tmp_path):
    from privacy_export import write_public_json

    target = tmp_path / "published.json"
    target.write_text("previous safe export")
    bad = {"version": 1, "mode": "routes", "zones": []}
    with pytest.raises(ValueError):
        export_public_activities([example_activity()], policy=bad)
    # Missing file fails before atomic replacement.
    with pytest.raises(ValueError):
        write_public_json(target, [example_activity(date="bad-date")])
    assert target.read_text() == "previous safe export"
