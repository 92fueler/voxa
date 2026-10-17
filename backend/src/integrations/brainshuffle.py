"""Opt-in read connector for BrainShuffle's existing API; never share its database."""

import asyncio
from uuid import UUID

import httpx
from pydantic import BaseModel, Field

from ..config import Config
from ..util import now_ms, order_turns


class StudyProblem(BaseModel):
    id: UUID
    category_id: UUID
    title: str = Field(max_length=1000)
    prompt: str = Field(max_length=100000)
    tags: list[str] = []
    companies: list[str] = []


class BrainShuffleClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient):
        # Validate even when constructed outside the application factory.
        Config(brainshuffle_url=base_url)
        self.base_url, self.client = base_url.rstrip("/"), client

    async def problem(self, problem_id: UUID) -> StudyProblem:
        if not self.base_url:
            raise RuntimeError("BrainShuffle is not configured")
        # No redirect following, environment proxy, arbitrary URL, or hidden reference-notes exposure.
        async with asyncio.timeout(3):
            async with self.client.stream(
                "GET", f"{self.base_url}/api/problems/{problem_id}", timeout=3, follow_redirects=False
            ) as response:
                response.raise_for_status()
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 256000:
                        raise ValueError("BrainShuffle problem exceeds the connector limit")
                problem = StudyProblem.model_validate_json(payload)
                if problem.id != problem_id:
                    raise ValueError("BrainShuffle returned a different problem")
                return problem


def conversation_export(conversation):
    """Versioned handoff for a future importer. No upload or inferred review grade."""
    record = conversation.get("summary")
    summary = (
        record["value"]
        if record and record["status"] == "ready" and record["sourceRevision"] == conversation["revision"]
        else None
    )
    return {
        "schemaVersion": 1,
        "source": "voxa",
        "exportedAt": now_ms(),
        "conversation": {
            "id": conversation["id"],
            "revision": conversation["revision"],
            "startedAt": conversation["startedAt"],
            "endedAt": conversation["endedAt"],
            "categoryId": conversation["categoryId"],
            "summary": summary,
            "turns": order_turns(conversation["turns"]),
            "issues": conversation["issues"],
            "captureIncomplete": bool(conversation["incomplete"]),
        },
    }
