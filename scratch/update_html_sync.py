import os

files = ['inspector.html', 'index.html', 'inspector_mobile.html']
base_dir = r'C:\Users\ADMIN\Music\seemeinspect'

for fname in files:
    fpath = os.path.join(base_dir, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update script tag
    content = content.replace('assets/js/sync_engine.js?v=3.8', 'assets/js/sync_engine.js?v=3.9')
    content = content.replace('assets/js/sync_engine.js', 'assets/js/sync_engine.js?v=3.9')

    # 2. Async DOMContentLoaded
    target_dcl = 'window.addEventListener("DOMContentLoaded", () => {'
    replacement_dcl = 'window.addEventListener("DOMContentLoaded", async () => {'
    content = content.replace(target_dcl, replacement_dcl)

    target_load = 'loadSavedData();\n      if (window.SyncEngine)'
    replacement_load = 'await loadSavedData();\n      if (window.SyncEngine)'
    content = content.replace(target_load, replacement_load)

    # 3. onDataLoaded hook in loadSavedData
    old_end = 'renderClosing3DChartSlide(defectList);\n      } catch (err) {\n        console.warn("Closing 3D chart notice:", err);\n      }\n    }'
    new_end = 'renderClosing3DChartSlide(defectList);\n      } catch (err) {\n        console.warn("Closing 3D chart notice:", err);\n      }\n      if (window.SyncEngine && typeof window.SyncEngine.onDataLoaded === "function") {\n        window.SyncEngine.onDataLoaded();\n      }\n    }'
    if old_end in content:
        content = content.replace(old_end, new_end, 1)
        print(f"[{fname}] Hooked onDataLoaded successfully")
    else:
        print(f"[{fname}] Warning: old_end pattern not found")

    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"[{fname}] Successfully written")
