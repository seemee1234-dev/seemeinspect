import os
import re

base_dir = r"C:\Users\ADMIN\Music\seemeinspect"
files = ["inspector.html", "index.html", "inspector_mobile.html"]

js_zoom_code = """
    /**
     * LIVE CAMERA DUAL-ENGINE ZOOM SYSTEM (PINCH, SWIPE, PRESET BUTTONS, SLIDER)
     * Supports both Hardware Lens Zoom and Precision Canvas Digital Zoom (1.0x - 6.0x)
     */
    let liveCamZoomLevel = 1.0;
    let liveCamTouchStartY = 0;
    let liveCamPinchStartDist = 0;
    let liveCamBaseZoom = 1.0;

    async function applyCameraHardwareZoom(zoomVal) {
      if (!liveCamStream) return false;
      try {
        const track = liveCamStream.getVideoTracks()[0];
        if (!track || !track.getCapabilities) return false;
        const caps = track.getCapabilities();
        if (caps.zoom) {
          const min = caps.zoom.min || 1;
          const max = caps.zoom.max || 6;
          const clamped = Math.max(min, Math.min(max, zoomVal));
          await track.applyConstraints({ advanced: [{ zoom: clamped }] });
          return true;
        }
      } catch (e) {
        // Hardware zoom unsupported or denied; CSS/Canvas digital zoom fallback active
      }
      return false;
    }

    function setLiveCamZoom(targetZoom) {
      const clamped = Math.max(1.0, Math.min(6.0, Math.round(targetZoom * 10) / 10));
      liveCamZoomLevel = clamped;

      const video = document.getElementById("live-cam-video");
      if (video) {
        video.style.transform = `scale(${liveCamZoomLevel})`;
        video.style.transformOrigin = "center center";
      }

      // Update HUD badge
      const badge = document.getElementById("live-cam-zoom-badge");
      if (badge) {
        badge.innerHTML = `🔍 ${liveCamZoomLevel.toFixed(1)}x <span style="font-size: 10px; color: #94a3b8;">(แตะรีเซ็ต)</span>`;
        if (liveCamZoomLevel > 1.0) {
          badge.style.borderColor = "#00adf2";
          badge.style.color = "#38bdf8";
        } else {
          badge.style.borderColor = "#ffd700";
          badge.style.color = "#ffd700";
        }
      }

      // Update Preset Pills
      const presetBtns = document.querySelectorAll(".zoom-preset-pill");
      presetBtns.forEach(btn => {
        const val = parseFloat(btn.getAttribute("data-zoom") || "1.0");
        if (Math.abs(val - liveCamZoomLevel) < 0.15) {
          btn.style.border = "1.5px solid #00adf2";
          btn.style.background = "rgba(0,173,242,0.35)";
          btn.style.color = "#38bdf8";
          btn.style.fontWeight = "400";
        } else {
          btn.style.border = "1px solid rgba(255,255,255,0.2)";
          btn.style.background = "rgba(11,31,58,0.75)";
          btn.style.color = "#94a3b8";
          btn.style.fontWeight = "300";
        }
      });

      // Update vertical slider thumb
      const thumb = document.getElementById("live-cam-zoom-thumb");
      if (thumb) {
        const percent = ((liveCamZoomLevel - 1.0) / 5.0) * 100;
        thumb.style.bottom = `${percent}%`;
        thumb.textContent = `${liveCamZoomLevel.toFixed(1)}x`;
      }

      applyCameraHardwareZoom(liveCamZoomLevel);
    }

    function initLiveCamGestures() {
      const container = document.getElementById("live-cam-container");
      if (!container || container.dataset.zoomGesturesInit) return;
      container.dataset.zoomGesturesInit = "true";

      container.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          liveCamPinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          liveCamBaseZoom = liveCamZoomLevel;
        } else if (e.touches.length === 1) {
          liveCamTouchStartY = e.touches[0].clientY;
          liveCamBaseZoom = liveCamZoomLevel;
        }
      }, { passive: true });

      container.addEventListener("touchmove", (e) => {
        if (e.touches.length === 2 && liveCamPinchStartDist > 0) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          const ratio = dist / liveCamPinchStartDist;
          setLiveCamZoom(liveCamBaseZoom * ratio);
        } else if (e.touches.length === 1 && liveCamTouchStartY > 0) {
          // Swipe gesture: swipe UP increases zoom, swipe DOWN decreases zoom
          const deltaY = liveCamTouchStartY - e.touches[0].clientY;
          const zoomChange = deltaY / 45;
          setLiveCamZoom(liveCamBaseZoom + zoomChange);
        }
      }, { passive: true });

      container.addEventListener("touchend", () => {
        liveCamPinchStartDist = 0;
        liveCamTouchStartY = 0;
      }, { passive: true });

      // Mouse Wheel zoom for PC
      container.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.3 : -0.3;
        setLiveCamZoom(liveCamZoomLevel + delta);
      }, { passive: false });
    }

    /**
     * INTERACTIVE PHOTO ZOOM PREVIEW MODAL (Tap to zoom captured defect photos)
     */
    let photoZoomScale = 1.0;
    let photoZoomPanX = 0;
    let photoZoomPanY = 0;
    let pzTouchStartX = 0;
    let pzTouchStartY = 0;
    let pzPinchDist = 0;
    let pzBaseScale = 1.0;

    function openPhotoZoomPreview(imgSrc, title = 'ภาพถ่ายใกล้') {
      if (!imgSrc) return;
      const modal = document.getElementById("photo-zoom-modal");
      const target = document.getElementById("photo-zoom-target");
      const titleEl = document.getElementById("photo-zoom-title");
      if (!modal || !target) return;

      target.src = imgSrc;
      if (titleEl) titleEl.textContent = `🔍 ${title}`;
      resetPhotoZoom();
      modal.style.display = "flex";
      initPhotoZoomGestures();
    }

    function closePhotoZoomPreview() {
      const modal = document.getElementById("photo-zoom-modal");
      if (modal) modal.style.display = "none";
      const target = document.getElementById("photo-zoom-target");
      if (target) target.src = "";
    }

    function resetPhotoZoom() {
      photoZoomScale = 1.0;
      photoZoomPanX = 0;
      photoZoomPanY = 0;
      applyPhotoZoomTransform();
    }

    function adjustPhotoZoom(delta) {
      photoZoomScale = Math.max(1.0, Math.min(5.0, Math.round((photoZoomScale + delta) * 10) / 10));
      if (photoZoomScale === 1.0) {
        photoZoomPanX = 0;
        photoZoomPanY = 0;
      }
      applyPhotoZoomTransform();
    }

    function applyPhotoZoomTransform() {
      const target = document.getElementById("photo-zoom-target");
      const ind = document.getElementById("photo-zoom-indicator");
      if (target) {
        target.style.transform = `scale(${photoZoomScale}) translate(${photoZoomPanX}px, ${photoZoomPanY}px)`;
      }
      if (ind) ind.textContent = `${photoZoomScale.toFixed(1)}x`;
    }

    function initPhotoZoomGestures() {
      const viewport = document.getElementById("photo-zoom-viewport");
      if (!viewport || viewport.dataset.gesturesInit) return;
      viewport.dataset.gesturesInit = "true";

      viewport.addEventListener("touchstart", (e) => {
        if (e.touches.length === 2) {
          pzPinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
          pzBaseScale = photoZoomScale;
        } else if (e.touches.length === 1) {
          pzTouchStartX = e.touches[0].clientX;
          pzTouchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      viewport.addEventListener("touchmove", (e) => {
        if (e.touches.length === 2 && pzPinchDist > 0) {
          const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
          photoZoomScale = Math.max(1.0, Math.min(5.0, pzBaseScale * (dist / pzPinchDist)));
          applyPhotoZoomTransform();
        } else if (e.touches.length === 1 && photoZoomScale > 1.0) {
          const dx = (e.touches[0].clientX - pzTouchStartX) / photoZoomScale;
          const dy = (e.touches[0].clientY - pzTouchStartY) / photoZoomScale;
          photoZoomPanX += dx;
          photoZoomPanY += dy;
          pzTouchStartX = e.touches[0].clientX;
          pzTouchStartY = e.touches[0].clientY;
          applyPhotoZoomTransform();
        }
      }, { passive: true });

      let lastTap = 0;
      viewport.addEventListener("touchend", () => {
        pzPinchDist = 0;
        const now = Date.now();
        if (now - lastTap < 300) {
          if (photoZoomScale > 1.2) resetPhotoZoom();
          else adjustPhotoZoom(1.5);
        }
        lastTap = now;
      }, { passive: true });
    }
"""

html_viewfinder_replacement = """    <!-- Live Video Viewfinder with Darkened Mask & Golden Guide -->
    <div id="live-cam-container" style="flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; background: #000000; touch-action: none;">
      <video id="live-cam-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform-origin: center center; transition: transform 0.08s ease-out;"></video>
      
      <!-- Top HUD Zoom Badge (Tap to reset 1x) -->
      <div id="live-cam-zoom-badge" onclick="setLiveCamZoom(1.0)" style="position: absolute; top: 14px; left: 16px; background: rgba(11,31,58,0.92); border: 1.2px solid #ffd700; border-radius: 16px; padding: 3px 12px; font-family: 'Kanit', sans-serif; font-size: 12.5px; font-weight: 300; color: #ffd700; z-index: 30; cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.5);">🔍 1.0x <span style="font-size: 10px; color: #94a3b8;">(แตะรีเซ็ต)</span></div>

      <!-- Close-up Mode Swipe-to-Zoom Hint -->
      <div id="live-cam-close-hint" style="display: none; position: absolute; top: 14px; right: 16px; background: rgba(0,173,242,0.25); border: 1px solid #00adf2; border-radius: 14px; padding: 3px 12px; font-size: 11px; color: #38bdf8; font-family: 'Kanit', sans-serif; font-weight: 300; z-index: 30; letter-spacing: 0.2px;">👆 รูดนิ้วขึ้น/ลง เพื่อซูมระยะไกล</div>

      <!-- Right-Side Vertical Zoom Bar (เอานิ้วรูดขึ้น/ลง) -->
      <div id="live-cam-zoom-track" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); height: 180px; width: 44px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; z-index: 30; user-select: none;">
        <button type="button" onclick="setLiveCamZoom(liveCamZoomLevel + 0.5)" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(11,31,58,0.92); border: 1px solid #00adf2; color: #38bdf8; font-size: 16px; font-family: 'Kanit', sans-serif; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">+</button>
        <div style="position: relative; width: 6px; height: 95px; background: rgba(255,255,255,0.2); border-radius: 4px; margin: 4px 0;">
          <div id="live-cam-zoom-thumb" style="position: absolute; left: 50%; transform: translateX(-50%); bottom: 0%; min-width: 38px; height: 20px; background: #00adf2; color: #ffffff; font-family: 'Kanit', sans-serif; font-size: 10.5px; font-weight: 400; border-radius: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.6); pointer-events: none; transition: bottom 0.08s ease-out;">1.0x</div>
        </div>
        <button type="button" onclick="setLiveCamZoom(liveCamZoomLevel - 0.5)" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(11,31,58,0.92); border: 1px solid #00adf2; color: #38bdf8; font-size: 16px; font-family: 'Kanit', sans-serif; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">−</button>
      </div>

      <!-- Quick Preset Zoom Pills (1x, 2x, 3x, 5x) -->
      <div id="live-cam-zoom-pills" style="position: absolute; bottom: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 8px; z-index: 30; pointer-events: auto;">
        <button type="button" class="zoom-preset-pill" data-zoom="1.0" onclick="setLiveCamZoom(1.0)" style="padding: 4px 12px; border-radius: 16px; font-family: 'Kanit', sans-serif; font-size: 12px; font-weight: 400; border: 1.5px solid #00adf2; background: rgba(0,173,242,0.35); color: #38bdf8; cursor: pointer; backdrop-filter: blur(4px);">1.0x</button>
        <button type="button" class="zoom-preset-pill" data-zoom="2.0" onclick="setLiveCamZoom(2.0)" style="padding: 4px 12px; border-radius: 16px; font-family: 'Kanit', sans-serif; font-size: 12px; font-weight: 300; border: 1px solid rgba(255,255,255,0.2); background: rgba(11,31,58,0.75); color: #94a3b8; cursor: pointer; backdrop-filter: blur(4px);">2.0x</button>
        <button type="button" class="zoom-preset-pill" data-zoom="3.0" onclick="setLiveCamZoom(3.0)" style="padding: 4px 12px; border-radius: 16px; font-family: 'Kanit', sans-serif; font-size: 12px; font-weight: 300; border: 1px solid rgba(255,255,255,0.2); background: rgba(11,31,58,0.75); color: #94a3b8; cursor: pointer; backdrop-filter: blur(4px);">3.0x</button>
        <button type="button" class="zoom-preset-pill" data-zoom="5.0" onclick="setLiveCamZoom(5.0)" style="padding: 4px 12px; border-radius: 16px; font-family: 'Kanit', sans-serif; font-size: 12px; font-weight: 300; border: 1px solid rgba(255,255,255,0.2); background: rgba(11,31,58,0.75); color: #94a3b8; cursor: pointer; backdrop-filter: blur(4px);">5.0x</button>
      </div>

      <!-- Guide Overlay Box with Darkened Outer Mask -->
      <div id="live-cam-guide-box" style="position: absolute; width: 92%; max-width: 440px; aspect-ratio: 4 / 3; border: 2px solid #ffd700; border-radius: 12px; pointer-events: none; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), inset 0 0 20px rgba(255,215,0,0.2); display: flex; align-items: center; justify-content: center; transition: all 0.25s ease;">
        <!-- 3x3 Composition Grid -->
        <div style="position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; pointer-events: none; opacity: 0.35;">
          <div style="border-right: 1px dashed rgba(255,255,255,0.7); border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-right: 1px dashed rgba(255,255,255,0.7); border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-right: 1px dashed rgba(255,255,255,0.7); border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-right: 1px dashed rgba(255,255,255,0.7); border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-bottom: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-right: 1px dashed rgba(255,255,255,0.7);"></div>
          <div style="border-right: 1px dashed rgba(255,255,255,0.7);"></div>
          <div></div>
        </div>
        <!-- Center Reticle -->
        <div style="width: 28px; height: 28px; border: 1.5px solid rgba(255,215,0,0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <div style="width: 6px; height: 6px; background: #ffd700; border-radius: 50%;"></div>
        </div>
        <!-- Status Pill -->
        <span id="live-cam-guide-label" style="position: absolute; bottom: 8px; font-size: 11px; font-family: 'Kanit', sans-serif; font-weight: 300; color: #ffd700; background: rgba(11,31,58,0.95); border: 1px solid #ffd700; padding: 2px 10px; border-radius: 12px; letter-spacing: 0.3px;">📐 สัดส่วน 4:3 (สิ่งที่เห็นในกรอบ = รูปที่เซฟ 100%)</span>
      </div>
    </div>"""

html_photo_zoom_modal = """
  <!-- Interactive Photo Zoom Modal (Pinch & Swipe Zoom for captured photo) -->
  <div id="photo-zoom-modal" class="no-print" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 9999999; flex-direction: column; justify-content: space-between; align-items: center; user-select: none;">
    <!-- Top Header -->
    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; background: rgba(11,31,58,0.95); border-bottom: 1px solid rgba(0,173,242,0.4); font-family: 'Kanit', sans-serif;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span id="photo-zoom-title" style="color: #ffd700; font-size: 13.5px; font-weight: 300;">🔍 ดูรูปขยาย</span>
        <span id="photo-zoom-indicator" style="font-size: 11px; color: #00adf2; background: rgba(0,173,242,0.15); border: 1px solid #00adf2; padding: 2px 8px; border-radius: 12px;">1.0x</span>
      </div>
      <button type="button" onclick="closePhotoZoomPreview()" style="background: none; border: 1.2px solid rgba(255,255,255,0.4); color: #ffffff; border-radius: 16px; font-size: 12px; font-family: 'Kanit', sans-serif; font-weight: 300; padding: 3px 12px; cursor: pointer;">✕ ปิด</button>
    </div>

    <!-- Zoomable Image Viewport -->
    <div id="photo-zoom-viewport" style="flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; touch-action: none;">
      <img id="photo-zoom-target" src="" alt="ภาพขยาย" style="max-width: 95%; max-height: 85vh; object-fit: contain; transform: scale(1) translate(0px, 0px); transition: transform 0.08s ease-out; transform-origin: center center; cursor: grab;">
    </div>

    <!-- Bottom Controls -->
    <div style="width: 100%; padding: 12px 16px; background: rgba(11,31,58,0.95); border-top: 1px solid rgba(0,173,242,0.4); display: flex; justify-content: center; align-items: center; gap: 12px; font-family: 'Kanit', sans-serif;">
      <button type="button" onclick="adjustPhotoZoom(-0.5)" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #ffffff; border-radius: 16px; font-size: 13px; font-family: 'Kanit', sans-serif; padding: 5px 16px; cursor: pointer;">🔍 ย่อ (-)</button>
      <button type="button" onclick="resetPhotoZoom()" style="background: rgba(0,173,242,0.25); border: 1.5px solid #00adf2; color: #38bdf8; border-radius: 16px; font-size: 13px; font-family: 'Kanit', sans-serif; padding: 5px 18px; cursor: pointer;">↺ รีเซ็ต (1x)</button>
      <button type="button" onclick="adjustPhotoZoom(0.5)" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: #ffffff; border-radius: 16px; font-size: 13px; font-family: 'Kanit', sans-serif; padding: 5px 16px; cursor: pointer;">🔍 ขยาย (+)</button>
    </div>
  </div>
"""

for fname in files:
    fpath = os.path.join(base_dir, fname)
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Insert JS Zoom Controller above openLiveCamera
    if "let liveCamZoomLevel" not in content:
        target_open = "async function openLiveCamera(mode, index = null) {"
        content = content.replace(target_open, js_zoom_code + "\n    " + target_open, 1)

    # 2. Update openLiveCamera to initialize zoom and gestures
    target_body = "modal.style.display = \"flex\";"
    replacement_body = """modal.style.display = "flex";
      setLiveCamZoom(1.0);
      initLiveCamGestures();
      const closeHint = document.getElementById("live-cam-close-hint");
      if (closeHint) {
        closeHint.style.display = (mode === 'close' || mode === 'edit_close' || mode === 'edit_before') ? "block" : "none";
      }"""
    if "setLiveCamZoom(1.0);" not in content:
        content = content.replace(target_body, replacement_body, 1)

    # 3. Update captureLiveCamPhoto to calculate crop with liveCamZoomLevel
    old_out_dim = """      // Output size: 840px max dimension for 150+ field photos (~45-55KB per photo)
      const maxDim = 840;"""
    new_out_dim = """      // Apply Live Digital Zoom factor to crop boundaries (1.0x - 6.0x)
      if (liveCamZoomLevel > 1.0) {
        const zW = cropW / liveCamZoomLevel;
        const zH = cropH / liveCamZoomLevel;
        const cX = cropX + (cropW - zW) / 2;
        const cY = cropY + (cropH - zH) / 2;
        cropX = Math.max(0, Math.min(vW - 1, Math.round(cX)));
        cropY = Math.max(0, Math.min(vH - 1, Math.round(cY)));
        cropW = Math.max(10, Math.min(vW - cropX, Math.round(zW)));
        cropH = Math.max(10, Math.min(vH - cropY, Math.round(zH)));
      }

      // Output size: 840px max dimension for 150+ field photos (~45-55KB per photo)
      const maxDim = 840;"""
    if "liveCamZoomLevel > 1.0" not in content:
        content = content.replace(old_out_dim, new_out_dim, 1)

    # 4. Replace live-cam-container HTML with full zoom controls
    old_viewfinder_regex = r'<div id="live-cam-container".*?<!-- Bottom Shutter Bar -->'
    # Let's find exact boundary
    start_str = '    <!-- Live Video Viewfinder with Darkened Mask & Golden Guide -->'
    end_str = '    <!-- Bottom Shutter Bar -->'
    if start_str in content and end_str in content:
        s_idx = content.find(start_str)
        e_idx = content.find(end_str)
        content = content[:s_idx] + html_viewfinder_replacement + "\n\n" + content[e_idx:]

    # 5. Add photo-zoom-modal after live-cam-modal
    if "id=\"photo-zoom-modal\"" not in content:
        cam_modal_close = "  </div>\n\n  <!-- Share Report Modal"
        content = content.replace(cam_modal_close, "  </div>\n" + html_photo_zoom_modal + "\n  <!-- Share Report Modal", 1)

    # 6. Add onclick to photo-close-preview and photo-wide-preview
    content = content.replace('id="photo-close-preview" class="photo-preview-img" alt="ภาพใกล้"', 'id="photo-close-preview" class="photo-preview-img" alt="ภาพใกล้" onclick="event.stopPropagation(); openPhotoZoomPreview(this.src, \'ภาพถ่ายใกล้ (Close-up)\')" title="แตะเพื่อซูมดูรูปขยาย"')
    content = content.replace('id="photo-wide-preview" class="photo-preview-img" alt="ภาพกว้าง"', 'id="photo-wide-preview" class="photo-preview-img" alt="ภาพกว้าง" onclick="event.stopPropagation(); openPhotoZoomPreview(this.src, \'ภาพถ่ายกว้าง (Overview)\')" title="แตะเพื่อซูมดูรูปขยาย"')

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[{fname}] Successfully injected Camera Zoom Engine & Preview Lightbox")
