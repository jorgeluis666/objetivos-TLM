import importlib.util
from pathlib import Path
from datetime import date
import unittest

spec = importlib.util.spec_from_file_location('build_ads', Path(__file__).resolve().parents[1] / 'scripts/build-ads-data.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReportCutoffTest(unittest.TestCase):
    def test_monday_and_sunday_in_progress(self):
        self.assertEqual(module.report_end(2026, 11, date(2026, 11, 9), date(2026, 11, 9)), date(2026, 11, 8))
        self.assertEqual(module.report_end(2026, 11, date(2026, 11, 8), date(2026, 11, 8)), date(2026, 11, 1))
        self.assertLess(module.report_end(2026, 11, date(2026, 11, 1), date(2026, 11, 1)), date(2026, 11, 1))
        self.assertIsNone(module.report_end(2026, 10, date(2026, 10, 31), date(2026, 11, 9)))

    def test_filters_before_aggregation_and_excludes_mtd_unique_reach(self):
        rows = [{'day': date(2026, 11, day), 'spend': 10, 'campaign': 'Ventas', 'ad': 'A'} for day in range(1, 10)]
        rows.append({'day': date(2026, 11, 1), 'only': 'month', 'reach': 999})
        filtered = module.report_rows(rows, date(2026, 11, 8))
        self.assertEqual(len(filtered), 8)
        self.assertEqual(sum(row['spend'] for row in filtered), 80)
        self.assertEqual(module.campaigns_of(filtered)[0]['spend'], 80)
        self.assertEqual(module.ads_table(filtered)[0][module.AD_TABLE_COLUMNS.index('spend')], 80)
        self.assertEqual(len(rows), 10)


if __name__ == '__main__':
    unittest.main()
