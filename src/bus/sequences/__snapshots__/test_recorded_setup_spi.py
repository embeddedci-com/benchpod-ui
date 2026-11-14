# test_recorded_setup_spi.py: the bus console sequence "Recorded setup SPI", exported 2026-11-13.
#
# Runs with the embeddedci SDK and its pytest plugin (the `benchpod` fixture):
#   pip install embeddedci
#   pytest test_recorded_setup_spi.py --benchpod-connection <host, usb or embeddedci:<pod>>
#
# Each read asserts what the pod saw when the sequence was recorded: edit the expected bytes
# and levels to what your board should return. Channel names come from the wiring profile.

from embeddedci.benchpod import Trigger, SpiSend


def test_recorded_setup_spi(benchpod):
    bp = benchpod
    with bp.open_spi(sck=13, mosi=14, miso=6, cs=5, hz=2_000_000, mode=1) as spi:  # LA13 spi_sclk, LA14 spi_mosi, LA5 LED
        assert spi.transfer(bytes.fromhex("9f 00 00 00")) == bytes.fromhex("ff ef 40 18")
    with bp.open_spi(hz=2_000_000, mode=1) as spi:
        cap_2 = bp.capture_la(4096, trigger=Trigger(spi.cs, "falling"), send=SpiSend(bytes.fromhex("05")))
    assert cap_2.send_result.ok
    assert cap_2.send_result.data == bytes.fromhex("00")
