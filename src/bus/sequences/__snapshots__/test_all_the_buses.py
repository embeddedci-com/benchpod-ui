# test_all_the_buses.py: the bus console sequence "All the buses", exported 2026-11-13.
#
# Runs with the embeddedci SDK and its pytest plugin (the `benchpod` fixture):
#   pip install embeddedci
#   pytest test_all_the_buses.py --benchpod-connection <host, usb or embeddedci:<pod>>
#
# Each read asserts what the pod saw when the sequence was recorded: edit the expected bytes
# and levels to what your board should return. Channel names come from the wiring profile.

import time
from contextlib import ExitStack

from embeddedci.benchpod import Trigger, GpioSend


def test_all_the_buses(benchpod):
    bp = benchpod
    with ExitStack() as stack:  # closes the sessions opened below, even when an assert fails
        bp.enable_pullup(1, 2)  # LA1 i2c_sda, LA2 i2c_scl
        i2c = stack.enter_context(bp.open_i2c(hz=400_000, pullups="pod"))
        assert i2c.scan(0x08, 0x77) == [0x76]
        assert i2c.read_reg(0x76, 0xd0, 1) == bytes.fromhex("58")
        i2c.write_reg(0x76, 0xf4, bytes.fromhex("27"))
        assert i2c.read_reg(0x76, 0xf7, 6) == bytes.fromhex("5a 3c 00 80 f0 00")
        assert not i2c.xfer(0x50, bytes.fromhex("00 01"), read=2).ack  # NACK when recorded
        assert i2c.probe(0x76)
        cap_9 = bp.capture_la(8192, sample_rate_hz=12_000_000, trigger=Trigger(i2c.sda, "falling"), send=i2c.send(0x76, bytes.fromhex("d0"), read=1))
        assert cap_9.send_result.ok
        assert cap_9.send_result.data == bytes.fromhex("58")
        i2c.close()
        bp.configure_gpio([5], "output", level=0)  # LA5 LED
        bp.set_gpio(5, 1)  # LA5 LED
        levels_13 = bp.pin_levels()
        assert levels_13[3] == 1  # LA3 READY
        assert bp.wait_for_level("READY", 1, timeout=2)
        bp.la_step(5, steps=3, delay=0.001)  # 3 pulse(s), 0.001 s high, LA5 LED
        cap_16 = bp.capture_la(4096, trigger=Trigger(5, "falling"), send=GpioSend(5, 0))
        assert cap_16.send_result.ok
        bp.release_gpio(5)  # LA5 LED
        with bp.open_spi(hz=1_000_000) as spi:
            assert spi.transfer(bytes.fromhex("9f 00 00 00")) == bytes.fromhex("ff ef 40 18")
        can = stack.enter_context(bp.open_can(bitrate=500_000, mode="normal", term=True))
        bp.can_write(0x123, bytes.fromhex("01 02 ff"))
        time.sleep(0.5)
        frames_21 = can.read(8)
        assert [(f.id, f.data) for f in frames_21] == [(0x321, bytes.fromhex("aa"))]
        can.close()
        uart = stack.enter_context(bp.open_uart(baud=115_200))
        uart.write("status \"now\"\r\n")
        uart.close()
        # Step 26: flash({"file":"fw.elf"}) has no SDK form here; add it by hand.
