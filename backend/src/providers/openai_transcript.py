"""OpenAI wire-event normalization. No raw audio or complete vendor payloads are persisted."""

import copy

from ..util import now_ms
from .base import Observation

EVENTS = {
    "conversation.item.added",
    "conversation.item.created",
    "conversation.item.done",
    "input_audio_buffer.committed",
    "conversation.item.input_audio_transcription.completed",
    "response.output_audio_transcript.done",
    "conversation.item.input_audio_transcription.failed",
    "response.output_item.added",
    "output_audio_buffer.started",
    "input_audio_buffer.speech_started",
    "output_audio_buffer.cleared",
    "output_audio_buffer.stopped",
    "conversation.item.truncated",
    "response.done",
}


class Transcript:
    def __init__(self, now=now_ms, max_items=2000, ignored_items=()):
        self.now, self.max_items, self.ignored_items = now, max_items, ignored_items
        self.items = {}
        self.playing_response = None
        self.interrupted_responses = set()
        self.incomplete = False
        self.text_bytes = 0

    def _get(self, item_id, speaker):
        if not isinstance(item_id, str) or len(item_id) > 256:
            return None
        if item_id not in self.items:
            if len(self.items) >= self.max_items:
                self.incomplete = True
                return None
            self.items[item_id] = {
                "turn": {
                    "itemId": item_id,
                    "previousItemId": None,
                    "orderKnown": False,
                    "speaker": speaker,
                    "text": "",
                    "status": "incomplete",
                    "revision": 0,
                    "createdAt": self.now(),
                },
                "parts": {},
                "response": None,
            }
        return self.items[item_id]

    def accept(self, event):
        if not isinstance(event, dict):
            return []
        raw = event.get("item") if isinstance(event.get("item"), dict) else {}
        if event.get("item_id", raw.get("id")) in self.ignored_items or event.get("type") not in EVENTS:
            return []
        before = {k: copy.copy(v["turn"]) for k, v in self.items.items()}
        changed = set()

        def interrupt(response):
            if not isinstance(response, str) or not response:
                return
            if (
                len(self.interrupted_responses) >= self.max_items
                and response not in self.interrupted_responses
            ):
                self.incomplete = True
                return
            self.interrupted_responses.add(response)
            for key, item in self.items.items():
                if item["response"] == response:
                    item["turn"]["status"] = "interrupted"
                    changed.add(key)

        kind = event["type"]
        if kind in (
            "conversation.item.added",
            "conversation.item.created",
            "conversation.item.done",
            "input_audio_buffer.committed",
        ):
            if kind == "input_audio_buffer.committed":
                raw = {"type": "message", "role": "user", "id": event.get("item_id")}
            if raw.get("type") == "message" and raw.get("role") in ("user", "assistant"):
                item = self._get(raw.get("id"), raw["role"])
                previous = event.get("previous_item_id")
                if (
                    item
                    and "previous_item_id" in event
                    and (previous is None or isinstance(previous, str) and len(previous) <= 256)
                ):
                    item["turn"].update(
                        previousItemId=previous if previous not in self.ignored_items else None,
                        orderKnown=True,
                    )
                    changed.add(item["turn"]["itemId"])
        elif kind in (
            "conversation.item.input_audio_transcription.completed",
            "response.output_audio_transcript.done",
        ):
            item = self._get(event.get("item_id"), "assistant" if kind.startswith("response.") else "user")
            text = event.get("transcript")
            if item and isinstance(text, str):
                index = event.get("content_index", 0)
                index = index if type(index) is int else 0
                if len(text) > 32000 or index < 0 or index > 16:
                    self.incomplete = True
                else:
                    parts = {**item["parts"], index: text}
                    next_text = "\n".join(parts[k] for k in sorted(parts))
                    size = self.text_bytes - len(item["turn"]["text"].encode()) + len(next_text.encode())
                    if size > 2000000:
                        self.incomplete = True
                    else:
                        self.text_bytes, item["parts"], item["turn"]["text"] = size, parts, next_text
                        if isinstance(event.get("response_id"), str):
                            item["response"] = event["response_id"]
                        if item["turn"]["status"] != "interrupted":
                            item["turn"]["status"] = "completed"
                        if item["response"] in self.interrupted_responses:
                            item["turn"]["status"] = "interrupted"
                        changed.add(item["turn"]["itemId"])
        elif kind == "conversation.item.input_audio_transcription.failed":
            item = self._get(event.get("item_id"), "user")
            if item:
                self.incomplete = True
                changed.add(item["turn"]["itemId"])
        elif kind == "response.output_item.added":
            if raw.get("type") == "message" and raw.get("role") == "assistant":
                item = self._get(raw.get("id"), "assistant")
                if item and isinstance(event.get("response_id"), str):
                    item["response"] = event["response_id"]
                    changed.add(item["turn"]["itemId"])
        elif kind == "output_audio_buffer.started":
            if isinstance(event.get("response_id"), str):
                self.playing_response = event["response_id"]
        elif kind == "input_audio_buffer.speech_started":
            interrupt(self.playing_response)
            self.playing_response = None
            item = self._get(event.get("item_id"), "user")
            if item:
                changed.add(item["turn"]["itemId"])
        elif kind == "output_audio_buffer.cleared":
            interrupt(
                event.get("response_id")
                if isinstance(event.get("response_id"), str)
                else self.playing_response
            )
            self.playing_response = None
        elif kind == "output_audio_buffer.stopped":
            self.playing_response = None
        elif kind == "conversation.item.truncated":
            item = self.items.get(event.get("item_id"))
            if item:
                item["turn"]["status"] = "interrupted"
                changed.add(item["turn"]["itemId"])
        elif kind == "response.done":
            response = event.get("response")
            if isinstance(response, dict) and response.get("status") != "completed":
                interrupt(response.get("id"))
        updates = []
        # Preserve insertion order for deterministic batch writes, rather than set hash order.
        for key, item in self.items.items():
            if key in changed and before.get(key) != item["turn"]:
                item["turn"]["revision"] += 1
                updates.append(copy.copy(item["turn"]))
        return updates

    @property
    def issues(self):
        turns = [i["turn"] for i in self.items.values()]
        return (
            (["transcript_error"] if self.incomplete else [])
            + (["transcript_pending"] if any(t["status"] == "incomplete" for t in turns) else [])
            + (
                ["ordering_gap"]
                if any(
                    not t["orderKnown"] or t["previousItemId"] and t["previousItemId"] not in self.items
                    for t in turns
                )
                else []
            )
        )

    def finish(self):
        return self.accept({"type": "output_audio_buffer.cleared", "response_id": self.playing_response})

    def observation(self, event):
        issue = None
        if isinstance(event, dict) and event.get("type") == "error":
            error = event.get("error") or {}
            if not isinstance(error, dict) or not (
                error.get("code") == "response_cancel_not_active"
                or error.get("code") == "input_audio_buffer_commit_empty"
                and error.get("event_id") == "voxa_end_commit"
            ):
                issue = "provider_error"
        updates = self.accept(event)
        return Observation(updates, issue or ("transcript_error" if self.incomplete else None))
