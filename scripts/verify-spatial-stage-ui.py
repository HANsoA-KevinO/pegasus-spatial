#!/usr/bin/env python3
"""Compatibility entry point for the real Three.js Stage browser regression.

The standalone fixture exercises the production Stage without starting MongoDB,
background agents or external providers. See verify-three-renderer.py --help.
"""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('verify-three-renderer.py')), run_name='__main__')
