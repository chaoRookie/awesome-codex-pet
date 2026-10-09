import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


class SingleFinalBackgroundCleanupTest(unittest.TestCase):
    def test_cleanup_runs_only_after_v2_assembly(self) -> None:
        instructions = SKILL.read_text()

        self.assertEqual(instructions.count("scripts/despill_chroma_edges.py"), 1)
        self.assertNotIn("chroma-despill-standard.json", instructions)
        self.assertIn("native-alpha-pass-through", instructions)
        self.assertIn("CLEANUP_MODE=$(jq -r '.cleanupMode'", instructions)
        self.assertLess(
            instructions.index("scripts/assemble_extended_atlas.py"),
            instructions.index("scripts/despill_chroma_edges.py"),
        )

    def test_new_v2_run_uses_local_scripts_and_strict_transparency(self) -> None:
        instructions = SKILL.read_text()

        self.assertIn('SKILL_DIR="$(pwd -P)/.agents/skills/hatch-pet-v2"', instructions)
        self.assertNotIn('SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/hatch-pet"', instructions)
        self.assertIn("BACKGROUND_MODE=transparent", instructions)
        self.assertNotIn("--background-mode auto \\\n", instructions)
        self.assertIn("transparent_background: true", instructions)
        self.assertIn("scripts/verify_native_alpha.py", instructions)
        self.assertIn('all(.rows[]; .background_mode == "transparent")', instructions)
        self.assertIn('all(.rowBackgroundModes[]; . == "transparent")', instructions)


if __name__ == "__main__":
    unittest.main()
