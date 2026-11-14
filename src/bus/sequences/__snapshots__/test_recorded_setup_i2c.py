# test_recorded_setup_i2c.py: the bus console sequence "Recorded setup I2C", exported 2026-11-13.
#
# Runs with the embeddedci SDK and its pytest plugin (the `benchpod` fixture):
#   pip install embeddedci
#   pytest test_recorded_setup_i2c.py --benchpod-connection <host, usb or embeddedci:<pod>>
#
# Each read asserts what the pod saw when the sequence was recorded: edit the expected bytes
# and levels to what your board should return. Channel names come from the wiring profile.

from contextlib import ExitStack


def test_recorded_setup_i2c(benchpod):
    bp = benchpod
    with ExitStack() as stack:  # closes the sessions opened below, even when an assert fails
        # Setup: the bus as it was when the sequence was recorded (opened before its first step).
        bp.enable_pullup(2, 1)  # LA2 i2c_sda, LA1 i2c_scl
        i2c = stack.enter_context(bp.open_i2c(sda=2, scl=1, hz=100_000, pullups="pod"))  # LA2 i2c_sda, LA1 i2c_scl
        # The recorded steps.
        i2c.write_reg(0x42, 0x10, bytes.fromhex("c3 3c"))
        assert i2c.read_reg(0x42, 0x10, 2) == bytes.fromhex("c3 3c")
