# test_read_chip_id.py: the bus console sequence "Read chip id", exported 2026-11-13.
#
# Runs with the embeddedci SDK and its pytest plugin (the `benchpod` fixture):
#   pip install embeddedci
#   pytest test_read_chip_id.py --benchpod-connection <host, usb or embeddedci:<pod>>
#
# Each read asserts what the pod saw when the sequence was recorded: edit the expected bytes
# and levels to what your board should return. Channel names come from the wiring profile.

from contextlib import ExitStack


def test_read_chip_id(benchpod):
    bp = benchpod
    with ExitStack() as stack:  # closes the sessions opened below, even when an assert fails
        bp.enable_pullup(1, 2)  # LA1 i2c_sda, LA2 i2c_scl
        i2c = stack.enter_context(bp.open_i2c(1, 2, hz=100_000))  # LA1 i2c_sda, LA2 i2c_scl
        assert i2c.read_reg(0x76, 0xd0, 1) == bytes.fromhex("58")
        i2c.write_reg(0x76, 0xf4, bytes.fromhex("27"))
