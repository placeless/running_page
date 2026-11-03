"""Read-only COROS → FIT → import-manifest → SQLite → public counts audit.

Only aggregate counts are returned/logged. Never print raw provider IDs,
location fields, FIT contents, activity names or private archive paths.
"""

import argparse
import datetime as dt
import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path

from privacy_export import PUBLIC_SPORTS, load_policy, publication_cutoff


def _provider_ids(index):
    if not isinstance(index, list):
        raise TypeError("COROS index must be an array")
    ids = []
    for item in index:
        value = item.get("labelId") if isinstance(item, dict) else item
        ident = str(value)
        # Reject path components and any filename that cannot be a COROS ID.
        if not ident.isascii() or not ident.isdecimal():
            raise ValueError("COROS index contains an invalid ID")
        ids.append(ident)
    if len(ids) != len(set(ids)):
        raise ValueError("COROS index contains duplicate IDs")
    return ids


def _read_database(database):
    uri = Path(database).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        return connection.execute(
            "SELECT run_id, start_date_local, type, distance FROM activities"
        ).fetchall()


def _fit_valid(file):
    if not file.is_file() or file.is_symlink():
        return False
    with file.open("rb") as stream:
        return stream.read(12)[8:12] == b".FIT"


def _fit_identity(file):
    """Optional deep audit of the importer timestamp-derived run_id."""
    from garmin_fit_sdk import Decoder, Stream
    from garmin_fit_sdk.util import FIT_EPOCH_S

    messages, errors = Decoder(Stream.from_file(str(file))).read(
        convert_datetimes_to_dates=False
    )
    if errors:
        raise ValueError("Invalid FIT messages")
    sessions = messages.get("session_mesgs") or []
    if not sessions:
        raise ValueError("FIT has no session")
    session = sessions[0]
    stamp = int((session["start_time"] + FIT_EPOCH_S) * 1000)
    duration = session.get("total_moving_time", session.get("total_timer_time", 0))
    valid_activity = (session.get("total_distance") or 0) > 0.1 or (
        str(session.get("sport", "")).lower() == "training" and duration > 0
    )
    return stamp, valid_activity


def reconcile_snapshot(
    index,
    fit_dir,
    imported_manifest,
    database,
    public_export,
    *,
    policy,
    now,
    deep=False,
    identity_reader=_fit_identity,
):
    """Cross-check the known COROS index without modifying the private archive.

    Day/sport/distance aggregation is provable even though public run_ids are
    deliberately re-numbered. It cannot establish provider completeness
    outside the supplied index. Deep mode verifies each eligible FIT start
    timestamp against the SQLite primary key.
    """
    ids = _provider_ids(index)
    manifest_file = Path(imported_manifest)
    imported = (
        json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest_file.is_file()
        else []
    )
    if not isinstance(imported, list) or not all(isinstance(x, str) for x in imported):
        raise ValueError("Invalid private import manifest")
    imported = set(imported)
    db_rows = _read_database(database)
    public = json.loads(Path(public_export).read_text(encoding="utf-8"))
    if not isinstance(public, list):
        raise TypeError("Public export is not an array")
    fit_dir = Path(fit_dir)
    report = {
        "coros_indexed": len(ids),
        "fit_missing": 0,
        "fit_invalid": 0,
        "fit_valid": 0,
        "fit_not_imported": 0,
        "fit_in_manifest": 0,
        "db_total": len(db_rows),
        "db_public_eligible": 0,
        "db_withheld_by_policy": 0,
        "public_total": len(public),
        "public_missing": 0,
        "public_unexpected": 0,
        "public_distance_mismatch_groups": 0,
    }
    if deep:
        report.update(
            fit_decode_failed=0,
            fit_eligible_missing_db=0,
            fit_excluded_by_import_rules=0,
            fit_eligible_in_db=0,
        )
    db_ids = {int(run_id) for run_id, *_ in db_rows}
    for ident in ids:
        file = fit_dir / (ident + ".fit")
        if not file.is_file() or file.is_symlink():
            report["fit_missing"] += 1
            continue
        if not _fit_valid(file):
            report["fit_invalid"] += 1
            continue
        report["fit_valid"] += 1
        if file.name in imported:
            report["fit_in_manifest"] += 1
        else:
            report["fit_not_imported"] += 1
        if deep:
            try:
                run_id, is_eligible = identity_reader(file)
            except (ValueError, KeyError, TypeError, OSError, IndexError):
                report["fit_decode_failed"] += 1
                continue
            if not is_eligible:
                report["fit_excluded_by_import_rules"] += 1
            elif run_id in db_ids:
                report["fit_eligible_in_db"] += 1
            else:
                report["fit_eligible_missing_db"] += 1

    cutoff = publication_cutoff(policy, now)
    expected = Counter()
    expected_distance = Counter()
    for _, raw_date, sport, distance in db_rows:
        if not ((distance or 0) > 0.1 or sport in ("Workout", "WeightTraining")):
            continue
        day = dt.date.fromisoformat(raw_date[:10])
        if day > cutoff:
            report["db_withheld_by_policy"] += 1
            continue
        report["db_public_eligible"] += 1
        key = (day.isoformat(), sport if sport in PUBLIC_SPORTS else "Activity")
        expected[key] += 1
        expected_distance[key] += distance or 0
    observed = Counter()
    observed_distance = Counter()
    for activity in public:
        key = (activity["start_date_local"], activity["type"])
        observed[key] += 1
        observed_distance[key] += activity["distance"] or 0
    report["public_missing"] = sum((expected - observed).values())
    report["public_unexpected"] = sum((observed - expected).values())
    report["public_distance_mismatch_groups"] = sum(
        abs(expected_distance[key] - observed_distance[key]) > 0.01
        for key in expected.keys() | observed.keys()
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--fit-dir", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--public", required=True, type=Path)
    parser.add_argument("--policy", type=Path, help="private privacy policy JSON")
    parser.add_argument("--deep-fit", action="store_true", help="decode FIT timestamps")
    args = parser.parse_args()
    report = reconcile_snapshot(
        json.loads(args.index.read_text(encoding="utf-8")),
        args.fit_dir,
        args.manifest,
        args.database,
        args.public,
        policy=load_policy(args.policy),
        now=dt.datetime.now(dt.UTC),
        deep=args.deep_fit,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    if report["fit_missing"] or report["fit_invalid"] or report["fit_not_imported"]:
        print(
            "::warning::COROS FIT inventory has missing, invalid, or "
            "unimported files; inspect the aggregate reconciliation counts"
        )
    if (
        report["public_missing"]
        or report["public_unexpected"]
        or report["public_distance_mismatch_groups"]
    ):
        raise SystemExit("Public export does not match the eligible SQLite totals")


if __name__ == "__main__":
    main()
