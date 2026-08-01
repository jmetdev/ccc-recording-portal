from app.services.holding_parties import infer_party_kind, party_value_for_kind, source_hint_from_sources


def test_infer_party_kind():
    assert infer_party_kind("4000") == "extension"
    assert infer_party_kind("4000@host") == "extension"
    assert infer_party_kind("user@hyetechnetworks.com") == "email"


def test_source_hint_from_sources():
    assert source_hint_from_sources(set()) == "unknown"
    assert source_hint_from_sources({"cucm"}) == "cucm"
    assert source_hint_from_sources({"webex"}) == "webex"
    assert source_hint_from_sources({"cucm", "webex"}) == "mixed"


def test_party_value_for_kind():
    assert party_value_for_kind("extension", "4000@cucm.local") == "4000"
    assert party_value_for_kind("email", "User@Example.COM") == "user@example.com"
