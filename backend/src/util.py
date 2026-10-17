import json
import time


def now_ms():
    return int(time.time() * 1000)


def encode(value, **kwargs):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), **kwargs)


def order_turns(turns):
    """Follow predecessor links iteratively, including long or malformed archives."""
    by_id = {t["itemId"]: t for t in turns}
    result, visited = [], set()
    for start in sorted(turns, key=lambda t: (t["createdAt"], t["itemId"])):
        path, positions, uncertain = [], {}, set()
        current = start
        while current and current["itemId"] not in visited:
            item_id = current["itemId"]
            if item_id in positions:
                uncertain.update(t["itemId"] for t in path)
                break
            positions[item_id] = len(path)
            path.append(current)
            previous_id = current.get("previousItemId")
            if previous_id and previous_id not in by_id:
                uncertain.add(item_id)
            current = by_id.get(previous_id)
        for turn in reversed(path):
            item_id = turn["itemId"]
            visited.add(item_id)
            result.append({**turn, "orderKnown": False} if item_id in uncertain else turn)
    return result
