"""Fail-closed public activity export; never use this module to store raw data.

The private policy file is deliberately outside the repository. Public JSON
contains only explicitly allowed fields, not the provider's raw metadata.
"""

import argparse
import datetime as dt
import json
import math
import os
from itertools import pairwise
from pathlib import Path

import polyline

EARTH_RADIUS_M = 6_371_000
PUBLIC_FIELDS = frozenset(
    {
        "run_id",
        "name",
        "distance",
        "moving_time",
        "type",
        "subtype",
        "start_date",
        "start_date_local",
        "location_country",
        "country_code",
        "region",
        "summary_polyline",
        "route_segments",
        "average_heartrate",
        "average_speed",
        "elevation_gain",
        "streak",
    }
)
PUBLIC_SPORTS = frozenset(
    {
        "Run",
        "Ride",
        "Walk",
        "Hike",
        "Swim",
        "Workout",
        "WeightTraining",
        "VirtualRun",
        "TrailRun",
        "cycling",
        "hiking",
        "walking",
        "swimming",
    }
)
PUBLIC_SUBTYPES = PUBLIC_SPORTS | {
    "indoor",
    "outdoor",
    "treadmill",
    "trail",
    "generic",
}


def meters_between(a, b):
    """Haversine distance in meters (coordinates are latitude, longitude)."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1, h)))


def _near_zone(point, zone):
    return (
        meters_between(point, (zone["latitude"], zone["longitude"])) <= zone["radius_m"]
    )


def _segment_near_zone(a, b, zone):
    """Conservative tangent-plane test: never bridge a protected circle."""
    lat, lon = zone["latitude"], zone["longitude"]
    if _near_zone(a, zone) or _near_zone(b, zone):
        return True
    lat_scale = EARTH_RADIUS_M * math.pi / 180
    lon_scale = lat_scale * math.cos(math.radians(lat))
    ax, ay = (a[1] - lon) * lon_scale, (a[0] - lat) * lat_scale
    bx, by = (b[1] - lon) * lon_scale, (b[0] - lat) * lat_scale
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return False
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / length_sq))
    # Additional 1% margin accounts for projection and polyline rounding.
    return math.hypot(ax + t * dx, ay + t * dy) <= zone["radius_m"] * 1.01


def _trim_endpoints(points, distance_m):
    if len(points) < 2:
        return []
    start, end = 0, len(points) - 1
    travelled = 0.0
    while start < len(points) - 1 and travelled < distance_m:
        travelled += meters_between(points[start], points[start + 1])
        start += 1
    travelled = 0.0
    while end > 0 and travelled < distance_m:
        travelled += meters_between(points[end], points[end - 1])
        end -= 1
    return points[start : end + 1] if end > start else []


def _clip_segments(points, zones):
    segments = []
    current = []
    for point in points:
        hidden = any(_near_zone(point, zone) for zone in zones)
        crosses = current and any(
            _segment_near_zone(current[-1], point, zone) for zone in zones
        )
        if hidden or crosses:
            if len(current) >= 2:
                segments.append(current)
            current = []
        if not hidden:
            current.append(point)
    if len(current) >= 2:
        segments.append(current)
    return segments


def _validated_policy(raw):
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("Private privacy policy requires version: 1")
    if raw.get("mode") not in ("aggregate", "routes"):
        raise ValueError("Privacy mode must be 'aggregate' or 'routes'")
    if raw.get("mode") == "routes":
        trim = raw.get("start_end_meters")
        if type(trim) not in (int, float) or not 300 <= trim <= 20_000:
            raise ValueError("Route privacy requires 300–20000 m endpoint trimming")
        zones = raw.get("zones")
        if not isinstance(zones, list) or not zones:
            raise ValueError("Route privacy requires at least one private zone")
        for zone in zones:
            if not isinstance(zone, dict) or set(zone) != {
                "latitude",
                "longitude",
                "radius_m",
            }:
                raise ValueError(
                    "Each private zone needs latitude, longitude, radius_m"
                )
            lat, lon, radius = (zone["latitude"], zone["longitude"], zone["radius_m"])
            if (
                any(
                    type(v) not in (int, float) or not math.isfinite(v)
                    for v in (lat, lon, radius)
                )
                or not -90 <= lat <= 90
                or not -180 <= lon <= 180
                or not 200 <= radius <= 20_000
            ):
                raise ValueError("Invalid zone coordinates or radius (200–20000 m)")
    else:
        raw = {**raw, "zones": [], "start_end_meters": 0}
    delay = raw.get("delay_hours", 72)
    if type(delay) is not int or not 0 <= delay <= 720:
        raise ValueError("delay_hours must be an integer from 0 to 720")
    return {**raw, "delay_hours": delay}


def load_policy(path=None):
    """Missing policy permits only aggregate output. Never infer sensitive zones."""
    path = path or os.getenv("RUNNING_PRIVACY_CONFIG")
    if not path:
        policy = _validated_policy({"version": 1, "mode": "aggregate"})
    else:
        policy = _validated_policy(json.loads(Path(path).read_text(encoding="utf-8")))
    # The public sync can shorten its publication hold without replacing the
    # private policy (which may contain protected route zones).
    override = os.getenv("RUNNING_PRIVACY_DELAY_HOURS")
    if override is not None:
        if not override.isascii() or not override.isdecimal():
            raise ValueError("RUNNING_PRIVACY_DELAY_HOURS must be an integer 0–720")
        policy = _validated_policy({**policy, "delay_hours": int(override)})
    return policy


def redact_route(encoded, policy):
    if policy["mode"] != "routes" or not encoded:
        return []
    try:
        points = polyline.decode(encoded)
    except (TypeError, ValueError, IndexError):
        return []
    if not points or any(
        not (-90 <= lat <= 90 and -180 <= lon <= 180)
        or not (math.isfinite(lat) and math.isfinite(lon))
        for lat, lon in points
    ):
        return []
    trimmed = _trim_endpoints(points, policy["start_end_meters"])
    return [polyline.encode(s) for s in _clip_segments(trimmed, policy["zones"])]


def _public_date(value):
    if not isinstance(value, str) or len(value) < 10:
        raise ValueError("Activity missing a valid date")
    return dt.date.fromisoformat(value[:10]).isoformat()


def export_public_activities(activities, *, policy=None, now=None):
    """Prepare safe, date-only public records; no source records are mutated."""
    policy = _validated_policy(policy) if policy is not None else load_policy()
    now = now or dt.datetime.now(dt.UTC)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    # An explicit zero delay publishes all dates up through today as soon
    # as the sync finishes. Positive delays retain a conservative one-day
    # margin because the public data is intentionally date-only.
    delay_hours = policy["delay_hours"]
    cutoff = (
        now.date()
        if delay_hours == 0
        else (now - dt.timedelta(hours=delay_hours + 24)).date()
    )
    result = []
    for activity in activities:
        day = _public_date(activity["start_date_local"])
        if dt.date.fromisoformat(day) > cutoff:
            continue
        sport = activity.get("type")
        if sport not in PUBLIC_SPORTS:
            sport = "Activity"
        subtype = activity.get("subtype")
        if subtype not in PUBLIC_SUBTYPES:
            subtype = None
        segments = redact_route(activity.get("summary_polyline"), policy)
        public = {
            "run_id": len(result) + 1,  # do not expose provider identifiers
            "name": sport,
            "distance": activity.get("distance"),
            "moving_time": activity.get("moving_time"),
            "type": sport,
            "subtype": subtype,
            "start_date": day,
            "start_date_local": day,
            "location_country": None,  # provider values may include street-level addresses
            "country_code": activity.get("country_code"),
            "region": activity.get("region"),
            "summary_polyline": max(segments, key=len, default=None),
            "route_segments": segments,
            "average_heartrate": activity.get("average_heartrate"),
            "average_speed": activity.get("average_speed"),
            "elevation_gain": activity.get("elevation_gain"),
            "streak": activity.get("streak"),
        }
        result.append(public)
    validate_public_activities(result, policy=policy)
    return result


def validate_public_activities(activities, *, policy=None):
    policy = _validated_policy(policy) if policy is not None else load_policy()
    if not isinstance(activities, list):
        raise TypeError("Public activities must be a JSON array")
    for record in activities:
        if not isinstance(record, dict) or set(record) != PUBLIC_FIELDS:
            raise ValueError("Unexpected or missing public activity fields")
        if record["location_country"] is not None:
            raise ValueError("Raw provider location must not be public")
        if record["name"] != (record["type"] or "Activity"):
            raise ValueError("Public activity name must not include source text")
        if record["type"] not in PUBLIC_SPORTS | {"Activity"} or (
            record["subtype"] is not None and record["subtype"] not in PUBLIC_SUBTYPES
        ):
            raise ValueError("Unknown sport metadata must not be public")
        if any(
            record[key] != _public_date(record[key])
            for key in ("start_date", "start_date_local")
        ):
            raise ValueError("Public timestamps must contain a date only")
        segments = record["route_segments"]
        if not isinstance(segments, list) or not all(
            isinstance(x, str) for x in segments
        ):
            raise ValueError("Invalid route segment list")
        if policy["mode"] == "aggregate" and (segments or record["summary_polyline"]):
            raise ValueError("Aggregate-only policy forbids public GPS tracks")
        if record["summary_polyline"] != max(segments, key=len, default=None):
            raise ValueError("Summary route must be an existing safe segment")
        for encoded in segments:
            points = polyline.decode(encoded)
            if (
                len(points) < 2
                or any(_near_zone(p, zone) for p in points for zone in policy["zones"])
                or any(
                    _segment_near_zone(a, b, zone)
                    for a, b in pairwise(points)
                    for zone in policy["zones"]
                )
            ):
                raise ValueError("Public route crosses a protected zone")


def write_public_json(destination, activities):
    """Atomically publish only privacy-checked records."""
    records = export_public_activities(activities)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".tmp")
    try:
        tmp.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
        tmp.replace(destination)
    finally:
        tmp.unlink(missing_ok=True)
    return len(records)


def main():
    parser = argparse.ArgumentParser(
        description="Verify or create public activity data"
    )
    parser.add_argument("--check", type=Path, metavar="PUBLIC_JSON")
    parser.add_argument("--input", type=Path, help="private source activity JSON")
    parser.add_argument("--database", type=Path, help="private running database")
    parser.add_argument("--output", type=Path, help="public export destination")
    args = parser.parse_args()
    if args.check:
        validate_public_activities(json.loads(args.check.read_text(encoding="utf-8")))
        print("Public activity export passed privacy checks")
        return
    if not args.output or bool(args.input) == bool(args.database):
        parser.error("set --output and exactly one of --input or --database")
    if args.database:
        if not args.database.is_file():
            parser.error("private database not found")
        from generator import Generator

        generator = Generator(args.database)
        try:
            source = generator.load()
        finally:
            generator.session.close()
    else:
        source = json.loads(args.input.read_text(encoding="utf-8"))
    print(
        f"Exported {write_public_json(args.output, source)} privacy-checked activities"
    )


if __name__ == "__main__":
    main()
