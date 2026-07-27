from types import SimpleNamespace

from app.services.whisper_config import (
    get_transcription_settings,
    set_transcription_settings,
    whisper_runtime_options,
)


def _tenant(settings=None):
    return SimpleNamespace(settings_json=settings)


def test_default_transcription_settings():
    cfg = get_transcription_settings(_tenant())
    assert cfg == {"organization_name": "", "hotwords": []}
    assert whisper_runtime_options(_tenant()) == {"initial_prompt": None, "hotwords": None}


def test_set_and_get_transcription_settings():
    tenant = _tenant({"other": 1})
    cfg = set_transcription_settings(
        tenant,
        organization_name="  Kyrene School District ",
        hotwords=["Kyrene", "kyrene", "Bahar", "", "x" * 100],
    )
    assert cfg["organization_name"] == "Kyrene School District"
    assert cfg["hotwords"] == ["Kyrene", "Bahar"]
    assert tenant.settings_json["other"] == 1
    assert tenant.settings_json["whisper"]["organization_name"] == "Kyrene School District"
    runtime = whisper_runtime_options(tenant)
    assert runtime["initial_prompt"] == "Kyrene School District"
    assert runtime["hotwords"] == "Kyrene Bahar"


def test_partial_update_preserves_fields():
    tenant = _tenant(
        {"whisper": {"organization_name": "Acme", "hotwords": ["Alpha", "Beta"]}}
    )
    cfg = set_transcription_settings(tenant, hotwords=["Gamma"])
    assert cfg["organization_name"] == "Acme"
    assert cfg["hotwords"] == ["Gamma"]
