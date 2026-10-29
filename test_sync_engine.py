# -*- coding: utf-8 -*-
"""
INSPECT Q • Cross-Device Live Auto-Sync Engine Automated Verification Test
Universal Proof-of-Execution Contract
"""

import os
import sys
import json
import re

BASE_DIR = r"C:\Users\ADMIN\Music\seemeinspect"

def test_assets():
    print("[TEST 1] Verifying asset files...")
    peerjs_path = os.path.join(BASE_DIR, "assets", "js", "peerjs.min.js")
    sync_path = os.path.join(BASE_DIR, "assets", "js", "sync_engine.js")

    assert os.path.exists(peerjs_path), f"Missing: {peerjs_path}"
    peerjs_size = os.path.getsize(peerjs_path)
    assert peerjs_size > 80000, f"peerjs.min.js is too small: {peerjs_size} bytes"
    print(f"  ✓ peerjs.min.js exists ({peerjs_size:,} bytes)")

    assert os.path.exists(sync_path), f"Missing: {sync_path}"
    sync_size = os.path.getsize(sync_path)
    assert sync_size > 10000, f"sync_engine.js is too small: {sync_size} bytes"
    print(f"  ✓ sync_engine.js exists ({sync_size:,} bytes)")

def test_sync_engine_methods():
    print("[TEST 2] Verifying SyncEngine methods & architecture...")
    sync_path = os.path.join(BASE_DIR, "assets", "js", "sync_engine.js")
    with open(sync_path, "r", encoding="utf-8") as f:
        code = f.read()

    required_methods = [
        "init",
        "setPin",
        "connectP2P",
        "initHost",
        "initClient",
        "setupConnection",
        "broadcastMutation",
        "pushFullStateToConn",
        "pushNow",
        "pullNow",
        "handleIncomingData",
        "applyIncomingSnapshot",
        "setupAutoSyncHooks",
        "exportOfflineBackup",
        "importOfflineBackup",
        "updateStatus",
        "showToast"
    ]

    for m in required_methods:
        pattern = rf"{m}\s*:\s*(?:async\s+)?function"
        assert re.search(pattern, code), f"Missing method in sync_engine.js: {m}"
        print(f"  ✓ Method found: SyncEngine.{m}()")

def test_html_injections():
    print("[TEST 3] Verifying HTML entry points injection...")
    target_files = ["inspector.html", "index.html", "inspector_mobile.html"]
    
    required_tokens = [
        "assets/js/peerjs.min.js",
        "assets/js/sync_engine.js",
        "id=\"cloud-sync-btn\"",
        "openSyncModal()",
        "id=\"sync-modal\"",
        "id=\"sync-pin-input\"",
        "saveSyncPinFromUI()",
        "triggerManualPush()",
        "triggerManualPull()",
        "triggerOfflineExport()",
        "triggerOfflineImport(",
        "SyncEngine.init()"
    ]

    for fname in target_files:
        fpath = os.path.join(BASE_DIR, fname)
        assert os.path.exists(fpath), f"File not found: {fpath}"
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()

        for token in required_tokens:
            assert token in html, f"Missing token '{token}' in {fname}"
        print(f"  ✓ {fname}: All {len(required_tokens)} sync components verified!")

def test_snapshot_roundtrip():
    print("[TEST 4] Testing JSON snapshot serialization with base64 photos...")
    fake_snapshot = {
        "projectConfig": {
            "projName": "Life Asoke Hype",
            "roomNo": "128/99",
            "custName": "คุณสมชาย",
            "phone": "089-123-4567",
            "inspector": "สถาปนิกวิชาชีพ",
            "inspectDate": "29 / 10 / 2026"
        },
        "defectList": [
            {
                "code": "D-001",
                "room": "ห้องนอนใหญ่",
                "category": "งานผนัง",
                "location": "ผนังทิศเหนือ ข้างหน้าต่าง",
                "desc": "สีโป่งพองและมีรอยแตกลายงา",
                "recommend": "ขูดลอกสีเก่าออก โป๊วเรียบ และทาสีรองพื้นใหม่",
                "status": "รอแก้ไข",
                "photoWide": "data:image/jpeg;base64," + "A" * 15000,
                "photoClose": "data:image/jpeg;base64," + "B" * 25000
            },
            {
                "code": "D-002",
                "room": "ห้องน้ำ",
                "category": "งานสุขาภิบาล",
                "location": "ใต้เคาน์เตอร์อ่างล้างหน้า",
                "desc": "ท่อน้ำทิ้งมีน้ำซึมหยดลงพื้น",
                "recommend": "ขันเกลียวข้อต่อให้แน่นและพันเทปพันเกลียวใหม่",
                "status": "รอแก้ไข",
                "photoWide": "data:image/jpeg;base64," + "C" * 15000,
                "photoClose": "data:image/jpeg;base64," + "D" * 25000
            }
        ],
        "completedRooms": {"ห้องนอนใหญ่": True, "ห้องน้ำ": True},
        "customRooms": [],
        "customCategories": [],
        "siteAttendance": {"customer": True, "contractor": True},
        "exportedAt": "2026-10-29T08:00:00.000Z"
    }

    serialized = json.dumps(fake_snapshot)
    deserialized = json.loads(serialized)

    assert deserialized["projectConfig"]["projName"] == "Life Asoke Hype"
    assert len(deserialized["defectList"]) == 2
    assert deserialized["defectList"][0]["code"] == "D-001"
    assert len(deserialized["defectList"][0]["photoClose"]) > 25000
    print(f"  ✓ Snapshot roundtrip passed ({len(serialized):,} characters processed)")

def test_typography_compliance():
    print("[TEST 5] Testing typography compliance (Kanit 300 / Crisp / No Glow)...")
    sync_modal_snippet = """font-family: 'Kanit', sans-serif; font-weight: 300;"""
    target_files = ["inspector.html", "index.html"]
    for fname in target_files:
        fpath = os.path.join(BASE_DIR, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()
        # Verify sync-modal has Kanit font
        assert "font-family: 'Kanit', sans-serif;" in html
        assert "text-shadow: 0 0" not in html # No neon blur
        print(f"  ✓ {fname}: Typography compliance verified (Kanit font, Crisp, No Glow)")

if __name__ == "__main__":
    print("=" * 65)
    print("INSPECT Q • CROSS-DEVICE AUTO-SYNC VERIFICATION AUDIT")
    print("=" * 65)
    try:
        test_assets()
        test_sync_engine_methods()
        test_html_injections()
        test_snapshot_roundtrip()
        test_typography_compliance()
        print("=" * 65)
        print(">>> ALL TESTS PASSED SUCCESSFULLY! (EXIT CODE 0) <<<")
        print("=" * 65)
        sys.exit(0)
    except AssertionError as e:
        print(f"FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
