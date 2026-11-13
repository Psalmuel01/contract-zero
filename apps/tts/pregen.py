"""Pre-generate the game's AUTHORED radio lines into apps/web/public/vo/{id}.mp3, so
they play instantly and cost nothing at runtime. Mission lines (written or rewritten
per mission) are voiced by the API on demand instead.

  python pregen.py            # only what changed (text, speaker or voice version)
  python pregen.py --force

Reads the lines from apps/web/src/engine/story/presence.ts, the same list the game
uses, so a line can't be voiced from a stale copy."""
import hashlib
import json
import os
import re
import sys

from engine import Engine
from voices import VOICE_VERSION, VOICES

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCE = os.path.join(ROOT, "apps/web/src/engine/story/presence.ts")
OUT = os.path.join(ROOT, "apps/web/public/vo")
MANIFEST = os.path.join(OUT, "manifest.json")

LINE = re.compile(r"""\{\s*id:\s*'([^']+)',\s*speaker:\s*'([^']+)',\s*trigger:\s*'[^']+',\s*text:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\}""")


def authored():
    src = open(SOURCE, encoding="utf-8").read()
    lines = [(m[1], m[2], (m[3] if m[3] is not None else m[4]).replace("\\'", "'").replace('\\"', '"')) for m in LINE.finditer(src)]
    # The reinforcement call-out says the real number of guards (presence.ts).
    for n in range(1, 13):
        lines.append((f"reinforce-{n}", "handler", "One more guard coming in. Finish up." if n == 1 else f"{n} more guards coming in. Finish up."))
    return lines


def main():
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) and not force else {}
    lines = authored()
    if len(lines) < 20:
        raise SystemExit(f"only {len(lines)} lines parsed from presence.ts: the format changed?")
    engine = None
    for id_, speaker, text in lines:
        if speaker not in VOICES:
            print(f"skip {id_}: no voice for {speaker}")
            continue
        key = hashlib.sha256(f"{VOICE_VERSION}|{speaker}|{text}".encode()).hexdigest()[:16]
        path = os.path.join(OUT, f"{id_}.mp3")
        if manifest.get(id_, {}).get("key") == key and os.path.exists(path):
            continue
        engine = engine or Engine()
        open(path, "wb").write(engine.mp3(speaker, text))
        manifest[id_] = {"speaker": speaker, "voice": VOICES[speaker][0], "key": key, "text": text}
        print(f"voiced {id_} ({speaker})")
    for stale in set(manifest) - {l[0] for l in lines}:
        manifest.pop(stale)
        if os.path.exists(os.path.join(OUT, f"{stale}.mp3")):
            os.remove(os.path.join(OUT, f"{stale}.mp3"))
    json.dump(dict(sorted(manifest.items())), open(MANIFEST, "w"), indent=1)
    print(f"{len(manifest)} lines in {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
