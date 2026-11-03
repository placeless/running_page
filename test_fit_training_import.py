"""COROS FIT strength sessions may have no distance field or GPS points."""

import datetime as dt
import sys
from pathlib import Path
from types import SimpleNamespace

from garmin_fit_sdk.util import FIT_EPOCH_S

sys.path.insert(0, str(Path(__file__).parent / "run_page"))

from gpxtrackposter.track import Track
from gpxtrackposter.track_loader import TrackLoader


def _session(sport="training", sub_sport="strength_training"):
    start = dt.datetime(2026, 10, 18, 9, 0, tzinfo=dt.UTC)
    record = {
        "sport": sport,
        "sub_sport": sub_sport,
        "start_time": int(start.timestamp()) - FIT_EPOCH_S,
        "total_elapsed_time": 1800,
        "total_timer_time": 1700,
        "avg_heart_rate": 135,
    }
    if sport == "running":
        record["total_distance"] = 5000
    return record


def test_fit_strength_without_distance_is_importable():
    track = Track()
    track._load_fit_data({"session_mesgs": [_session()], "record_mesgs": []})
    assert track.type == "WeightTraining"
    assert track.length == 0
    assert track.moving_dict["distance"] == 0
    assert track.moving_dict["moving_time"] == dt.timedelta(seconds=1700)
    assert track.polyline_str == ""
    assert track.start_time_local is not None


def test_fit_generic_training_without_distance_maps_to_workout():
    track = Track()
    track._load_fit_data(
        {"session_mesgs": [_session(sub_sport="generic")], "record_mesgs": []}
    )
    assert track.type == "Workout"
    assert track.length == 0


def test_gpsless_fit_uses_explicit_timezone_not_shanghai(monkeypatch):
    monkeypatch.setenv("RUNNING_FIT_TIMEZONE", "Europe/Madrid")
    session = _session()
    # 17:00 UTC on an October DST day is still the same local day in Spain,
    # but Asia/Shanghai would incorrectly assign the next calendar day.
    session["start_time"] += 8 * 3600
    track = Track()
    track._load_fit_data({"session_mesgs": [session], "record_mesgs": []})
    assert track.start_time_local.date() == dt.date(2026, 10, 18)
    assert track.start_time_local.hour == 19


def test_provider_calendar_date_overrides_timezone_fallback(monkeypatch, tmp_path):
    import generator

    monkeypatch.setenv("RUNNING_FIT_TIMEZONE", "UTC")
    session = _session()
    track = Track()
    track._load_fit_data({"session_mesgs": [session], "record_mesgs": []})
    track.file_names = ["example.fit"]
    monkeypatch.setattr(
        generator.track_loader.TrackLoader,
        "load_tracks",
        lambda *_args, **_kwargs: [track],
    )
    monkeypatch.setattr(generator, "save_synced_data_file_list", lambda _: None)
    app = generator.Generator(tmp_path / "test.db")
    try:
        app.sync_from_data_dir(
            str(tmp_path),
            file_suffix="fit",
            activity_local_dates={"example": dt.date(2026, 10, 19)},
        )
        result = app.load()
        assert len(result) == 1
        assert result[0]["type"] == "WeightTraining"
        assert result[0]["start_date_local"].startswith("2026-10-19")
        assert result[0]["start_date"].startswith("2026-10-18")
        updated = Track()
        updated._load_fit_data({"session_mesgs": [session], "record_mesgs": []})
        updated.file_names = ["example.fit"]
        monkeypatch.setattr(
            generator.track_loader.TrackLoader,
            "load_tracks",
            lambda *_args, **_kwargs: [updated],
        )
        app.sync_from_data_dir(
            str(tmp_path),
            file_suffix="fit",
            activity_local_dates={"example": dt.date(2026, 10, 20)},
            refresh_file_names={"example.fit"},
        )
        refreshed = app.load()
        assert len(refreshed) == 1
        assert refreshed[0]["start_date_local"].startswith("2026-10-20")
        assert refreshed[0]["start_date"].startswith("2026-10-18")
    finally:
        app.session.close()
        app.session.bind.dispose()


def test_fit_loader_includes_only_valid_distance_free_training(monkeypatch):
    loader = TrackLoader()

    def track(sport, distance, seconds):
        return SimpleNamespace(
            type=sport,
            length=distance,
            moving_dict={"moving_time": dt.timedelta(seconds=seconds)},
            start_time_local=dt.datetime(2026, 10, 18, 12, 0),
            file_names=[f"{sport}-{distance}-{seconds}.fit"],
            special=False,
        )

    records = [
        track("WeightTraining", 0, 1800),
        track("Workout", 0, 1200),
        track("Run", 0, 1800),
        track("WeightTraining", 0, 0),
        track("Run", 5000, 1600),
    ]
    monkeypatch.setattr(
        loader,
        "_list_data_files",
        lambda _path, _suffix, **_kwargs: iter(["one.fit"]),
    )
    monkeypatch.setattr(
        loader,
        "_load_data_tracks",
        lambda _files, _load_func, _titles: {str(i): t for i, t in enumerate(records)},
    )
    accepted = loader.load_tracks("/unused", file_suffix="fit")
    assert [(t.type, t.length) for t in accepted] == [
        ("WeightTraining", 0),
        ("Workout", 0),
        ("Run", 5000),
    ]
    assert loader.load_tracks("/unused", file_suffix="gpx") == [records[-1]]
