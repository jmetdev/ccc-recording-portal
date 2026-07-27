from app.uds import format_uds_label, _parse_users


SAMPLE_MULTI = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<users returnedCount="2" totalCount="2">
  <user>
    <displayName>Joshani, Bahar</displayName>
    <phoneNumber>480-541-1000</phoneNumber>
  </user>
  <user>
    <description>Front Desk</description>
    <displayName>Kbeir, Carmen</displayName>
    <phoneNumber>480-541-1001</phoneNumber>
  </user>
</users>
"""

SAMPLE_DESCRIPTION = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<users returnedCount="1" totalCount="1">
  <user>
    <description>Milenio Principal</description>
    <displayName>Lamp, Michael</displayName>
    <phoneNumber>480-541-4000</phoneNumber>
  </user>
</users>
"""


def test_format_uds_label():
    assert format_uds_label("Lamp, Michael", "4000") == "(Lamp, Michael) 4000"
    assert format_uds_label("(Already)", "4000") == "(Already) 4000"
    assert format_uds_label("Only name", "") == "(Only name)"


def test_parse_users_prefers_description_and_formats_extension():
    assert _parse_users(SAMPLE_DESCRIPTION, "4000") == "(Milenio Principal) 4000"


def test_parse_users_picks_best_phone_match():
    # Looking up 1001 should prefer the user whose phone ends with 1001,
    # and use description when present.
    assert _parse_users(SAMPLE_MULTI, "1001") == "(Front Desk) 1001"
    assert _parse_users(SAMPLE_MULTI, "1000") == "(Joshani, Bahar) 1000"


def test_parse_users_empty():
    xml = """<?xml version="1.0"?><users returnedCount="0" totalCount="0"/>"""
    assert _parse_users(xml, "4000") is None
