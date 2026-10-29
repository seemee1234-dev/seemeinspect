import os

files = ['inspector.html', 'index.html', 'inspector_mobile.html']
base_dir = r'C:\Users\ADMIN\Music\seemeinspect'

bad_block = """      const modal = document.getElementById("room-summary-modal");
      if (modal) modal.style.display = "flex";
      setLiveCamZoom(1.0);
      initLiveCamGestures();
      const closeHint = document.getElementById("live-cam-close-hint");
      if (closeHint) {
        closeHint.style.display = (mode === 'close' || mode === 'edit_close' || mode === 'edit_before') ? "block" : "none";
      }
    }"""

clean_block = """      const modal = document.getElementById("room-summary-modal");
      if (modal) modal.style.display = "flex";
    }"""

correct_cam_injection = """      applyLiveCamAspectUI();
      modal.style.display = "flex";
      setLiveCamZoom(1.0);
      initLiveCamGestures();
      const closeHint = document.getElementById("live-cam-close-hint");
      if (closeHint) {
        closeHint.style.display = (mode === 'close' || mode === 'edit_close' || mode === 'edit_before') ? "block" : "none";
      }"""

for fname in files:
    fpath = os.path.join(base_dir, fname)
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    # Normalize newlines
    content = content.replace("\r\n", "\n")

    # 1. Clean up bad block in openRoomSummaryModal
    if bad_block in content:
        content = content.replace(bad_block, clean_block)
        print(f"[{fname}] Successfully cleaned up openRoomSummaryModal")
    else:
        print(f"[{fname}] Warning: bad_block not found")

    # 2. Inject correctly into openLiveCamera
    target_cam = '      applyLiveCamAspectUI();\n      modal.style.display = "flex";'
    if target_cam in content:
        content = content.replace(target_cam, correct_cam_injection, 1)
        print(f"[{fname}] Successfully injected zoom initialization into openLiveCamera")

    # 3. Update script tag to v4.0
    content = content.replace('assets/js/sync_engine.js?v=3.9', 'assets/js/sync_engine.js?v=4.0')
    content = content.replace('assets/js/sync_engine.js?v=3.8', 'assets/js/sync_engine.js?v=4.0')

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[{fname}] Finished writing updates")
