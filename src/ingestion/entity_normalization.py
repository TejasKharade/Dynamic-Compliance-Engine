from __future__ import annotations

import re
import unicodedata
from typing import Any


_NAME_ALIASES = {
    "os": "operating system",
    "operatingsystem": "operating system",
    "operating_system": "operating system",
    "windows os": "operating system",
    "cpu": "processor",
    "ram": "memory",
    "system memory": "memory",
    "hardware virtualization": "virtualization",
    "virtualisation": "virtualization",
    "vt x": "virtualization",
    "amd v": "virtualization",
    "wsl": "windows subsystem for linux",
    "wsl2": "windows subsystem for linux",
    "wsl 2": "windows subsystem for linux",
    "hyper v": "hyper-v",
    "docker": "docker desktop",
    "dcu": "dell command update",
}

_BOOLEAN_TRUE = {"true", "yes", "on", "enabled", "enable", "present", "installed", "active", "1"}
_BOOLEAN_FALSE = {"false", "no", "off", "disabled", "disable", "absent", "not installed", "inactive", "0"}


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[_/\\]+", " ", text)
    text = re.sub(r"[^a-z0-9.+#-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip(" .-")


def canonicalize_name(value: Any) -> str:
    normalized = normalize_text(value)
    return _NAME_ALIASES.get(normalized, normalized)


def stable_entity_id(category: str, canonical_name: str) -> str:
    category_slug = re.sub(r"[^a-z0-9]+", "_", normalize_text(category)).strip("_") or "entity"
    name_slug = re.sub(r"[^a-z0-9]+", "_", canonicalize_name(canonical_name)).strip("_") or "unknown"
    return f"{category_slug}:{name_slug}"


def normalize_scalar(value: Any) -> str:
    normalized = normalize_text(value)
    if normalized in _BOOLEAN_TRUE:
        return "enabled"
    if normalized in _BOOLEAN_FALSE:
        return "disabled"
    memory_match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)", normalized)
    if memory_match:
        amount = float(memory_match.group(1))
        unit = memory_match.group(2)
        if unit in {"mb", "mib"}:
            amount /= 1024
        return f"{amount:g} GB"
    return str(value or "").strip()


def version_key(value: Any) -> tuple[tuple[int, Any], ...]:
    text = normalize_text(value)
    tokens = re.findall(r"\d+|[a-z]+", text)
    return tuple((0, int(token)) if token.isdigit() else (1, token) for token in tokens)


def normalize_version(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"\d+(?:\.\d+)*(?:[a-z]\d*)?", text, flags=re.IGNORECASE)
    return match.group(0) if match else normalize_scalar(text)


def compare_values(installed: Any, operator: str, required: Any) -> bool:
    op = (operator or "ANY").strip().upper()
    if op == "ANY":
        return True

    installed_scalar = normalize_scalar(installed)
    required_scalar = normalize_scalar(required)

    if installed_scalar in {"enabled", "disabled"} or required_scalar in {"enabled", "disabled"}:
        left: Any = installed_scalar
        right: Any = required_scalar
    elif re.fullmatch(r"\d+(?:\.\d+)? GB", installed_scalar) and re.fullmatch(r"\d+(?:\.\d+)? GB", required_scalar):
        left = float(installed_scalar.split()[0])
        right = float(required_scalar.split()[0])
    else:
        left = version_key(installed_scalar)
        right = version_key(required_scalar)

    return {
        "==": left == right,
        "!=": left != right,
        ">=": left >= right,
        "<=": left <= right,
        ">": left > right,
        "<": left < right,
    }.get(op, False)


def parse_constraint(text: str) -> tuple[str, str | None]:
    normalized = normalize_text(text)
    value = normalize_version(normalized)
    if re.search(r"\b(or later|or newer|or higher|at least|minimum|not less than)\b|>=", normalized):
        return ">=", value
    if re.search(r"\b(or earlier|or older|at most|maximum|no more than)\b|<=", normalized):
        return "<=", value
    if re.search(r"\b(below|less than|older than)\b|(?<![>])<", normalized):
        return "<", value
    if re.search(r"\b(above|greater than|newer than)\b|(?<![<])>", normalized):
        return ">", value
    if re.search(r"\b(exactly|equal to)\b|==", normalized):
        return "==", value
    return ("==", value) if value else ("ANY", None)


def os_identity_aliases(value: Any) -> set[str]:
    text = canonicalize_name(value)
    aliases = {text} if text else set()
    if "windows server" in text:
        aliases.update({"operating system", "windows", "windows server"})
        match = re.search(r"windows server\s+(\d{4})", text)
        if match:
            aliases.add(f"windows server {match.group(1)}")
    else:
        match = re.search(r"windows\s+(10|11)(?:\s+\w+)?(?:\s+(\d{2}h\d))?", text)
        if match:
            aliases.update({"operating system", "windows", f"windows {match.group(1)}"})
            if match.group(2):
                aliases.add(f"windows {match.group(1)} {match.group(2)}")
    return aliases


def entity_aliases(name: Any, value: Any = None, canonical_name: Any = None) -> set[str]:
    aliases = {
        canonicalize_name(name),
        canonicalize_name(canonical_name),
    }
    aliases.discard("")
    name_norm = canonicalize_name(name)
    value_norm = canonicalize_name(value)
    if name_norm == "operating system" or "windows" in value_norm:
        aliases.update(os_identity_aliases(value))
    if value_norm:
        aliases.add(value_norm)
        if name_norm:
            aliases.add(canonicalize_name(f"{name_norm} {value_norm}"))
    return aliases
