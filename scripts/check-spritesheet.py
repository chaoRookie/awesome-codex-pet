#!/usr/bin/env python3
"""上传前自检 spritesheet.webp 是否完整可用。

用法:
    python3 check-spritesheet.py pets/kafka-pocket--chaorookie/spritesheet.webp

检查项:
  1. RIFF / VP8L(VP8/VP8X) 声明的长度与实际文件大小是否一致（截断检测）
  2. 画布尺寸是否符合 v1 (1536x1872, 8列x9行) 或 v2 (1536x2288, 8列x11行)
  3. 能否被完整解码（Pillow）
  4. 是否带 alpha 透明通道、背景是否真的透明
  5. 每一格是否都有内容（空白帧检测）
"""

import struct
import sys

V1 = (1536, 1872, 8, 9)
V2 = (1536, 2288, 8, 11)

def fail(msg):
    print(f"  \033[31mFAIL\033[0m  {msg}")
    return 1

def ok(msg):
    print(f"  \033[32mOK\033[0m    {msg}")
    return 0

def main(path):
    print(f"\n检查 {path}")
    data = open(path, "rb").read()
    size = len(data)
    print(f"  实际文件大小: {size:,} 字节")
    problems = 0

    # --- 1. 容器完整性 ---
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return fail("不是 WebP 文件（缺少 RIFF/WEBP 标识）")
    declared_total = struct.unpack("<I", data[4:8])[0] + 8
    if declared_total != size:
        problems += fail(
            f"文件被截断/损坏：RIFF 头声明整文件应为 {declared_total:,} 字节，"
            f"实际只有 {size:,} 字节（缺失 {declared_total - size:,} 字节）"
        )
    else:
        problems += ok(f"RIFF 长度一致 ({declared_total:,} 字节)")

    off, width, height = 12, None, None
    while off + 8 <= size:
        cid = data[off:off + 4].decode("ascii", "replace")
        csize = struct.unpack("<I", data[off + 8 - 4:off + 8])[0]
        payload = data[off + 8: off + 8 + csize]
        if off + 8 + csize > size:
            problems += fail(
                f"{cid} 块声明 {csize:,} 字节，但文件里只剩 {size - off - 8:,} 字节 —— 图片数据不完整"
            )
        if cid == "VP8L" and len(payload) >= 5 and payload[0] == 0x2F:
            bits = int.from_bytes(payload[1:5], "little")
            width, height = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif cid == "VP8X" and len(payload) >= 10:
            width = int.from_bytes(payload[4:7], "little") + 1
            height = int.from_bytes(payload[7:10], "little") + 1
        elif cid == "VP8 " and payload[3:6] == b"\x9d\x01\x2a":
            width = (payload[6] | payload[7] << 8) & 0x3FFF
            height = (payload[8] | payload[9] << 8) & 0x3FFF
        off += 8 + csize + (csize & 1)

    # --- 2. 尺寸 ---
    if width is None:
        problems += fail("读不出画布尺寸")
        spec = None
    elif (width, height) == V1[:2]:
        spec = V1
        problems += ok(f"尺寸 {width}x{height} = v1 规格 (8列 x 9行)")
    elif (width, height) == V2[:2]:
        spec = V2
        problems += ok(f"尺寸 {width}x{height} = v2 规格 (8列 x 11行)")
    else:
        spec = None
        problems += fail(f"尺寸 {width}x{height} 不符合 v1 ({V1[0]}x{V1[1]}) 或 v2 ({V2[0]}x{V2[1]})")

    # --- 3~5. 解码 / 透明 / 空帧 ---
    try:
        from PIL import Image
    except ImportError:
        print("  跳过像素检查：先运行 pip install pillow")
        return problems

    try:
        im = Image.open(path)
        im.load()
    except Exception as exc:  # noqa: BLE001
        problems += fail(f"无法解码（文件损坏）：{type(exc).__name__}: {exc}")
        return problems
    problems += ok(f"可完整解码，mode={im.mode}")

    if im.mode != "RGBA":
        im = im.convert("RGBA")
    alpha = im.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo == 255:
        problems += fail("没有透明区域（背景是不透明的）—— 宠物图集需要透明背景")
    else:
        problems += ok(f"存在透明像素 (alpha 范围 {lo}-{hi})")

    if spec:
        # 每行必须画满的帧数，取自 .agents/skills/hatch-pet-v1/scripts/validate_atlas.py
        # 与 scripts/generate-pet-previews.py 的 STANDARD_STATES / LOOK_STATES
        required = {
            0: ("idle 待机", 6), 1: ("running-right 向右跑", 8), 2: ("running-left 向左跑", 8),
            3: ("waving 挥手", 4), 4: ("jumping 跳跃", 5), 5: ("failed 失败", 8),
            6: ("waiting 等待", 6), 7: ("running 奔跑", 6), 8: ("review 审查", 6),
        }
        if spec[3] == 11:
            required[9] = ("look-000-157 视线", 8)
            required[10] = ("look-180-337 视线", 8)
        cw, ch = spec[0] // spec[2], spec[1] // spec[3]
        missing = []
        for row, (label, count) in required.items():
            for col in range(count):
                cell = alpha.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
                # 与官方校验器一致：少于 50 个不透明像素视为空帧
                if sum(cell.histogram()[1:]) < 50:
                    missing.append(f"{label} 第{col + 1}帧")
        if missing:
            problems += fail(
                f"{len(missing)} 个必需动作帧是空的: "
                f"{', '.join(missing[:10])}{' ...' if len(missing) > 10 else ''}"
            )
        else:
            total = sum(c for _, c in required.values())
            problems += ok(f"{total} 个必需动作帧全部有内容 (每帧 {cw}x{ch})")

    return problems


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    code = main(sys.argv[1])
    print("\n\033[32m通过，可以提交 ✅\033[0m\n" if code == 0 else f"\n\033[31m有 {code} 项没通过，别提交 ❌\033[0m\n")
    raise SystemExit(1 if code else 0)
