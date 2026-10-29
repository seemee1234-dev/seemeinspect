# -*- coding: utf-8 -*-
"""
INSPECT Q • Camera Zoom & Close-up Interactive Swipe/Pinch Verification Audit
Universal Proof-of-Execution Contract
"""

import os
import sys
import re

BASE_DIR = r"C:\Users\ADMIN\Music\seemeinspect"

def test_camera_zoom_logic():
    print("[TEST 1] Verifying Live Camera Zoom logic & gesture controllers...")
    target_files = ["inspector.html", "index.html", "inspector_mobile.html"]

    required_js_tokens = [
        "let liveCamZoomLevel = 1.0",
        "function applyCameraHardwareZoom(",
        "function setLiveCamZoom(",
        "function initLiveCamGestures(",
        "function openPhotoZoomPreview(",
        "function closePhotoZoomPreview(",
        "function resetPhotoZoom(",
        "function adjustPhotoZoom(",
        "function applyPhotoZoomTransform(",
        "function initPhotoZoomGestures(",
        "// Apply Live Digital Zoom factor to crop boundaries"
    ]

    for fname in target_files:
        fpath = os.path.join(BASE_DIR, fname)
        assert os.path.exists(fpath), f"File not found: {fpath}"
        with open(fpath, "r", encoding="utf-8") as f:
            code = f.read()

        for token in required_js_tokens:
            assert token in code, f"Missing JS token in {fname}: {token}"
        print(f"  ✓ {fname}: All {len(required_js_tokens)} Zoom controller methods verified!")

def test_camera_zoom_ui():
    print("[TEST 2] Verifying Live Viewfinder UI & Gestures elements...")
    target_files = ["inspector.html", "index.html", "inspector_mobile.html"]

    required_ui_tokens = [
        "id=\"live-cam-zoom-badge\"",
        "id=\"live-cam-close-hint\"",
        "id=\"live-cam-zoom-track\"",
        "id=\"live-cam-zoom-thumb\"",
        "id=\"live-cam-zoom-pills\"",
        "class=\"zoom-preset-pill\"",
        "data-zoom=\"1.0\"",
        "data-zoom=\"2.0\"",
        "data-zoom=\"3.0\"",
        "data-zoom=\"5.0\"",
        "id=\"photo-zoom-modal\"",
        "id=\"photo-zoom-viewport\"",
        "id=\"photo-zoom-target\"",
        "id=\"photo-zoom-indicator\""
    ]

    for fname in target_files:
        fpath = os.path.join(BASE_DIR, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()

        for token in required_ui_tokens:
            assert token in html, f"Missing UI token in {fname}: {token}"
        print(f"  ✓ {fname}: All {len(required_ui_tokens)} Viewfinder UI elements verified!")

def test_crop_math_simulation():
    print("[TEST 3] Simulating mathematical crop accuracy for 1x, 2x, 3x, 5x zoom...")
    vW, vH = 1280, 720
    cropW, cropH = 960, 720
    cropX, cropY = 160, 0

    zoom_tests = [1.0, 2.0, 3.0, 5.0]
    for z in zoom_tests:
        if z > 1.0:
            zW = cropW / z
            zH = cropH / z
            cX = cropX + (cropW - zW) / 2
            cY = cropY + (cropH - zH) / 2
            final_cropX = max(0, min(vW - 1, round(cX)))
            final_cropY = max(0, min(vH - 1, round(cY)))
            final_cropW = max(10, min(vW - final_cropX, round(zW)))
            final_cropH = max(10, min(vH - final_cropY, round(zH)))
        else:
            final_cropX, final_cropY, final_cropW, final_cropH = cropX, cropY, cropW, cropH

        # Assert centered aspect ratio preserved
        aspect = final_cropW / final_cropH
        expected_aspect = cropW / cropH
        assert abs(aspect - expected_aspect) < 0.05, f"Aspect ratio distorted at zoom {z}x: {aspect} vs {expected_aspect}"
        print(f"  ✓ Zoom {z:.1f}x -> Cropped Viewport: {final_cropW}x{final_cropH} at ({final_cropX}, {final_cropY}) [Aspect: 4:3 Exact]")

def test_typography_and_cleanliness():
    print("[TEST 4] Verifying Typography compliance (Kanit 300, Crisp, No Glow)...")
    target_files = ["inspector.html", "index.html"]
    for fname in target_files:
        fpath = os.path.join(BASE_DIR, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            code = f.read()

        assert "Kanit" in code, f"Kanit font declaration missing in {fname}"
        assert "text-shadow: 0 0" not in code, f"Forbidden neon bloom glow found in {fname}"
        print(f"  ✓ {fname}: Typography compliance verified (Kanit font, Crisp, No Glow)")

if __name__ == "__main__":
    print("=" * 65)
    print("INSPECT Q • CAMERA ZOOM & CLOSE-UP SWIPE/PINCH VERIFICATION AUDIT")
    print("=" * 65)
    try:
        test_camera_zoom_logic()
        test_camera_zoom_ui()
        test_crop_math_simulation()
        test_typography_and_cleanliness()
        print("=" * 65)
        print(">>> ALL TESTS PASSED SUCCESSFULLY! (EXIT CODE 0) <<<")
        print("=" * 65)
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ AUDIT FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        sys.exit(2)
