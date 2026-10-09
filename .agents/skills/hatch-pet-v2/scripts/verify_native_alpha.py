#!/usr/bin/env python3
"""Reject generated sources without a usable transparent canvas."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from background_utils import alpha_profile, has_usable_transparency


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()

    try:
        with Image.open(args.image) as image:
            profile = alpha_profile(image)
            valid = (
                has_usable_transparency(image)
                and profile["transparent_ratio"] >= 0.1
                and profile["transparent_border_pixels"] >= profile["border_pixels"] * 0.95
            )
    except (OSError, UnidentifiedImageError) as exc:
        parser.error(f"cannot inspect generated image {args.image}: {exc}")

    if not valid:
        parser.error(
            f"{args.image}: native transparency required; got "
            f"alpha_channel={profile['has_alpha_channel']}, "
            f"transparent_ratio={profile['transparent_ratio']:.3f}, "
            f"transparent_border_pixels={profile['transparent_border_pixels']}/"
            f"{profile['border_pixels']}"
        )

    print(f"native alpha verified: {args.image}")


if __name__ == "__main__":
    main()
