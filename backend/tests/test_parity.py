import json
from pathlib import Path

import pytest

from src.providers.openai_transcript import Transcript

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "transcript-oracle.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[f"legacy-sequence-{i}" for i in range(len(CASES))])
def test_transcript_matches_legacy_oracle(case):
    transcript = Transcript(now=lambda: 1, ignored_items=["context"])
    for step in case["steps"]:
        updates = transcript.accept(step["event"])
        assert sorted(updates, key=lambda t: t["itemId"]) == sorted(
            step["updates"], key=lambda t: t["itemId"]
        )
        assert transcript.issues == step["issues"]
    assert sorted(transcript.finish(), key=lambda t: t["itemId"]) == sorted(
        case["finish"], key=lambda t: t["itemId"]
    )
    assert transcript.issues == case["issues"]


async def test_repository_matches_legacy_oracle(store, monkeypatch):
    fixture = json.loads((FIXTURES / "store-oracle.json").read_text())
    monkeypatch.setattr("src.store.now_ms", lambda: fixture["now"])
    for step in fixture["operations"]:
        assert await store.run(step["operation"], step.get("payload")) == step["value"], step["operation"]
