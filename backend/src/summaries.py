import asyncio
import json
import re
import uuid
from pathlib import Path

from .providers.base import SummaryProvider
from .util import encode, now_ms, order_turns

INSTRUCTIONS = Path(__file__).with_name("summary_instructions.txt").read_text()
SCHEMA = json.loads(Path(__file__).with_name("summary_schema.json").read_text())


def eligible_turns(conversation):
    return [
        t
        for t in order_turns(conversation["turns"])
        if t["status"] == "completed" and t["orderKnown"] and t["text"].strip()
    ]


def summary_input(conversation):
    eligible = eligible_turns(conversation)
    warnings = []
    if conversation.get("incomplete"):
        warnings.append("Capture completeness is unverified; missing speech is not reconstructed.")
    if len(eligible) != len(conversation["turns"]):
        warnings.append("Empty, unfinished, interrupted or unordered turns were excluded.")
    chunks, current = [], []
    for turn in eligible:
        remaining = turn["text"]
        while remaining:
            part = remaining.encode()[:6000].decode(errors="ignore")
            piece = {"sourceTurnIds": [turn["itemId"]], "speaker": turn["speaker"], "text": part}
            # JSON escaping can expand control characters beyond their raw UTF-8 size.
            while len(encode([piece]).encode()) > 24000:
                part = part[: len(part) // 2]
                if not part:
                    raise ValueError("Summary evidence metadata exceeds the input budget")
                piece["text"] = part
            remaining = remaining[len(part) :]
            if current and len(encode(current + [piece]).encode()) > 24000:
                chunks.append(current)
                current = []
            current.append(piece)
    if current:
        chunks.append(current)
    if len(chunks) > 6:
        warnings.append("This very long session was summarized from its latest six sections only.")
    selected = chunks[-6:]
    return selected, warnings, {i for c in selected for p in c for i in p["sourceTurnIds"]}


def validate_summary(value, allowed):
    if not isinstance(value, dict) or set(value) != {"title", "titleSourceTurnIds", "points"}:
        raise ValueError("Invalid summary")
    points = value["points"]
    if not isinstance(points, list) or len(points) > 8:
        raise ValueError("Invalid summary")
    result = []
    for point in points:
        if not isinstance(point, dict) or set(point) != {"kind", "text", "sourceTurnIds"}:
            raise ValueError("Invalid summary point")
        refs, text = point["sourceTurnIds"], point["text"]
        if (
            point["kind"] not in ("topic", "fact", "decision", "open_question")
            or not isinstance(text, str)
            or not text.strip()
            or len(text) > 240
            or not isinstance(refs, list)
            or not 1 <= len(refs) <= 4
            or any(not isinstance(r, str) or r not in allowed for r in refs)
        ):
            raise ValueError("Invalid summary evidence")
        result.append({**point, "sourceTurnIds": list(dict.fromkeys(refs))})
    title, refs = value["title"], value["titleSourceTurnIds"]
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 80
        or re.search(r"[\r\n\x00-\x1f]", title)
        or not isinstance(refs, list)
        or len(refs) > 4
        or any(not isinstance(r, str) or r not in allowed for r in refs)
        or not refs
        and (result or title != "Conversation")
    ):
        raise ValueError("Invalid summary title")
    return {"title": title.strip(), "titleSourceTurnIds": list(dict.fromkeys(refs)), "points": result}


async def generate_summary(conversation, provider: SummaryProvider):
    chunks, warnings, _ = summary_input(conversation)

    async def request(evidence, references):
        return validate_summary(await provider.summarize(INSTRUCTIONS, SCHEMA, evidence), references)

    sections = []
    async with asyncio.timeout(90):
        for chunk in chunks:
            sections.append(await request(chunk, {i for p in chunk for i in p["sourceTurnIds"]}))
        result = {"title": "Conversation", "titleSourceTurnIds": [], "points": []}
        if len(sections) == 1:
            result = sections[0]
        elif sections:
            evidence = {
                "task": "Merge these section summaries and choose one title representing the whole supplied conversation; preserve evidence and unresolved questions.",
                "sections": [{**section, "points": []} for section in sections],
            }
            if len(encode(evidence).encode()) > 24000:
                raise ValueError("Section titles exceed the merge input budget")
            omitted = False
            for index in range(8):
                for original, selected in zip(sections, evidence["sections"]):
                    if index >= len(original["points"]):
                        continue
                    selected["points"].append(original["points"][index])
                    if len(encode(evidence).encode()) > 24000:
                        selected["points"].pop()
                        omitted = True
            if omitted:
                warnings.append("Some section summary points were omitted to keep the merge input compact.")
            references = {ref for section in evidence["sections"] for ref in section["titleSourceTurnIds"]}
            references.update(
                ref
                for section in evidence["sections"]
                for point in section["points"]
                for ref in point["sourceTurnIds"]
            )
            result = await request(evidence, references)
    return {
        **result,
        "warnings": warnings,
        "sourceRevision": conversation["revision"],
        "model": provider.summary_model,
        "createdAt": now_ms(),
    }


class SummaryRunner:
    def __init__(self, store, provider: SummaryProvider, interval=2):
        self.store, self.provider, self.interval = store, provider, interval
        self.task = None
        self.stopped = False
        self.lock = asyncio.Lock()

    def start(self):
        if not self.stopped and self.provider.configured and (not self.task or self.task.done()):
            self.task = asyncio.create_task(self._loop())

    async def _loop(self):
        while not self.stopped:
            await asyncio.sleep(self.interval)
            await self.tick()

    async def tick(self):
        if self.stopped or not self.provider.configured or self.lock.locked():
            return
        async with self.lock:
            try:
                await self.store.run("summary-backfill")
                token = str(uuid.uuid4())
                job = await self.store.run("summary-claim", {"claimToken": token, "now": now_ms()})
                if not job:
                    return
                try:
                    summary = await generate_summary(job, self.provider)
                    if not self.stopped:
                        await self.store.run(
                            "summary-result",
                            {
                                "id": job["id"],
                                "revision": job["revision"],
                                "claimToken": token,
                                "summary": summary,
                            },
                        )
                except Exception:
                    if not self.stopped:
                        await self.store.run(
                            "summary-failed", {"id": job["id"], "claimToken": token, "now": now_ms()}
                        )
            except Exception:
                pass  # Storage/model failures do not interrupt voice; retry on the next poll.

    async def close(self):
        self.stopped = True
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
