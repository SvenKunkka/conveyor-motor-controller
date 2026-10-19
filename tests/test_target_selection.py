"""No-hardware regression tests for explicitly selected diagnostic targets.

The serial module is replaced before scripts run. Even accepted targets stop at
an exception in the fake constructor, so these tests cannot open a real port.
"""
import contextlib
import io
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
PORT = "/dev/cu.synthetic-target"
MAC = "AA:BB:CC:DD:EE:FF"
TOOLS = {
    "device_acceptance.py": ["--confirm-vm-disconnected"],
    "output_acceptance.py": ["--confirm-vm-disconnected"],
    "short_pulse.py": ["--empty-fixed-motor"],
}


class TargetSelected(Exception):
    """Raised instead of constructing or opening a serial device."""


def usb_port(**changes):
    values = dict(device=PORT, vid=0x303A, pid=0x1001, serial_number=MAC)
    values.update(changes)
    return types.SimpleNamespace(**values)


class TargetSelectionTests(unittest.TestCase):
    def invoke(self, tool, arguments, ports, enumerations=None):
        serial = types.ModuleType("serial")
        serial.Serial = Mock(side_effect=TargetSelected)
        serial_tools = types.ModuleType("serial.tools")
        enumeration = types.ModuleType("serial.tools.list_ports")
        enumeration.comports = Mock(return_value=ports, side_effect=enumerations)
        serial_tools.list_ports = enumeration
        serial.tools = serial_tools
        modules = {"serial": serial, "serial.tools": serial_tools,
                   "serial.tools.list_ports": enumeration}
        result = None
        # Capture logs in memory; do not modify the actual evidence directory.
        with patch.dict(sys.modules, modules), patch.object(sys, "argv", [tool, *arguments]), \
                patch.object(Path, "open", return_value=io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            try:
                runpy.run_path(str(ROOT / "tools" / tool), run_name="__main__")
            except (SystemExit, TargetSelected) as exc:
                result = exc
        return result, serial.Serial, enumeration.comports

    def test_both_target_arguments_are_required(self):
        for tool, safety_flags in TOOLS.items():
            for missing in ("port", "expected-mac"):
                with self.subTest(tool=tool, missing=missing):
                    arguments = [*safety_flags]
                    if missing != "port":
                        arguments += ["--port", PORT]
                    if missing != "expected-mac":
                        arguments += ["--expected-mac", MAC]
                    result, constructor, enumeration = self.invoke(tool, arguments, [usb_port()])
                    self.assertIsInstance(result, SystemExit)
                    self.assertEqual(result.code, 2)
                    constructor.assert_not_called()
                    enumeration.assert_not_called()

    def test_wrong_or_ambiguous_targets_never_open(self):
        cases = {
            "missing port": [],
            "different port": [usb_port(device="/dev/cu.other")],
            "duplicate port": [usb_port(), usb_port()],
            "wrong vendor": [usb_port(vid=0x1111)],
            "wrong product": [usb_port(pid=0x2222)],
            "missing serial": [usb_port(serial_number=None)],
            "wrong serial": [usb_port(serial_number="00:00:00:00:00:00")],
        }
        for tool, safety_flags in TOOLS.items():
            for name, ports in cases.items():
                with self.subTest(tool=tool, case=name):
                    result, constructor, _ = self.invoke(
                        tool, [*safety_flags, "--port", PORT, "--expected-mac", MAC], ports)
                    self.assertIsInstance(result, SystemExit)
                    self.assertEqual(result.code, 2)
                    constructor.assert_not_called()

    def test_empty_expected_serial_never_opens(self):
        for tool, safety_flags in TOOLS.items():
            with self.subTest(tool=tool):
                result, constructor, _ = self.invoke(
                    tool, [*safety_flags, "--port", PORT, "--expected-mac", ""],
                    [usb_port(serial_number="")])
                self.assertIsInstance(result, SystemExit)
                self.assertEqual(result.code, 2)
                constructor.assert_not_called()

    def test_serial_match_is_case_insensitive(self):
        for tool, safety_flags in TOOLS.items():
            with self.subTest(tool=tool):
                result, constructor, enumeration = self.invoke(
                    tool, [*safety_flags, "--port", PORT, "--expected-mac", MAC.lower()],
                    [usb_port()])
                self.assertIsInstance(result, TargetSelected)
                constructor.assert_called_once()
                self.assertGreaterEqual(enumeration.call_count, 1)

    def test_safety_confirmation_still_required(self):
        for tool in TOOLS:
            with self.subTest(tool=tool):
                result, constructor, enumeration = self.invoke(
                    tool, ["--port", PORT, "--expected-mac", MAC], [usb_port()])
                self.assertIsInstance(result, SystemExit)
                self.assertEqual(result.code, 2)
                constructor.assert_not_called()
                enumeration.assert_not_called()

    def test_device_target_is_rechecked_immediately_before_open(self):
        result, constructor, enumeration = self.invoke(
            "device_acceptance.py", ["--port", PORT, "--expected-mac", MAC,
                                     "--confirm-vm-disconnected"], [],
            enumerations=[[usb_port()], [usb_port(serial_number="different")]])
        self.assertIsInstance(result, SystemExit)
        self.assertEqual(result.code, 2)
        constructor.assert_not_called()
        self.assertEqual(enumeration.call_count, 2)

    def test_pulse_envelope_still_enforced_before_open(self):
        for arguments in (["--duty", "31"], ["--duration-ms", "201"], ["--frequency", "500"]):
            with self.subTest(arguments=arguments):
                result, constructor, enumeration = self.invoke(
                    "short_pulse.py", ["--port", PORT, "--expected-mac", MAC,
                                       "--empty-fixed-motor", *arguments], [usb_port()])
                self.assertIsInstance(result, SystemExit)
                self.assertEqual(result.code, 2)
                constructor.assert_not_called()
                enumeration.assert_not_called()


if __name__ == "__main__":
    unittest.main()
