"""Offline location classification for exported activities.

The original ``location_country`` column contains provider labels and free-form
reverse-geocoded addresses, not a reliable country identifier. Classify the
start of a GPS track against the repository's country/province boundaries
before trusting that column. No network geocoding is required during sync.
"""

import ast
import json
from functools import lru_cache
from pathlib import Path

import polyline

ROOT = Path(__file__).resolve().parents[2]


def _boundaries(path):
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    result = []
    for feature in features:
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        points = [p for polygon in polygons for ring in polygon for p in ring]
        if not points:
            continue
        bounds = (
            min(p[0] for p in points),
            min(p[1] for p in points),
            max(p[0] for p in points),
            max(p[1] for p in points),
        )
        result.append((feature["properties"], bounds, polygons))
    return result


@lru_cache(maxsize=2)
def _get_boundaries(level):
    paths = {
        "country": ROOT / "src/static/world.zh.json",
        "china": ROOT / "src/assets/china-provinces.json",
        "spain": ROOT / "run_page/generator/data/spain-provinces.json",
    }
    path = paths[level]
    return _boundaries(path)


def _inside_ring(lon, lat, ring):
    inside = False
    previous = ring[-1]
    for point in ring:
        x1, y1 = previous
        x2, y2 = point
        if (y1 > lat) != (y2 > lat) and lon < ((x2 - x1) * (lat - y1) / (y2 - y1) + x1):
            inside = not inside
        previous = point
    return inside


def _find_feature(level, lon, lat):
    for properties, (left, bottom, right, top), polygons in _get_boundaries(level):
        if not (left <= lon <= right and bottom <= lat <= top):
            continue
        for polygon in polygons:
            if _inside_ring(lon, lat, polygon[0]) and not any(
                _inside_ring(lon, lat, hole) for hole in polygon[1:]
            ):
                return properties
    return None


COUNTRY_ALIASES = {
    "China": "CN",
    "中国": "CN",
    "中华人民共和国": "CN",
    "Spain": "ES",
    "España": "ES",
    "西班牙": "ES",
    "Japan": "JP",
    "日本": "JP",
    "Thailand": "TH",
    "泰国": "TH",
}


def _source_location(raw):
    if not isinstance(raw, str) or not raw or raw == "None":
        return "", ""
    if raw.startswith("{"):
        try:
            data = ast.literal_eval(raw)
            if isinstance(data, dict):
                return str(data.get("country") or ""), str(data.get("province") or "")
        except (ValueError, SyntaxError):
            pass
    return raw.split(",")[-1].strip(), raw


def _region_for_address(country, address):
    if country == "CN":
        for properties, _, _ in _get_boundaries("china"):
            if properties["name"] in address:
                return properties["name"]
    if country == "ES" and any(
        name in address for name in ("Asturias", "阿斯圖里亞斯", "阿斯图里亚斯")
    ):
        return "Asturias"
    return None


def _coordinate_for_route(encoded):
    if not encoded:
        return None
    try:
        coords = polyline.decode(encoded)
        if coords:
            lat, lon = coords[0]
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return lat, lon
    except (TypeError, ValueError, IndexError):
        pass
    return None


def location_for_activity(encoded_route, raw_location):
    """Return (ISO 3166-1 alpha-2 country, region), or None if unknown."""
    country_label, address = _source_location(raw_location)
    fallback_country = COUNTRY_ALIASES.get(country_label)
    point = _coordinate_for_route(encoded_route)
    if point:
        lat, lon = point
        # More detailed boundaries are both more accurate near the coast and
        # able to identify the region of tracks with generic provider labels.
        china = _find_feature("china", lon, lat)
        if china:
            return "CN", china["name"]
        spain = _find_feature("spain", lon, lat)
        if spain:
            # geoBoundaries' source uses "Coruna"; keep the Spanish proper name.
            return "ES", "A Coruña" if spain["name"] == "Coruna" else spain["name"]
        feature = _find_feature("country", lon, lat)
        if feature:
            country = feature["iso_a2"]
            return country, _region_for_address(country, address)

    country = fallback_country
    return country, _region_for_address(country, address)
