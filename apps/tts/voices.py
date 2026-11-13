"""Who sounds like whom. One map, used by the server and by pregen, so a character
sounds the same whether their line was written in advance or rewritten by the model.

Chosen for distinctness (accent, gender, median pitch measured on each candidate) and
checked for intelligibility by transcribing every candidate with Whisper (0% word
error on all of them). Change a voice and bump VOICE_VERSION: cached audio is keyed on
it, so nothing stale is replayed."""

VOICE_VERSION = 1

VOICES = {
    # speaker id:  (Kokoro voice, language)       who, and why this voice
    "handler":  ("af_heart",  "en-us"),  # Kestrel: warm, close, US female (~205 Hz)
    "halcyon":  ("bf_emma",   "en-gb"),  # Halcyon's procurement desk: crisp UK female (~183 Hz)
    "vanguard": ("bm_george", "en-gb"),  # Vanguard command: formal UK male (~141 Hz)
    "vex":      ("am_puck",   "en-us"),  # Vex the merchant: easy US male (~114 Hz)
    "ashen":    ("am_onyx",   "en-us"),  # Ashen Compact: the deepest voice (~84 Hz); its radio is overdriven
}

MAX_CHARS = 300  # longer than any line the game writes; refuses anything else
