"""Synthetic read-only data reconciliation: no real FIT/GPS or account access."""

import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "run_page"))

from reconciliation import reconcile_snapshot

NOW = dt.datetime(2026, 11, 3, tzinfo=dt.UTC)
POLICY = {"version": 1, "mode": "aggregate", "delay_hours": 0}
FIT_HEADER = b"\x0e\x10\x00\x00\x00\x00\x00\x00.FIT"


def audit_fixture(tmp_path):
    fit_dir = tmp_path / "FIT_OUT"
    fit_dir.mkdir()
    (fit_dir / "101.fit").write_bytes(FIT_HEADER)
    (fit_dir / "102.fit").write_bytes(FIT_HEADER)
    (fit_dir / "103.fit").write_bytes(b"invalid")
    manifest = tmp_path / "imported.json"
    manifest.write_text(json.dumps(["101.fit"]), encoding="utf-8")
    database = tmp_path / "private.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE activities (run_id INTEGER PRIMARY KEY, "
            "start_date_local TEXT, type TEXT, distance REAL)"
        )
        connection.executemany(
            "INSERT INTO activities VALUES (?, ?, ?, ?)",
            [
                (1001, "2026-11-01 09:00:00", "Run", 10000),
                (1002, "2026-11-01 15:00:00", "WeightTraining", 0),
                (1003, "2026-11-02 10:00:00", "Run", 0),  # excluded
                (1004, "2026-11-04 09:00:00", "Run", 15000),  # withheld
            ],
        )
    public = tmp_path / "public.json"
    public.write_text(
        json.dumps(
            [
                {
                    "start_date_local": "2026-11-01",
                    "type": "Run",
                    "distance": 10000,
                },
                {
                    "start_date_local": "2026-11-01",
                    "type": "WeightTraining",
                    "distance": 0,
                },
            ]
        ),
        encoding="utf-8",
    )
    return fit_dir, manifest, database, public


def reconcile(fixture, **overrides):
    return reconcile_snapshot(
        ["101", "102", "103", "104"],
        *fixture,
        policy=POLICY,
        now=NOW,
        **overrides,
    )


def test_count_only_audit_distinguishes_all_pipeline_stages(tmp_path):
    report = reconcile(audit_fixture(tmp_path))
    assert report["coros_indexed"] == 4
    assert report["fit_valid"] == 2
    assert report["fit_invalid"] == 1
    assert report["fit_missing"] == 1
    assert report["fit_in_manifest"] == 1
    assert report["fit_not_imported"] == 1
    assert report["db_total"] == 4
    assert report["db_public_eligible"] == 2
    assert report["db_withheld_by_policy"] == 1
    assert report["public_total"] == 2
    assert report["public_missing"] == 0
    assert report["public_unexpected"] == 0
    assert report["public_distance_mismatch_groups"] == 0
    assert "101" not in str(report)
    assert "2026-11-01" not in str(report)


def test_audit_detects_missing_strength_and_distance_corruption(tmp_path):
    fixture = audit_fixture(tmp_path)
    *_, public = fixture
    rows = json.loads(public.read_text())
    public.write_text(json.dumps(rows[:1]))
    assert reconcile(fixture)["public_missing"] == 1
    rows[0]["distance"] = 10500
    public.write_text(json.dumps(rows))
    assert reconcile(fixture)["public_distance_mismatch_groups"] == 1


def test_deep_fit_identity_audit_separates_db_missing_from_not_imported(tmp_path):
    fixture = audit_fixture(tmp_path)

    def synthetic_identity(path):
        if path.name == "101.fit":
            return 1001, True
        return 9000, True

    report = reconcile(fixture, deep=True, identity_reader=synthetic_identity)
    assert report["fit_eligible_in_db"] == 1
    assert report["fit_eligible_missing_db"] == 1
    assert report["fit_decode_failed"] == 0


@pytest.mark.parametrize("bad_ids", [["../private"], ["1", "1"], ["abc"], [None]])
def test_audit_rejects_unsafe_or_duplicate_source_ids(tmp_path, bad_ids):
    with pytest.raises(ValueError, match="invalid ID|duplicate"):
        reconcile_snapshot(
            bad_ids,
            *audit_fixture(tmp_path),
            policy=POLICY,
            now=NOW,
        )


def test_saved_audit_index_is_private_and_contains_no_location_text(tmp_path):
    from coros_sync import save_private_audit_index

    destination = tmp_path / "private" / "coros-index.json"
    save_private_audit_index(
        destination,
        [{"labelId": 123, "name": "Private running location", "date": 20261103}],
    )
    assert json.loads(destination.read_text()) == ["123"]
    assert destination.stat().st_mode & 0o777 == 0o600
    assert sorted(p.name for p in destination.parent.iterdir()) == ["coros-index.json"]
