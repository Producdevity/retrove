"""Rebuild the original ARMv7 integration fixture with Python 3 and Clang."""
import argparse
import functools
import operator
import os
from pathlib import Path
import plistlib
import struct
import subprocess
import tempfile
import zipfile

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TEXT, DATA, LINK = 0x8000, 0x9000, 0xA000
CODE_OFFSET = 0x800
PAGE = 4096


def words(*values):
    return struct.pack("<" + "I" * len(values), *values)


def section_name(text):
    return text.encode().ljust(16, b"\0")


def section(name, segment, address, size, offset, flags):
    return section_name(name) + section_name(segment) + words(address, size, offset, 2, 0, 0, flags, 0, 0)


def segment(name, address, size, offset, file_size, protection, *sections):
    return (words(1, 56 + 68 * len(sections)) + section_name(name) +
            words(address, size, offset, file_size, protection, protection, len(sections), 0) + b"".join(sections))


def padded_command(kind, fixed, string):
    payload = fixed + string.encode() + b"\0"
    payload += bytes((-len(payload)) % 4)
    return words(kind, 8 + len(payload)) + payload


def dylib(path):
    return padded_command(0xC, words(24, 2, 0x10000, 0x10000), path)


def text_section(obj):
    """Read the position-fixed .text bytes from Clang's relocatable ARM ELF object."""
    assert obj[:6] == b"\x7fELF\x01\x01" and struct.unpack_from("<H", obj, 18)[0] == 40
    section_offset = struct.unpack_from("<I", obj, 32)[0]
    size, count, names_index = struct.unpack_from("<HHH", obj, 46)
    sections = [struct.unpack_from("<10I", obj, section_offset + i * size) for i in range(count)]
    name_at = sections[names_index][4]
    for i, entry in enumerate(sections):
        at = name_at + entry[0]
        if obj[at:obj.index(b"\0", at)] == b".text":
            assert not any(s[1] in (4, 9) and s[7] == i and s[5] for s in sections), "Unresolved ARM relocations"
            return obj[entry[4]:entry[4] + entry[5]]
    raise ValueError("No .text section")


def macho(code, thread_test=False, imports=None, main_queue=False):
    names = ["_open", "_read", "_close", "_glClearColor", "_glClear"]
    if thread_test:
        names = ["_pthread_create", "_pthread_join", "_usleep"]
    if imports:
        names = imports
    data_size = max(20, 4 * len(names))
    assert data_size < 128
    # Set pointer type and segment 2 (__DATA) at offset 0, then bind each import slot.
    bind = b"\x51\x72\0" + b"".join(bytes([0x11 if imports or i < 3 else 0x12, 0x40]) + s.encode() + b"\0\x90"
                                         for i, s in enumerate(names)) + b"\0"
    extra_sections = []
    if main_queue:
        # Bind the root NSObject class into the test delegate category at 0x9310.
        bind = bind[:-1] + b"\x72\x94\x06\x11\x40_OBJC_CLASS_$_NSObject\0\x90\0"
        extra_sections.append(section("__objc_catlist", "__DATA", DATA + 0x300, 4, PAGE + 0x300, 0))
    rebase = bytes([0x11, 0x22, data_size, 0x51, 0])  # sole local pointer is __mod_init_func[0]
    linkedit = rebase + bind
    init_address = TEXT + CODE_OFFSET + 0x100
    commands = [
        segment("__PAGEZERO", 0, TEXT, 0, 0, 0),
        segment("__TEXT", TEXT, PAGE, 0, PAGE, 5,
                section("__text", "__TEXT", TEXT + CODE_OFFSET, len(code), CODE_OFFSET, 0x80000400)),
        segment("__DATA", DATA, PAGE, PAGE, PAGE, 3,
                section("__const", "__DATA", DATA, data_size, PAGE, 0),
                section("__mod_init_func", "__DATA", DATA + data_size, 4, PAGE + data_size, 9),
                section("__data", "__DATA", DATA + data_size + 4, 4, PAGE + data_size + 4, 0), *extra_sections),
        segment("__LINKEDIT", LINK, PAGE, PAGE * 2, len(linkedit), 1),
        padded_command(0xE, words(12), "/usr/lib/dyld"),
        dylib("/usr/lib/libSystem.B.dylib"),
        dylib("/System/Library/Frameworks/OpenGLES.framework/OpenGLES"),
        words(0x25, 16, 0x70100, 0x70100),
        words(0x80000028, 24) + struct.pack("<QQ", CODE_OFFSET, 0),
        words(0x80000022, 48, PAGE * 2, len(rebase), PAGE * 2 + len(rebase), len(bind), 0, 0, 0, 0, 0, 0),
    ]
    header = words(0xFEEDFACE, 12, 9, 2, len(commands), sum(map(len, commands)), 0x85)
    image = bytearray(PAGE * 2)
    headers = header + b"".join(commands)
    assert len(headers) <= CODE_OFFSET and CODE_OFFSET + len(code) <= PAGE
    image[:len(headers)] = headers
    image[CODE_OFFSET:CODE_OFFSET + len(code)] = code
    struct.pack_into("<I", image, PAGE + data_size, init_address)
    if main_queue:
        name = b"application:didFinishLaunchingWithOptions:\0"
        image[PAGE+0x300:PAGE+0x304] = words(DATA+0x310)
        image[PAGE+0x310:PAGE+0x328] = words(0, 0, DATA+0x330, 0, 0, 0)
        image[PAGE+0x330:PAGE+0x344] = words(12, 1, DATA+0x350, 0, TEXT+CODE_OFFSET+0x200)
        image[PAGE+0x350:PAGE+0x350+len(name)] = name
    return image + linkedit


def build(obj, destination, thread_test=False, imports=None, main_queue=False):
    color = struct.pack("<4f", 0.2, 0.4, 0.6, 1)
    checksum = functools.reduce(operator.xor, struct.unpack("<4I", color))
    info = {"CFBundleExecutable": "Smoke", "CFBundleIdentifier": "local.runtime.smoke",
            "CFBundleName": "ARMv7 Smoke", "CFBundlePackageType": "APPL", "MinimumOSVersion": "7.1"}
    files = {"Info.plist": plistlib.dumps(info, fmt=plistlib.FMT_BINARY), "Smoke": macho(text_section(obj), thread_test, imports, main_queue),
             "rgba.bin": color + words(checksum)}
    with zipfile.ZipFile(destination, "w") as archive:
        for name, contents in files.items():
            entry = zipfile.ZipInfo("Payload/Smoke.app/" + name)
            entry.external_attr = (0o100755 if name == "Smoke" else 0o100644) << 16
            archive.writestr(entry, contents, compress_type=zipfile.ZIP_DEFLATED)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--object", type=Path, help="use a preassembled ARMv7 ELF object")
    parser.add_argument("--output", type=Path, default=FIXTURES / "smoke.ipa")
    parser.add_argument("--threads", action="store_true", help="build the pthread fixture")
    parser.add_argument("--dispatch-contention", action="store_true", help="build the contended dispatch_once fixture")
    parser.add_argument("--main-queue", action="store_true", help="build the UIKit main queue ordering fixture")
    args = parser.parse_args()
    imports = None
    source = "threads.S" if args.threads else "smoke.S"
    if args.dispatch_contention:
        source = "dispatch-contention.S"
        imports = ["_pthread_create", "_pthread_join", "_pthread_mutex_init", "_pthread_mutex_lock",
                   "_pthread_mutex_unlock", "_dispatch_once", "_usleep"]
    if args.main_queue:
        source = "main-queue.S"
        imports = ["_dispatch_async", "__dispatch_main_q", "_dispatch_once", "_usleep", "_NSStringFromClass",
                   "_OBJC_CLASS_$_NSObject", "_UIApplicationMain", "_exit"]
    with tempfile.TemporaryDirectory() as tmp:
        obj = args.object or Path(tmp) / "smoke.o"
        if args.object is None:
            subprocess.run([os.getenv("CLANG", "clang"), "--target=armv7-none-eabi", "-c",
                            str(FIXTURES / source), "-o", str(obj)], check=True)
        build(obj.read_bytes(), args.output, args.threads, imports, args.main_queue)
