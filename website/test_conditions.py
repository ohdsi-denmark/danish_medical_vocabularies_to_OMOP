"""Diagnosis identity, disclosure controls, and the public reference boundary."""
import csv
import tempfile
import unittest
from pathlib import Path

from conditions import danish_codes, diagnosis_code, diagnosis_counts

ROOT = Path(__file__).resolve().parent.parent


class ConditionTests(unittest.TestCase):
    def test_danish_sks_and_dotted_identifiers(self):
        self.assertEqual(diagnosis_code("DC209M"), "C20.9M")
        self.assertEqual(diagnosis_code("DR349"), "R34.9")
        self.assertEqual(diagnosis_code("DZ016"), "Z01.6")
        self.assertEqual(diagnosis_code("DC20"), "C20")
        for value in ("00123", "C20.9M", "dc209m", "AAF20"):
            self.assertEqual(diagnosis_code(value), value)

    def test_published_reference_is_restricted_to_evidenced_danish_codes(self):
        allowed = danish_codes(ROOT)
        with (ROOT / "Conditions/reference_data/icd10_standard_for_danish_codes.csv").open(encoding="utf-8") as file:
            rows = list(csv.DictReader(file))
        self.assertTrue(rows)
        self.assertTrue(all(row["source_code"] in allowed for row in rows))
        self.assertEqual(len(rows), 9882)
        with (ROOT / "Conditions/stcm_dacICD10.csv").open(encoding="utf-8-sig") as file:
            target_ids = {row["target_concept_id"] for row in csv.DictReader(file)}
        with (ROOT / "Conditions/reference_data/custom_target_labels.csv").open(encoding="utf-8") as file:
            self.assertTrue(all(row["target_concept_id"] in target_ids for row in csv.DictReader(file)))

    def test_repeated_suppressed_report_rows_are_preserved(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "website") as temp:
            root = Path(temp)
            (root / "Procedures").mkdir()
            (root / "Procedures/diagnosis_source_code_counts.csv").write_text("Code;Frequency\n999;<5\n999;<5\n", encoding="utf-8")
            self.assertEqual(diagnosis_counts(root), {"999": ["<5", "<5"]})


if __name__ == "__main__":
    unittest.main()
