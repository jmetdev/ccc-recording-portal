from app.services.recorded_extensions import near_addr_matches_extension, normalize_extension
from app.services.suite_entitlements import recording_seats_from_entitlements


def test_normalize_extension_strips_sip_domain():
    assert normalize_extension("1001@example.com") == "1001"
    assert normalize_extension("1001") == "1001"
    assert normalize_extension(None) is None
    assert normalize_extension("") is None


def test_near_addr_matches_extension():
    assert near_addr_matches_extension("1001", "1001")
    assert near_addr_matches_extension("1001@cucm.example.com", "1001")
    assert near_addr_matches_extension("1001@cucm.example.com", "1001@ignored")
    assert not near_addr_matches_extension("1002", "1001")
    assert not near_addr_matches_extension("10010", "1001")
    assert not near_addr_matches_extension("1001x@host", "1001")
    assert not near_addr_matches_extension(None, "1001")
    assert not near_addr_matches_extension("1001", "")


def test_recording_seats_from_entitlements():
    assert recording_seats_from_entitlements([]) is None
    assert recording_seats_from_entitlements([{"app": "fax", "limits_json": {"recording_seats": 5}}]) is None
    assert (
        recording_seats_from_entitlements(
            [{"app": "recording", "limits_json": {"recording_seats": 25}}]
        )
        == 25
    )
    assert (
        recording_seats_from_entitlements([{"app": "recording", "limits_json": None}]) is None
    )
