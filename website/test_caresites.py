"""Care-site provenance and unresolved targets are data, not approval inferred from a target ID."""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from caresites import build_caresites, care_bucket, location_rows


class CareSiteTests(unittest.TestCase):
    def fixture(self, root, unknown_origin=False):
        folder = root / "Caresites"
        folder.mkdir()
        def write(name, headers, rows, delimiter=","):
            with (folder / name).open("w", encoding="utf-8", newline="") as file:
                writer = csv.writer(file, delimiter=delimiter)
                writer.writerow(headers)
                writer.writerows(rows)
        write("SOR_to_OMOP_visit_mappings_complete.csv", ["SorId", "EntityName", "Predicted_Category", "Justification", "error", "Verified_By"], [
            ["101", "Håndklinik", "Clinic", "", "", "Tomer"],
            ["102", "Apotek", "Pharmacy", "", "", "Keyword"],
            ["103", "Unknown", "Unrecognized category", "Recorded model explanation", "", "Other" if unknown_origin else ""],
        ])
        write("SOR_to_visit_concept.csv", ["SorId", "code"], [["101", "100"], ["102", "100"]])
        write("care_site_to_visit_type_map.csv", ["Classification Code", "Classification Name", "visit_concept_id"],
              [["100", "Clinic", "9202"], ["100", "Pharmacy", "9201"]], "\t")
        write("sor_to_nucc_USAGI.csv", ["sourceCode", "sourceName", "ADD_INFO:to_translate", "conceptId", "conceptName", "mappingStatus", "statusSetBy", "createdBy"], [
            ["1234001", "Ward", "Afdeling", "100", "Clinic", "APPROVED", "Tomer", "<auto>"],
            ["3.80E+09", "Automatic suggestion", "Automatisk forslag", "100", "Clinic", "UNCHECKED", "", "<auto>"],
        ])
        write("shak_location_map.csv", ["code", "name", "speciale4", "speciale4", ""], [["1234", "Hospital", "A", "B", "preserved"]])

    def test_three_sor_origins_and_legacy_approval(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            root = Path(temp)
            self.fixture(root)
            out = root / "out"
            manifest = build_caresites(root, "snapshot", out)
            self.assertEqual(manifest["stats"]["sor"]["methods"], {"Manual": 1, "Rule-based": 1, "LLM": 1})
            self.assertEqual(manifest["stats"]["sor"]["unresolved"], 1)
            export = json.loads((out / manifest["unmappedFile"]).read_text(encoding="utf-8"))
            self.assertEqual([row["code"] for row in export["unmapped"]], ["103"])
            def source(key):
                return json.loads((out / manifest["assetRoot"] / "details" / f"{care_bucket(key):03x}.json").read_text(encoding="utf-8"))["sources"][key]
            self.assertEqual(source("sor-103")["justification"], "Recorded model explanation")
            self.assertEqual(source("legacy-1234001")["method"], "Manual")
            self.assertEqual(source("legacy-1234001")["verifiedBy"], "Tomer")
            automatic = source("legacy-3.80E+09")
            self.assertEqual(automatic["method"], "Usagi (origin unspecified)")
            self.assertTrue(automatic["flags"] & (1 << 7))
            self.assertEqual(source("legacy-1234001")["locations"][0]["Specialty 4 (column 3)"], "A")
            self.assertEqual(source("legacy-1234001")["locations"][0]["Specialty 4 (column 4)"], "B")
            self.assertEqual(source("legacy-1234001")["locations"][0]["Unnamed field (column 5)"], "preserved")
            self.assertIn("prefix match", source("legacy-1234001")["locationMatch"])
            self.assertEqual(len(manifest["crosswalk"]["100"]), 2)
            self.assertTrue(source("sor-101")["flags"] & (1 << 2))
            self.assertTrue(source("sor-101")["flags"] & (1 << 3))

    def test_unknown_origin_blocks_silent_reclassification(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            root = Path(temp)
            self.fixture(root, unknown_origin=True)
            with self.assertRaisesRegex(ValueError, "Unknown SOR mapping origin"):
                build_caresites(root, "snapshot", root / "out")


if __name__ == "__main__":
    unittest.main()
