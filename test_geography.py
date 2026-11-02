import sys
from pathlib import Path

import polyline

sys.path.insert(0, str(Path(__file__).parent / "run_page"))

from generator.geography import location_for_activity


def track(lat, lon):
    return polyline.encode([(lat, lon), (lat + 0.0001, lon + 0.0001)])


def test_gps_overrides_wrong_provider_country():
    assert location_for_activity(track(31.23, 121.47), "United States") == (
        "CN",
        "上海市",
    )


def test_chinese_province_from_gps():
    assert location_for_activity(track(30.59, 114.3), "China") == (
        "CN",
        "湖北省",
    )


def test_spain_province_without_address():
    assert location_for_activity(track(43.36, -5.92), "Spain") == (
        "ES",
        "Asturias",
    )
    assert location_for_activity(track(43.36, -5.92), None) == (
        "ES",
        "Asturias",
    )


def test_coastal_spain_region():
    assert location_for_activity(track(43.53, -5.64), None) == (
        "ES",
        "Asturias",
    )
    assert location_for_activity(track(43.01, -7.56), None) == (
        "ES",
        "Lugo",
    )
    assert location_for_activity(track(43.36, -8.41), None) == (
        "ES",
        "A Coruña",
    )


def test_world_country_outside_supported_regions():
    assert location_for_activity(track(40, -98), None) == (
        "US",
        None,
    )


def test_no_route_does_not_guess_from_unreliable_us_label():
    assert location_for_activity(None, "United States") == (None, None)
    assert location_for_activity(None, None) == (None, None)


def test_fallback_address_and_python_dict():
    assert location_for_activity(None, "Oviedo, Asturias, 西班牙") == (
        "ES",
        "Asturias",
    )
    assert location_for_activity(None, "{'country': '中国', 'province': '河南省'}") == (
        "CN",
        "河南省",
    )
