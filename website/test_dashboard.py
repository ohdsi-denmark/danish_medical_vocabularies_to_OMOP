"""Coverage must not double-count targets, references, source tables or mapping layers."""
import json
import tempfile
import unittest
from pathlib import Path

from dashboard import build_dashboard, coverage


class DashboardTests(unittest.TestCase):
    def test_distinct_codes_and_empty_inventory(self):
        self.assertEqual(coverage(["A", "A", "B"], ["A", "A", "outside"]),
                         dict(total=2, mapped=1, unmapped=1, percentage=50))
        self.assertEqual(coverage([], ["outside"]), dict(total=0, mapped=0, unmapped=0, percentage=None))

    def test_deduplication_pending_proposals_reference_union_and_auxiliary_layers(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            root = Path(temp)
            (root / "Procedures").mkdir()
            (root / "Procedures/procedure_counts_by_table.csv").write_text(
                "Table;Code;Frequency\nt_sksopr;K1;2\nt_sksopr;K1;<5\nt_sksopr;K3;7\nt_sksube;K1;1\nt_sksube;K2;99\n", encoding="utf-8")
            (root / "Procedures/diagnosis_source_code_counts.csv").write_text(
                "Code;Frequency\nDA010;<5\nDB010;15\n", encoding="utf-8")
            labs = dict(commit="snapshot", mappings=[
                dict(vocabulary="NPU", sourceCode="shared", conceptId="1"),
                dict(vocabulary="NPU", sourceCode="shared", conceptId="2"),
                dict(vocabulary="DNK", sourceCode="shared", conceptId="3"),
            ], unmapped=[dict(code="missing"), dict(code="missing")],
                units={"shared": [dict(omop="0"), dict(omop="5")], "missing": [dict(omop="")]})
            drugs = dict(categories={"products": "Products", "vaccines": "Vaccines"}, sources={
                "p": dict(category="products", code="shared"), "v1": dict(category="vaccines", code="v"), "v2": dict(category="vaccines", code="v")},
                mappings=[dict(category="products", sourceKey="p", conceptId="10", reviewState="Published"),
                          dict(category="vaccines", sourceKey="v1", conceptId="11", reviewState="Published"),
                          dict(category="vaccines", sourceKey="v1", conceptId="12", reviewState="Published"),
                          dict(category="vaccines", sourceKey="v2", conceptId="13", reviewState="Needs review")])
            procedures = dict(sources={key: {} for key in ("K1", "K2", "K3")}, mappings=[
                dict(sourceCode="K1", conceptId="20"), dict(sourceCode="K1", conceptId="21")])
            conditions = dict(sources={key: {} for key in ("A01.0", "B01.0", "C01.0")}, referenceCodes=["A01.0", "B01.0"], mappings=[
                dict(sourceCode="A01.0", conceptId="30", mappingStatus="Published"),
                dict(sourceCode="A01.0", conceptId="31", mappingStatus="Published"),
                dict(sourceCode="C01.0", conceptId="32", mappingStatus="Inactive mapping")])
            care = dict(categories={"sor": "SOR", "legacy": "Legacy", "visittypes": "Visit types"},
                indexes={category: category + ".json" for category in ("sor", "legacy", "visittypes")},
                mappingFiles={category: category + ".csv" for category in ("sor", "legacy", "visittypes")})
            for category, rows in {
                "sor": [["123", "Name", 0, [["1", "40"]]], ["456", "Name", 2, []]],
                "legacy": [["123", "Name", 3, [["1", "41"]]]], "visittypes": [["40", "Concept", 4, []]],
            }.items():
                (root / care["indexes"][category]).write_text(json.dumps(dict(rows=rows)), encoding="utf-8")
            result = build_dashboard(root, root, labs, drugs, procedures, conditions, care)
            topics = {row["id"]: row for row in result["topics"]}
            tables = {row["id"]: row for row in result["tables"]}
            self.assertEqual((topics["measurements"]["total"], topics["measurements"]["mapped"]), (3, 2))
            self.assertEqual((topics["drugs"]["total"], topics["drugs"]["mapped"]), (3, 2))
            self.assertEqual((topics["conditions"]["total"], topics["conditions"]["mapped"]), (3, 2))
            self.assertEqual((topics["caresites"]["total"], topics["caresites"]["mapped"]), (3, 2))
            self.assertEqual(tables["vaccines"]["pendingReview"], 1)
            self.assertEqual(tables["units"]["mapped"], 1)
            for identifier in ("units", "care-visittypes", "conditions-custom", "conditions-standard"):
                self.assertFalse(tables[identifier]["includedInTopic"])
            source_tables = {row["label"]: row for row in result["sourceTables"]}
            self.assertEqual((source_tables["t_sksopr"]["total"], source_tables["t_sksopr"]["mapped"]), (2, 1))
            self.assertEqual((source_tables["t_sksube"]["total"], source_tables["t_sksube"]["mapped"]), (2, 1))
            self.assertEqual(source_tables["t_diag"]["mapped"], 2)


if __name__ == "__main__":
    unittest.main()
