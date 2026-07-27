from app.services.party_label import format_party, party_extension


def test_party_extension():
    assert party_extension("4000") == "4000"
    assert party_extension("4000@cucm.example.com") == "4000"
    assert party_extension("+16026352608") == "+16026352608"
    assert party_extension("jmetcalf@hyetechnetworks.com") == "jmetcalf"
    assert party_extension(None) is None


def test_format_party():
    assert format_party("Lamp, Michael", "4000") == "(Lamp, Michael) 4000"
    assert format_party("(Lamp, Michael) 4000", "4000") == "(Lamp, Michael) 4000"
    assert format_party("Jeff Metcalf", "jmetcalf@hyetechnetworks.com") == "(Jeff Metcalf) jmetcalf"
    assert format_party("6026352608", "6026352608") == "6026352608"
    assert format_party(None, "2608") == "2608"
    assert format_party("Only Name", None) == "Only Name"
