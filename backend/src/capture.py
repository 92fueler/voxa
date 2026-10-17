"""Provider-independent capture lifecycle, bounded saving and late-transcript drain."""

import asyncio
import secrets
import uuid
from dataclasses import dataclass

from .providers.base import TranscriptObserver, VoiceCredential, VoiceProvider
from .save_queue import SaveQueue
from .util import now_ms


@dataclass
class Capture:
    id: str
    save: bool
    source_ids: list[str]
    credential: VoiceCredential | None
    queue: SaveQueue
    ignored_items: list[str]
    observer: TranscriptObserver | None = None
    call_id: str | None = None
    attached: bool = False
    ending: bool = False
    closed: bool = False
    used: bool = False
    expiry: asyncio.Task | None = None
    listener: asyncio.Task | None = None
    drain: asyncio.Task | None = None


class Captures:
    def __init__(
        self,
        store,
        provider: VoiceProvider,
        max_seconds,
        drain_seconds=12,
        cleanup_seconds=60,
        reconnect_seconds=1,
    ):
        self.store, self.provider, self.max_seconds = store, provider, max_seconds
        self.drain_seconds, self.cleanup_seconds = drain_seconds, cleanup_seconds
        self.reconnect_seconds = reconnect_seconds
        self.entries: dict[str, Capture] = {}

    async def _after(self, seconds, action):
        await asyncio.sleep(seconds)
        action()

    def register(self, credential, source_ids=(), context_item_id=None, save=True):
        if len(self.entries) >= 32:
            raise ValueError("Too many pending conversations")
        handle, item_id = secrets.token_hex(32), str(uuid.uuid4())
        capture = Capture(
            item_id,
            save,
            list(source_ids),
            credential,
            SaveQueue(self.store.run),
            [context_item_id] if context_item_id else [],
        )
        capture.expiry = asyncio.create_task(
            self._after(min(90, max(0, credential.expires_at - now_ms() / 1000)), lambda: self.finish(handle))
        )
        self.entries[handle] = capture
        if save:
            capture.queue.enqueue("create", "create", {"id": item_id, "startedAt": now_ms()})
        return {"handle": handle, "conversationId": item_id}

    def take_credential(self, handle):
        c = self.entries.get(handle)
        if not c or c.used or c.ending or not c.credential:
            return None
        if c.credential.expires_at <= now_ms() / 1000:
            self.finish(handle)
            return None
        c.used = True
        credential, c.credential = c.credential, None
        if c.expiry:
            c.expiry.cancel()
        c.expiry = asyncio.create_task(self._after(self.max_seconds + 20, lambda: self.finish(handle)))
        return credential

    def attach(self, handle, call_id):
        c = self.entries.get(handle)
        if not c or c.ending or not c.save:
            return
        if not call_id:
            self._gap(c, "observer_unavailable")
            return
        c.call_id = call_id
        try:
            c.observer = self.provider.observer(call_id, c.ignored_items)
            c.listener = asyncio.create_task(self._listen(c))
        except Exception:
            self._gap(c, "observer_unavailable")

    async def _listen(self, c):
        for attempt in range(3):
            if c.closed:
                return
            try:
                async for observation in c.observer.events():
                    if c.closed:
                        return
                    c.attached = True
                    if observation.issue:
                        self._gap(c, observation.issue)
                    self._turns(c, observation.turns)
            except Exception:
                if not c.closed:
                    self._gap(c, "observer_disconnected")
            else:
                if not c.ending and not c.closed:
                    self._gap(c, "observer_disconnected")
            if c.ending or c.closed:
                return
            if attempt < 2:
                await asyncio.sleep(self.reconnect_seconds * (attempt + 1))

    def _turns(self, c, turns):
        for turn in turns:
            c.queue.enqueue(
                "turn:" + turn["itemId"],
                "turn",
                {"id": c.id, "providerSessionId": c.call_id or "", "turn": turn},
            )

    def _gap(self, c, reason):
        c.queue.mark_gap()
        c.queue.enqueue("issue:" + reason, "incomplete", {"id": c.id, "reason": reason})

    def status(self, handle):
        c = self.entries.get(handle)
        if not c:
            return None
        state = c.queue.state
        if state != "incomplete":
            if c.ending and not c.closed:
                state = "finalizing"
            elif state == "saved" and not c.attached and not c.closed:
                state = "saving"
        return {"conversationId": c.id, "state": state, "pending": c.queue.pending, "ended": c.closed}

    def uses_source(self, item_id):
        return any(item_id in c.source_ids and not c.closed for c in self.entries.values())

    def is_active(self, item_id):
        return any(c.id == item_id and not c.closed for c in self.entries.values())

    def finish(self, handle):
        c = self.entries.get(handle)
        if not c or c.ending:
            return
        c.ending, c.credential = True, None
        if c.expiry:
            c.expiry.cancel()
        if not c.save:
            self.forget(c.id)
            return
        if c.observer:
            self._turns(c, c.observer.finish())
        c.drain = asyncio.create_task(self._finalize(handle, c))

    async def _finalize(self, handle, c, delay=None):
        await asyncio.sleep(self.drain_seconds if delay is None else delay)
        if c.closed:
            return
        c.closed = True
        if c.observer:
            for issue in c.observer.issues:
                self._gap(c, issue)
        if not c.attached:
            self._gap(c, "observer_unavailable")
        if c.listener:
            c.listener.cancel()
        c.queue.enqueue(
            "finish",
            "finish",
            {
                "id": c.id,
                "endedAt": now_ms(),
                "incomplete": bool(c.observer and c.observer.incomplete) or c.queue.gap,
            },
        )
        c.expiry = asyncio.create_task(self._after(self.cleanup_seconds, lambda: self.forget(c.id)))

    def forget(self, item_id):
        for handle, c in list(self.entries.items()):
            if c.id != item_id:
                continue
            c.closed = c.ending = True
            for task in (c.expiry, c.drain, c.listener):
                if task and task is not asyncio.current_task():
                    task.cancel()
            c.queue.dispose()
            del self.entries[handle]

    async def close(self):
        # Graceful shutdown persists already-received turns; a hard crash still cannot recover unseen speech.
        captures = list(self.entries.items())
        try:
            for handle, c in captures:
                if not c.closed and c.save:
                    if not c.ending and c.observer:
                        self._turns(c, c.observer.finish())
                    if c.drain:
                        c.drain.cancel()
                    await self._finalize(handle, c, delay=0)
            await asyncio.gather(*(c.queue.flush() for _, c in captures))
        finally:
            tasks = [
                task for _, c in captures for task in (c.expiry, c.drain, c.listener, c.queue.worker) if task
            ]
            for _, c in captures:
                self.forget(c.id)
            await asyncio.gather(*tasks, return_exceptions=True)
