import logging
from typing import Any, Dict, List, Set, Tuple
from rapidfuzz import process, fuzz, utils

logger = logging.getLogger(__name__)

DEVICE_ID_ALIASES = {
    "device_id",
    "hostname",
    "computer_name",
    "machine_name",
    "asset_tag",
    "devicename",
    "computername"
}

COMPONENT_ALIASES = {
    "BIOS": [
        "bios",
        "bios_version",
        "bios_ver"
    ],
    "Intel Chipset Driver": [
        "chipset_driver",
        "intel_chipset",
        "intel_chipset_driver"
    ],
    "Dell Command Update": [
        "dcu",
        "dell_command_update",
        "command_update"
    ],
    "OperatingSystem": [
        "os",
        "os_version",
        "windows_version"
    ]
}

class InventoryNormalizer:
    def __init__(self, match_threshold: float = 85.0):
        self.match_threshold = match_threshold
        # Precompute reverse component aliases for fast lookup
        self._reverse_component_aliases = {}
        for canonical, aliases in COMPONENT_ALIASES.items():
            for alias in aliases:
                self._reverse_component_aliases[alias.lower()] = canonical

    def _is_canonical(self, records: List[Dict[str, Any]]) -> bool:
        """
        Check if the input is already in the canonical evaluator schema:
        [
            {
                "device_id": "...",
                "components": [{"name": "...", "version": "..."}]
            }
        ]
        """
        if not records:
            return True
        first_record = records[0]
        if "device_id" in first_record and "components" in first_record:
            # Further verify components format
            comps = first_record["components"]
            if isinstance(comps, list) and (not comps or ("name" in comps[0] and "version" in comps[0])):
                return True
        return False

    def _find_device_id(self, raw_record: Dict[str, Any]) -> Tuple[str, str]:
        """Returns the (device_id_value, matched_key)"""
        # Exact match check first
        if "device_id" in raw_record:
            return str(raw_record["device_id"]), "device_id"
            
        for key in raw_record:
            if key.lower() in DEVICE_ID_ALIASES:
                return str(raw_record[key]), key
                
        return "Unknown", "none"

    def normalize(self, raw_records: List[Dict[str, Any]], global_vocabulary: Set[str]) -> List[Dict[str, Any]]:
        if self._is_canonical(raw_records):
            logger.info("Input already matches canonical schema. Bypassing normalizer.")
            return raw_records

        normalized_output = []
        global_vocab_list = list(global_vocabulary)

        for record in raw_records:
            device_id, id_source = self._find_device_id(record)
            
            canonical_components = []
            mappings_log = []

            for key, value in record.items():
                if key == id_source:
                    continue
                
                # We expect version to be extracted, the key represents the component name
                val_str = str(value).strip() if value is not None else ""
                if not val_str:
                    continue

                key_lower = key.lower()

                # 1. Exact or alias match
                if key in global_vocabulary:
                    canonical_components.append({"name": key, "version": val_str})
                    mappings_log.append({
                        "field": key,
                        "mapped_to": key,
                        "method": "exact"
                    })
                    continue
                
                if key_lower in self._reverse_component_aliases:
                    canonical_name = self._reverse_component_aliases[key_lower]
                    canonical_components.append({"name": canonical_name, "version": val_str})
                    mappings_log.append({
                        "field": key,
                        "mapped_to": canonical_name,
                        "method": "alias"
                    })
                    continue

                # 2. Fuzzy match against global vocabulary
                if global_vocab_list:
                    # extractOne returns (match_string, score, index)
                    match_result = process.extractOne(
                        key, 
                        global_vocab_list, 
                        scorer=fuzz.WRatio,
                        processor=utils.default_process
                    )
                    
                    if match_result and match_result[1] >= self.match_threshold:
                        canonical_name = match_result[0]
                        confidence = round(match_result[1], 2)
                        canonical_components.append({"name": canonical_name, "version": val_str})
                        mappings_log.append({
                            "field": key,
                            "mapped_to": canonical_name,
                            "method": "fuzzy",
                            "confidence": confidence
                        })
                        continue

                # 3. No match found, map as-is (might be unmapped/ignored by evaluator)
                canonical_components.append({"name": key, "version": val_str})
                mappings_log.append({
                    "field": key,
                    "mapped_to": key,
                    "method": "unmapped"
                })

            # Logging report for this device
            report = {
                "device_id_source": id_source,
                "mappings": mappings_log
            }
            logger.info(f"Normalization Report for {device_id}: {report}")
            print(f"Normalization Report for {device_id}: {report}")

            normalized_output.append({
                "device_id": device_id,
                "components": canonical_components
            })

        return normalized_output
