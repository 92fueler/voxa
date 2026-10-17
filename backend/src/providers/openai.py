import asyncio
import json
import math
import re
import time
from urllib.parse import urljoin, urlsplit

import httpx
from websockets.asyncio.client import connect

from ..util import encode
from .base import CallAnswer, Observation, ProviderError, VoiceCredential
from .openai_transcript import Transcript

BASE = "https://api.openai.com/v1"


class OpenAIObserver(Transcript):
    def __init__(self, api_key, call_id, ignored_items):
        super().__init__(ignored_items=ignored_items)
        self.api_key, self.call_id = api_key, call_id

    async def events(self):
        async with connect(
            f"wss://api.openai.com/v1/realtime?call_id={self.call_id}",
            additional_headers={"Authorization": f"Bearer {self.api_key}"},
            open_timeout=5,
            close_timeout=1,
            max_size=512000,
            max_queue=16,
        ) as socket:
            # Empty observation signals that attachment succeeded, without storing a vendor event.
            yield Observation([])
            async for raw in socket:
                try:
                    yield self.observation(json.loads(raw))
                except (ValueError, TypeError, KeyError):
                    yield Observation([], "observer_event_error")


class OpenAIProvider:
    name = "openai"
    wire_protocol = "openai-realtime-v1"

    def __init__(self, config, client: httpx.AsyncClient):
        self.config, self.client = config, client
        self.model = config.model
        self.summary_model = config.summary_model
        self.configured = bool(config.api_key)

    async def _post(self, path, **kwargs):
        try:
            response = await self.client.post(BASE + path, **kwargs)
        except httpx.TimeoutException:
            raise ProviderError("PROVIDER_TIMEOUT", 504) from None
        except httpx.HTTPError:
            raise ProviderError() from None
        if not response.is_success:
            raise ProviderError("PROVIDER_REJECTED")
        return response

    async def create_session(self, save, instructions):
        response = await self._post(
            "/realtime/client_secrets",
            timeout=10,
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            json={
                "expires_after": {"anchor": "created_at", "seconds": 60},
                "session": {
                    "type": "realtime",
                    "model": self.model,
                    "output_modalities": ["audio"],
                    "instructions": instructions,
                    "audio": {
                        "input": {
                            **({"transcription": {"model": "gpt-4o-mini-transcribe"}} if save else {}),
                            "turn_detection": {
                                "type": "semantic_vad",
                                "eagerness": "low",
                                "create_response": True,
                                "interrupt_response": True,
                            },
                        },
                        "output": {"voice": "marin"},
                    },
                    "tracing": None,
                },
            },
        )
        try:
            data = response.json()
            value, expires = data["value"], data["expires_at"]
            if (
                not isinstance(value, str)
                or not value.startswith("ek_")
                or type(expires) not in (int, float)
                or not math.isfinite(expires)
                or expires <= time.time()
            ):
                raise ValueError()
            return VoiceCredential(value, expires)
        except (ValueError, TypeError, KeyError):
            raise ProviderError("INVALID_CREDENTIAL") from None

    async def connect_call(self, credential, sdp):
        response = await self._post(
            "/realtime/calls",
            timeout=10,
            content=sdp,
            headers={"Authorization": f"Bearer {credential.value}", "Content-Type": "application/sdp"},
        )
        call_id = None
        try:
            location = urlsplit(urljoin("https://api.openai.com", response.headers.get("location", "")))
            if (
                location.scheme == "https"
                and location.netloc == "api.openai.com"
                and re.fullmatch(r"/v1/realtime/calls/rtc_[A-Za-z0-9_-]+", location.path)
                and not location.query
                and not location.fragment
            ):
                call_id = location.path.rsplit("/", 1)[1]
        except ValueError:
            pass
        return CallAnswer(response.text, call_id)

    def observer(self, call_id, ignored_items):
        return OpenAIObserver(self.config.api_key, call_id, ignored_items)

    async def summarize(self, instructions, schema, evidence):
        async with asyncio.timeout(30):
            response = await self._post(
                "/responses",
                timeout=30,
                headers={"Authorization": f"Bearer {self.config.api_key}"},
                json={
                    "model": self.summary_model,
                    "store": False,
                    "instructions": instructions,
                    "input": encode(evidence),
                    "reasoning": {"effort": "none"},
                    "max_output_tokens": 2000,
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": "continuity_summary",
                            "strict": True,
                            "schema": schema,
                        }
                    },
                },
            )
            try:
                data = response.json()
                if data.get("status") != "completed":
                    raise ValueError()
                text = "".join(
                    part.get("text", "")
                    for item in data.get("output", [])
                    if item.get("type") == "message"
                    for part in item.get("content", [])
                    if part.get("type") == "output_text"
                )
                return json.loads(text)
            except (ValueError, TypeError, AttributeError):
                raise ProviderError("INVALID_SUMMARY") from None
