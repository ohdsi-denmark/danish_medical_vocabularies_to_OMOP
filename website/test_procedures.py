"""Terminology selection must preserve historical meanings and exact code identity."""
import tempfile
import unittest
from pathlib import Path

from procedures import TERMINOLOGY_FILES, load_terminology, terminology_details


def record(code, name, kind="pro", start="20000101", end="25000101"):
    return f"{kind}{code:<20}{start}{start}{end}{name:<120}{'':47}\n"


class ProcedureTerminologyTests(unittest.TestCase):
    def read(self, current="", operations="", diagnoses=""):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as temp:
            folder = Path(temp)
            for filename, content in zip(TERMINOLOGY_FILES, (current, operations, diagnoses)):
                (folder / filename).write_bytes(content.encode("cp1252"))
            return load_terminology(folder, "2026-11-06")

    def test_active_version_danish_characters_and_exact_code(self):
        records, hashes = self.read(record("ZZ1", "Ældre måling", end="20091231") +
                                    record("ZZ1", "Blodtryksmåling", start="20100101"))
        name, details = terminology_details("ZZ1", records, "2026-11-06")
        self.assertEqual(name, "Blodtryksmåling")
        self.assertEqual(details["Other recorded labels"], "Ældre måling")
        self.assertEqual(details["Terminology status"], "Active")
        self.assertEqual(len(hashes), 3)
        self.assertEqual(terminology_details("zz1", records, "2026-11-06")[0], "")

    def test_legacy_leading_zeroes_and_ambiguous_codes(self):
        records, _ = self.read(operations=record("00123", "Operation", "opr", end="19951231"),
                               diagnoses=record("00123", "Diagnosis", "dia", end="19931231"))
        name, details = terminology_details("00123", records, "2026-11-06")
        self.assertEqual(name, "")
        self.assertTrue(details["Terminology status"].startswith("Ambiguous"))
        self.assertIn("Operation", details["Terminology matches"])
        self.assertEqual(terminology_details("123", records, "2026-11-06")[0], "")
        records, _ = self.read(operations=record("00123", "Old operation", "opr", end="19951231"))
        self.assertEqual(terminology_details("00123", records, "2026-11-06")[0], "Old operation")

    def test_classification_changes_and_historical_parent(self):
        records, _ = self.read(record("BKZ", "Old treatment", end="20040331") +
                               record("BKZ", "Supplementary code", "til", start="20040401") +
                               record("KTN", "Historical parent", "opr", end="20011231") +
                               record("KTN", "Different current parent", "opr", start="20020101") +
                               record("KTNB0H", "Historical child", "opr", end="20011231"))
        name, details = terminology_details("BKZ", records, "2026-11-06")
        self.assertEqual(name, "Supplementary code")
        self.assertEqual(details["Previous classifications"], "Treatment / procedure")
        _, details = terminology_details("KTNB0H", records, "2026-11-06")
        self.assertEqual(details["Parent label"], "Historical parent")

    def test_invalid_width_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "record width"):
            self.read("truncated\n")


if __name__ == "__main__":
    unittest.main()
