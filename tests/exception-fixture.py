"""Build the Darwin ARMv7 C++ exception fixture with Clang and LLD on Linux."""
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import zipfile

from fixture import CODE_OFFSET, DATA, FIXTURES, TEXT, macho

clang = os.environ.get("CLANG", "clang")
lld = os.environ.get("LD_LLD", "ld.lld")
imports = ["_qsort", "___cxa_allocate_exception", "___cxa_throw", "___cxa_begin_catch",
           "___cxa_end_catch", "___cxa_rethrow", "__Unwind_SjLj_Register", "__Unwind_SjLj_Resume",
           "__Unwind_SjLj_Unregister", "___gxx_personality_sj0", "__ZSt9terminatev", "__ZTIPKw", "___stack_chk_guard", "___stack_chk_fail",
           "__ZNKSt3__120__vector_base_commonILb1EE20__throw_length_errorEv", "__ZTISt9exception",
           "___objc_personality_v0", "_OBJC_EHTYPE_id", "_objc_getClass", "_objc_begin_catch",
           "_objc_end_catch", "_objc_exception_throw"]

with tempfile.TemporaryDirectory() as tmp:
    def path(name):
        return Path(tmp) / name

    subprocess.run([clang, "-target", "armv7-apple-ios7", "-Os", "-S", FIXTURES / "sjlj.mm",
                    "-o", path("darwin.s")], check=True)
    # Keep Apple's machine instructions and LSDA tables. Use ELF only for
    # assembly and local relocations so this generator doesn't require ld64.
    assembly = path("darwin.s").read_text().split(".section\t__DATA,__nl_symbol_ptr")[0]
    assembly = re.sub(r"^\s*\.section[^\n]+", "\n.text", assembly, flags=re.M)
    assembly = re.sub(r"^\s*\.(?:ios_version_min|data_region|end_data_region|private_extern|weak_def_can_be_hidden)[^\n]*",
                      "", assembly, flags=re.M)
    assembly = re.sub(r"\.thumb_func\s+\w[^\n]*", ".thumb_func", assembly)
    assembly = assembly.replace("$non_lazy_ptr", "_non_lazy_ptr")
    prefix = ".syntax unified\n.text\n.arm\nldr ip, 1f\nbx ip\n1: .word _main\n.org 0x100\nbx lr\n"
    stubs = ""
    linker = []
    for i, name in enumerate(imports):
        address = DATA + 4*i
        linker.append(f"--defsym=L{name}_non_lazy_ptr={address}")
        if name not in ("__ZTIPKw", "___gxx_personality_sj0", "___stack_chk_guard", "__ZTISt9exception",
                        "___objc_personality_v0", "_OBJC_EHTYPE_id"):
            stubs += (f".thumb\n.thumb_func\n{name}:\nmovw ip, #{address}\n"
                      "ldr.w ip, [ip]\nbx ip\n")
    path("fixture.s").write_text(prefix + assembly + stubs)
    subprocess.run([clang, "-target", "armv7-none-eabi", "-march=armv7-a", "-mfpu=vfpv3",
                    "-mfloat-abi=softfp", "-c", path("fixture.s"), "-o", path("fixture.o")], check=True)
    subprocess.run([lld, f"-Ttext={TEXT + CODE_OFFSET:#x}", "-e", "_main", "--oformat=binary",
                    *linker, path("fixture.o"), "-o", path("text.bin")], check=True)
    image = macho(path("text.bin").read_bytes(), imports=imports)
    info = {"CFBundleExecutable":"Exceptions", "CFBundleIdentifier":"local.runtime.exceptions"}
    with zipfile.ZipFile(FIXTURES / "sjlj.ipa", "w") as archive:
        for name, data in [("Info.plist", plistlib.dumps(info)), ("Exceptions", image)]:
            entry = zipfile.ZipInfo("Payload/Exceptions.app/" + name)
            archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED)
