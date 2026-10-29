/**
 * INSPECT Q • Cross-Device Live Auto-Sync Engine (v3.4)
 * Supports:
 * 1. P2P Realtime WebRTC Live Sync via PeerJS (Host / Client mode with STUN NAT Traversal)
 * 2. Smart Device Role Detection: Mobile defaults to Host, PC/Desktop defaults to Client
 * 3. 100% Scope-Safe Snapshot Extraction via window.getDefectList() & window.setDefectList()
 * 4. 1-Click Offline Backup Export & Import (.json full bundle with high-res photos)
 */

(function (window) {
  "use strict";

  const STORAGE_PIN_KEY = "inspectq_sync_pin";
  const STORAGE_ROLE_KEY = "inspectq_sync_role";

  // Smart Device Role: Mobile defaults to Host (sender), PC/Desktop defaults to Client (receiver)
  const isDesktop = window.innerWidth > 900 || !(/Mobi|Android|iPhone/i.test(navigator.userAgent));
  let _role = localStorage.getItem(STORAGE_ROLE_KEY) || (isDesktop ? "client" : "host");
  let _pin = localStorage.getItem(STORAGE_PIN_KEY) || "8888";

  let _peer = null;
  let _activeConnections = [];
  let _status = "offline"; // "offline", "connecting", "connected"
  let _clientRetryTimer = null;
  let _lastSyncTimestamp = 0;

  const PEER_CONFIG = {
    debug: 1,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" }
      ]
    }
  };

  const SyncEngine = {
    get pin() { return _pin; },
    get status() { return _status; },
    get role() { return _role; },
    get connectedCount() { return _activeConnections.length; },

    init: function () {
      console.log("📡 [SyncEngine v3.4] Initializing. Role:", _role, "PIN:", _pin, "isDesktop:", isDesktop);
      this.setupAutoSyncHooks();
      this.setupUnloadHandler();
      this.connectP2P();
    },

    setupUnloadHandler: function () {
      window.addEventListener("beforeunload", () => {
        if (_peer) {
          try {
            _peer.disconnect();
            _peer.destroy();
          } catch (e) {}
        }
      });
    },

    setPin: function (newPin) {
      if (!newPin || newPin.trim().length < 3) {
        alert("⚠️ กรุณากำหนดรหัส PIN อย่างน้อย 3-6 ตัวอักษรครับ");
        return;
      }
      _pin = newPin.trim();
      localStorage.setItem(STORAGE_PIN_KEY, _pin);
      this.reconnect();
    },

    setRole: function (newRole) {
      _role = newRole;
      localStorage.setItem(STORAGE_ROLE_KEY, _role);
      this.updateRoleUI();
      this.reconnect();
      this.showToast(_role === "host" ? "📱 เปลี่ยนเป็น: เครื่องตรวจหลัก (มือถือ)" : "💻 เปลี่ยนเป็น: เครื่องรับข้อมูล (คอม/แท็บเล็ต)");
    },

    updateRoleUI: function () {
      const hostBtn = document.getElementById("role-btn-host");
      const clientBtn = document.getElementById("role-btn-client");
      if (hostBtn && clientBtn) {
        if (_role === "host") {
          hostBtn.style.border = "2px solid #10b981";
          hostBtn.style.background = "rgba(16, 185, 129, 0.25)";
          hostBtn.style.color = "#34d399";
          clientBtn.style.border = "1.5px solid #1e3a8a";
          clientBtn.style.background = "#070d1e";
          clientBtn.style.color = "#94a3b8";
        } else {
          clientBtn.style.border = "2px solid #00adf2";
          clientBtn.style.background = "rgba(0, 173, 242, 0.25)";
          clientBtn.style.color = "#38bdf8";
          hostBtn.style.border = "1.5px solid #1e3a8a";
          hostBtn.style.background = "#070d1e";
          hostBtn.style.color = "#94a3b8";
        }
      }
    },

    reconnect: function () {
      if (_clientRetryTimer) {
        clearTimeout(_clientRetryTimer);
        _clientRetryTimer = null;
      }
      if (_peer) {
        try {
          _peer.disconnect();
          _peer.destroy();
        } catch (e) { }
        _peer = null;
      }
      _activeConnections = [];
      this.updateStatus("connecting", "กำลังเริ่มการเชื่อมต่อใหม่...");
      this.connectP2P();
    },

    connectP2P: function () {
      if (typeof Peer === "undefined") {
        console.warn("PeerJS library not loaded, attempting CDN fallback...");
        const s = document.createElement("script");
        s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
        s.onload = () => this.connectP2P();
        document.head.appendChild(s);
        return;
      }

      this.updateRoleUI();
      const cleanPin = _pin.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "8888";
      const hostPeerId = `inspectq_host_${cleanPin}`;
      const clientPeerId = `inspectq_client_${cleanPin}_${Math.random().toString(36).substring(2, 7)}`;

      if (_role === "client") {
        this.initClient(clientPeerId, hostPeerId);
      } else {
        this.initHost(hostPeerId, clientPeerId);
      }
    },

    initHost: function (hostPeerId) {
      this.updateStatus("connecting", "กำลังลงทะเบียนเครื่องหลัก...");
      _peer = new Peer(hostPeerId, PEER_CONFIG);

      _peer.on("open", (id) => {
        console.log("📱 [SyncEngine] HOST Active:", id);
        this.updateStatus("connected", "📱 เครื่องหลักหน้างาน (รอเครื่องรับเชื่อมต่อ...)");
        this.listenForClients();
      });

      _peer.on("error", (err) => {
        console.warn("Host Peer error:", err);
        if (err.type === "unavailable-id") {
          console.log("⚠️ Host ID locked by previous session. Retrying in 2.5s...");
          this.updateStatus("connecting", "รหัสเครื่องหลักกำลังรีเซ็ต... กำลังลองใหม่ใน 2.5 วิ");
          setTimeout(() => {
            if (_role === "host") this.reconnect();
          }, 2500);
        } else {
          this.updateStatus("offline", "เครื่องหลักเกิดข้อผิดพลาด: " + err.type);
        }
      });
    },

    listenForClients: function () {
      if (!_peer) return;
      _peer.on("connection", (conn) => {
        console.log("🔗 [SyncEngine] Client connected:", conn.peer);
        this.setupConnection(conn, true);
      });
    },

    initClient: function (clientPeerId, hostPeerId) {
      if (_clientRetryTimer) clearTimeout(_clientRetryTimer);
      this.updateStatus("connecting", `💻 กำลังค้นหาเครื่องหลัก (PIN ${_pin})...`);

      _peer = new Peer(clientPeerId, PEER_CONFIG);

      _peer.on("open", (myId) => {
        console.log("💻 [SyncEngine] CLIENT Active:", myId, "connecting to host:", hostPeerId);
        this.attemptConnectToHost(hostPeerId);
      });

      _peer.on("error", (err) => {
        console.warn("Client Peer error:", err);
        if (err.type === "peer-unavailable") {
          this.updateStatus("connecting", `🟡 ยังไม่พบเครื่องหลัก PIN ${_pin} (กำลังค้นหาต่อ...)`);
          this.scheduleClientRetry(hostPeerId);
        } else {
          this.updateStatus("offline", "เครื่องรับเกิดข้อผิดพลาด: " + err.type);
        }
      });
    },

    attemptConnectToHost: function (hostPeerId) {
      if (!_peer || _peer.destroyed) return;
      try {
        console.log("🔄 [SyncEngine] Calling host:", hostPeerId);
        const conn = _peer.connect(hostPeerId, { reliable: true });
        this.setupConnection(conn, false);

        setTimeout(() => {
          if (_activeConnections.length === 0 && _status !== "connected" && _role === "client") {
            this.scheduleClientRetry(hostPeerId);
          }
        }, 5000);
      } catch (e) {
        console.warn("connect error:", e);
        this.scheduleClientRetry(hostPeerId);
      }
    },

    scheduleClientRetry: function (hostPeerId) {
      if (_clientRetryTimer) clearTimeout(_clientRetryTimer);
      _clientRetryTimer = setTimeout(() => {
        if (_activeConnections.length === 0 && _role === "client") {
          console.log("🔄 [SyncEngine] Auto-retrying to find host...");
          this.attemptConnectToHost(hostPeerId);
        }
      }, 3500);
    },

    setupConnection: function (conn, isHost) {
      conn.on("open", () => {
        console.log("🟢 [SyncEngine] DataChannel OPEN with:", conn.peer);
        if (!_activeConnections.includes(conn)) {
          _activeConnections.push(conn);
        }
        this.updateStatus("connected", `🟢 ซิงก์สดเรียบร้อย (${_activeConnections.length} เครื่อง)`);

        if (isHost) {
          // Push current state to newly connected client immediately
          this.pushFullStateToConn(conn);
          this.showToast("🔗 เครื่องรับเชื่อมต่อแล้ว! ส่งข้อมูลสดเรียบร้อย");
        } else {
          // Request current state from host immediately
          conn.send({ type: "REQ_FULL_STATE" });
          this.showToast("🔗 เชื่อมต่อเครื่องหลักแล้ว! กำลังดึงข้อมูลล่าสุด...");
        }
      });

      conn.on("data", (payload) => {
        this.handleIncomingData(payload, conn);
      });

      conn.on("close", () => {
        console.log("🔴 [SyncEngine] Connection closed:", conn.peer);
        _activeConnections = _activeConnections.filter(c => c !== conn);
        if (_activeConnections.length === 0) {
          if (isHost) {
            this.updateStatus("connected", "📱 เครื่องหลักหน้างาน (รอเครื่องรับเชื่อมต่อ...)");
          } else {
            this.updateStatus("connecting", `🟡 เครื่องหลักตัดการเชื่อมต่อ กำลังรอเชื่อมต่อใหม่...`);
            const cleanPin = _pin.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "8888";
            this.scheduleClientRetry(`inspectq_host_${cleanPin}`);
          }
        } else {
          this.updateStatus("connected", `🟢 ซิงก์สดเรียบร้อย (${_activeConnections.length} เครื่อง)`);
        }
      });

      conn.on("error", (e) => {
        console.warn("Conn error:", e);
      });
    },

    broadcastMutation: function (action, data) {
      if (_activeConnections.length === 0) return;

      const payload = {
        type: "MUTATION",
        action: action,
        data: data,
        timestamp: Date.now()
      };

      _activeConnections.forEach(conn => {
        if (conn.open) {
          try {
            conn.send(payload);
          } catch (err) {
            console.warn("Send payload error:", err);
          }
        }
      });
    },

    pushFullStateToConn: function (conn) {
      if (!conn || !conn.open) return;
      const fullSnapshot = this.getFullSnapshot();
      conn.send({
        type: "FULL_STATE_SNAPSHOT",
        payload: fullSnapshot,
        timestamp: Date.now()
      });
      console.log("📤 [SyncEngine] Sent FULL_STATE_SNAPSHOT with", fullSnapshot.defectList.length, "defects to:", conn.peer);
    },

    pushNow: function () {
      if (_activeConnections.length === 0) {
        alert("⚠️ ยังไม่มีเครื่องอื่นเชื่อมต่ออยู่ในรหัส PIN นี้ครับ\nกรุณาตั้งเครื่องตรวจเป็น 'เครื่องหลัก' และตั้งคอมเป็น 'เครื่องรับ' โดยใช้ PIN เดียวกัน: " + _pin);
        return;
      }
      const fullSnapshot = this.getFullSnapshot();
      _activeConnections.forEach(conn => {
        if (conn.open) {
          conn.send({
            type: "FULL_STATE_SNAPSHOT",
            payload: fullSnapshot,
            timestamp: Date.now()
          });
        }
      });
      this.showToast(`🚀 ส่งข้อมูล ${fullSnapshot.defectList.length} จุดไปยังเครื่องอื่นสำเร็จ!`);
    },

    pullNow: function () {
      if (_activeConnections.length === 0) {
        alert("⚠️ ยังไม่ได้เชื่อมต่อกับเครื่องหลักครับ\nระบบกำลังค้นหาเครื่องหลัก PIN: " + _pin);
        return;
      }
      _activeConnections.forEach(conn => {
        if (conn.open) conn.send({ type: "REQ_FULL_STATE" });
      });
      this.showToast("🔄 ส่งคำขอดึงข้อมูลล่าสุดจากเครื่องตรวจแล้ว...");
    },

    handleIncomingData: async function (msg, senderConn) {
      if (!msg || !msg.type) return;

      if (msg.type === "REQ_FULL_STATE") {
        console.log("📥 [SyncEngine] Received REQ_FULL_STATE from:", senderConn.peer);
        this.pushFullStateToConn(senderConn);
        return;
      }

      if (msg.type === "FULL_STATE_SNAPSHOT" || (msg.type === "MUTATION" && msg.action === "SAVE_DEFECTS")) {
        const snapshot = msg.payload || msg.data;
        if (!snapshot) return;

        const count = Array.isArray(snapshot.defectList) ? snapshot.defectList.length : 0;
        console.log("📥 [SyncEngine] Received defects state with", count, "defects!");
        await this.applyIncomingSnapshot(snapshot);
        this.showToast(`✨ รับข้อมูลอัปเดตอัตโนมัติแล้ว (${count} จุด)`);
      }

      if (msg.type === "MUTATION" && msg.action === "SAVE_CONFIG") {
        if (msg.data && msg.data.projectConfig) {
          if (typeof window.setProjectConfig === "function") {
            window.setProjectConfig(msg.data.projectConfig);
          }
          localStorage.setItem("condo_inspect_cfg", JSON.stringify(msg.data.projectConfig));
          if (typeof window.updateSummaryUI === "function") window.updateSummaryUI();
          this.showToast("📝 อัปเดตข้อมูลห้องและลูกค้าอัตโนมัติแล้ว");
        }
      }
    },

    applyIncomingSnapshot: async function (snapshot) {
      try {
        if (!snapshot) return;

        // 1. Project Config
        if (snapshot.projectConfig) {
          if (typeof window.setProjectConfig === "function") {
            window.setProjectConfig(snapshot.projectConfig);
          }
          localStorage.setItem("condo_inspect_cfg", JSON.stringify(snapshot.projectConfig));
          this.fillConfigInputs(snapshot.projectConfig);
        }

        // 2. Defect List (CRITICAL: Save to both scope variable and IndexedDB)
        if (Array.isArray(snapshot.defectList)) {
          if (typeof window.setDefectList === "function") {
            window.setDefectList(snapshot.defectList);
          }
          window.defectList = snapshot.defectList;

          // Save to IndexedDB so refresh (F5) retains data permanently
          if (typeof window.openInspectorDB === "function") {
            try {
              const db = await window.openInspectorDB();
              await new Promise((resolve) => {
                const tx = db.transaction("defects", "readwrite");
                const store = tx.objectStore("defects");
                store.put({ key: "condo_defect_list", data: snapshot.defectList });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
              });
            } catch (idbErr) {
              console.warn("Sync IDB save error:", idbErr);
            }
          }

          // Fallback to localStorage if small
          try {
            if (snapshot.defectList.length <= 20) {
              localStorage.setItem("condo_defect_list", JSON.stringify(snapshot.defectList));
            }
          } catch (e) {}
        }

        // 3. Completed Rooms
        if (snapshot.completedRooms) {
          if (typeof window.setCompletedRooms === "function") {
            window.setCompletedRooms(snapshot.completedRooms);
          }
          localStorage.setItem("condo_completed_rooms", JSON.stringify(snapshot.completedRooms));
        }

        // 4. Site Attendance
        if (snapshot.siteAttendance) {
          if (typeof window.setSiteAttendance === "function") {
            window.setSiteAttendance(snapshot.siteAttendance);
          }
          localStorage.setItem("condo_site_attendance", JSON.stringify(snapshot.siteAttendance));
        }

        // 5. Trigger all UI updates
        if (typeof window.renderRoomButtons === "function") window.renderRoomButtons();
        if (typeof window.renderCategoryButtons === "function") window.renderCategoryButtons();
        if (typeof window.updateCurrentRoomDisplay === "function") window.updateCurrentRoomDisplay();
        if (typeof window.updateNextDefectCode === "function") window.updateNextDefectCode();
        if (typeof window.updateSummaryUI === "function") window.updateSummaryUI();
        if (typeof window.renderSavedRoomsList === "function") window.renderSavedRoomsList();
        if (typeof window.flashOfflineSavedIndicator === "function") window.flashOfflineSavedIndicator();

        _lastSyncTimestamp = Date.now();
      } catch (err) {
        console.error("Failed to apply snapshot:", err);
      }
    },

    fillConfigInputs: function (cfg) {
      const map = {
        "cfg-proj-name": cfg.projName,
        "cfg-room-no": cfg.roomNo,
        "cfg-cust-name": cfg.custName,
        "cfg-phone": cfg.phone,
        "cfg-inspector": cfg.inspector,
        "cfg-room-size": cfg.roomSize,
        "cfg-inspect-date": cfg.inspectDate,
        "cfg-reinspect-date": cfg.reinspectDate
      };
      for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
      }
    },

    getFullSnapshot: function () {
      const dList = typeof window.getDefectList === "function" ? window.getDefectList() : (window.defectList || []);
      const pCfg = typeof window.getProjectConfig === "function" ? window.getProjectConfig() : (window.projectConfig || {});
      const cRooms = typeof window.getCompletedRooms === "function" ? window.getCompletedRooms() : (window.completedRooms || {});
      const sAtt = typeof window.getSiteAttendance === "function" ? window.getSiteAttendance() : (window.siteAttendance || {});
      const cCustom = typeof window.getCustomRooms === "function" ? window.getCustomRooms() : (window.customRooms || []);
      return {
        projectConfig: pCfg,
        defectList: dList,
        completedRooms: cRooms,
        customRooms: cCustom,
        customCategories: window.customCategories || [],
        siteAttendance: sAtt,
        exportedAt: new Date().toISOString()
      };
    },

    setupAutoSyncHooks: function () {
      // Direct broadcast hooks are also wired inside saveDefectsToStorage() and saveConfig()
    },

    exportOfflineBackup: function () {
      const snapshot = this.getFullSnapshot();
      const pName = (snapshot.projectConfig.projName || "Condo").replace(/\s+/g, "_");
      const rNo = (snapshot.projectConfig.roomNo || "Room").replace(/[\s\/]/g, "-");
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `INSPECT_Q_${pName}_${rNo}_${dateStr}_FULL_BACKUP.json`;

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      this.showToast(`💾 บันทึกไฟล์สำรอง ${filename} เรียบร้อย!`);
    },

    importOfflineBackup: function (file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          await this.applyIncomingSnapshot(data);
          this.broadcastMutation("SAVE_DEFECTS", this.getFullSnapshot());
          const count = Array.isArray(data.defectList) ? data.defectList.length : 0;
          this.showToast(`🎉 นำเข้าข้อมูลห้องสำเร็จ! (${count} จุด)`);
        } catch (err) {
          alert("❌ ไฟล์ไม่ถูกต้องหรือเกิดข้อผิดพลาด: " + err.message);
        }
      };
      reader.readAsText(file);
    },

    updateStatus: function (status, note) {
      _status = status;
      const iconEl = document.getElementById("sync-icon");
      const labelEl = document.getElementById("sync-label");
      const modalStatusEl = document.getElementById("sync-modal-status");

      let color = "#94a3b8";
      let icon = "🔄";
      let text = "ออฟไลน์";

      const roleThai = _role === "host" ? "หลัก" : "รับ";

      if (status === "connected") {
        color = "#10b981";
        icon = "🟢";
        text = note || (_role === "host" ? "📱 เครื่องหลัก (พร้อมส่งข้อมูล)" : "💻 ซิงก์สดเรียบร้อย");
      } else if (status === "connecting") {
        color = "#f59e0b";
        icon = "🟡";
        text = note || "กำลังเชื่อมต่อ...";
      } else {
        color = "#ef4444";
        icon = "⚪";
        text = note || "ยังไม่เชื่อมต่อ";
      }

      if (iconEl) iconEl.textContent = icon;
      if (labelEl) labelEl.textContent = status === "connected" ? `ซิงก์สด (${roleThai})` : `ซิงก์ (${roleThai})`;
      if (modalStatusEl) {
        modalStatusEl.innerHTML = `<span style="color: ${color}; font-weight: 400;">${icon} ${text}</span>`;
      }
    },

    showToast: function (msg) {
      let toast = document.getElementById("sync-engine-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "sync-engine-toast";
        toast.style.cssText = "position: fixed; top: 75px; left: 50%; transform: translateX(-50%); background: rgba(8, 16, 36, 0.95); border: 1.5px solid #10b981; color: #ffffff; padding: 8px 18px; border-radius: 20px; font-size: 13px; font-family: 'Kanit', sans-serif; font-weight: 300; z-index: 99999; box-shadow: 0 4px 16px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 8px; transition: opacity 0.3s ease; pointer-events: none;";
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = "flex";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => { toast.style.display = "none"; }, 350);
      }, 3000);
    }
  };

  window.SyncEngine = SyncEngine;

})(window);
