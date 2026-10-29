/**
 * INSPECT Q • Cross-Device Live Auto-Sync Engine (v3.2)
 * Supports:
 * 1. P2P Realtime WebRTC Live Sync via PeerJS (Instant cross-device auto-update, zero server quota)
 * 2. 1-Click Offline Backup Export & Import (.json full bundle with high-res photos)
 * 3. Cloud Sync Extension Ready (Google Firebase Firestore / Realtime DB)
 */

(function (window) {
  "use strict";

  const STORAGE_PIN_KEY = "inspectq_sync_pin";
  const STORAGE_ROLE_KEY = "inspectq_sync_role";
  const STORAGE_FIREBASE_KEY = "inspectq_firebase_cfg";

  let _pin = localStorage.getItem(STORAGE_PIN_KEY) || "8888";
  let _role = localStorage.getItem(STORAGE_ROLE_KEY) || "auto"; // "auto", "host", "client"
  let _peer = null;
  let _activeConnections = [];
  let _status = "offline"; // "offline", "connecting", "connected"
  let _lastSyncTimestamp = 0;

  const SyncEngine = {
    get pin() { return _pin; },
    get status() { return _status; },
    get role() { return _role; },
    get connectedCount() { return _activeConnections.length; },

    init: function () {
      console.log("📡 [SyncEngine] Initializing with PIN:", _pin, "Role:", _role);
      this.setupAutoSyncHooks();
      this.connectP2P();
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
      this.reconnect();
    },

    reconnect: function () {
      if (_peer) {
        try { _peer.destroy(); } catch (e) { }
        _peer = null;
      }
      _activeConnections = [];
      this.updateStatus("connecting");
      this.connectP2P();
    },

    /**
     * Connect via PeerJS (WebRTC P2P DataChannel)
     */
    connectP2P: function () {
      if (typeof Peer === "undefined") {
        console.warn("PeerJS library not loaded, attempting CDN fallback...");
        const s = document.createElement("script");
        s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
        s.onload = () => this.connectP2P();
        document.head.appendChild(s);
        return;
      }

      this.updateStatus("connecting");

      const cleanPin = _pin.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "8888";
      const hostPeerId = `inspectq_host_${cleanPin}`;
      const clientPeerId = `inspectq_client_${cleanPin}_${Math.random().toString(36).substring(2, 7)}`;

      if (_role === "client") {
        this.initClient(clientPeerId, hostPeerId);
      } else if (_role === "host") {
        this.initHost(hostPeerId);
      } else {
        // AUTO MODE: Try Host first. If host ID is taken, automatically switch to Client
        _peer = new Peer(hostPeerId, { debug: 1 });

        _peer.on("open", (id) => {
          console.log("📱 [SyncEngine] Registered as PRIMARY HOST:", id);
          this.updateStatus("connected", "โหมดเครื่องหลัก (รอเชื่อมต่อ)");
          this.listenForClients();
        });

        _peer.on("error", (err) => {
          if (err.type === "unavailable-id") {
            console.log("💻 [SyncEngine] Host already active, registering as VIEWER CLIENT...");
            try { _peer.destroy(); } catch (e) { }
            this.initClient(clientPeerId, hostPeerId);
          } else {
            console.warn("Peer error:", err);
            this.updateStatus("offline", "เชื่อมต่อไม่ได้ (" + err.type + ")");
          }
        });
      }
    },

    initHost: function (hostPeerId) {
      _peer = new Peer(hostPeerId, { debug: 1 });
      _peer.on("open", (id) => {
        console.log("📱 [SyncEngine] HOST Active:", id);
        this.updateStatus("connected", "เครื่องหลักหน้างาน (พร้อมส่งข้อมูล)");
        this.listenForClients();
      });
      _peer.on("error", (err) => {
        console.warn("Host Peer error:", err);
        this.updateStatus("offline", "ข้อผิดพลาดเครื่องหลัก: " + err.type);
      });
    },

    listenForClients: function () {
      _peer.on("connection", (conn) => {
        console.log("🔗 [SyncEngine] Client connected:", conn.peer);
        this.setupConnection(conn, true);
      });
    },

    initClient: function (clientPeerId, hostPeerId) {
      _peer = new Peer(clientPeerId, { debug: 1 });
      _peer.on("open", (myId) => {
        console.log("💻 [SyncEngine] CLIENT Active:", myId, "connecting to host:", hostPeerId);
        const conn = _peer.connect(hostPeerId, { reliable: true });
        this.setupConnection(conn, false);
      });
      _peer.on("error", (err) => {
        console.warn("Client Peer error:", err);
        this.updateStatus("offline", "ไม่พบเครื่องหลัก (" + hostPeerId + ")");
      });
    },

    setupConnection: function (conn, isHost) {
      conn.on("open", () => {
        console.log("🟢 [SyncEngine] DataChannel OPEN with:", conn.peer);
        if (!_activeConnections.includes(conn)) {
          _activeConnections.push(conn);
        }
        this.updateStatus("connected", `ซิงก์สดแล้ว (${_activeConnections.length} เครื่อง)`);

        if (isHost) {
          // As host, immediately push our full dataset to the newly connected client
          this.pushFullStateToConn(conn);
        } else {
          // Request initial state from host
          conn.send({ type: "REQ_FULL_STATE" });
        }
      });

      conn.on("data", (payload) => {
        this.handleIncomingData(payload, conn);
      });

      conn.on("close", () => {
        console.log("🔴 [SyncEngine] Connection closed:", conn.peer);
        _activeConnections = _activeConnections.filter(c => c !== conn);
        if (_activeConnections.length === 0) {
          this.updateStatus("connected", "รอเครื่องอื่นเชื่อมต่อ...");
        } else {
          this.updateStatus("connected", `ซิงก์สดแล้ว (${_activeConnections.length} เครื่อง)`);
        }
      });

      conn.on("error", (e) => {
        console.warn("Conn error:", e);
      });
    },

    /**
     * Broadcast mutation event to all connected peers
     */
    broadcastMutation: function (action, data) {
      if (_activeConnections.length === 0) return;

      const payload = {
        type: "MUTATION",
        action: action,
        data: data,
        timestamp: Date.now()
      };

      console.log(`📡 [SyncEngine] Broadcasting ${action} to ${_activeConnections.length} peers...`);
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

    /**
     * Push full snapshot to a specific connection
     */
    pushFullStateToConn: function (conn) {
      if (!conn || !conn.open) return;
      const fullSnapshot = this.getFullSnapshot();
      conn.send({
        type: "FULL_STATE_SNAPSHOT",
        payload: fullSnapshot,
        timestamp: Date.now()
      });
      console.log("📤 [SyncEngine] Sent FULL_STATE_SNAPSHOT to:", conn.peer);
    },

    /**
     * Push full snapshot to all active connections
     */
    pushNow: function () {
      if (_activeConnections.length === 0) {
        alert("⚠️ ยังไม่มีเครื่องอื่นเชื่อมต่ออยู่ในรหัส PIN นี้ครับ\nกรุณาเปิดหน้าเว็บนี้บนอีกเครื่องและใส่ PIN เดียวกัน: " + _pin);
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

    /**
     * Request full state from host
     */
    pullNow: function () {
      if (_activeConnections.length === 0) {
        alert("⚠️ ยังไม่มีเครื่องหลักเชื่อมต่ออยู่ครับ");
        return;
      }
      _activeConnections.forEach(conn => {
        if (conn.open) conn.send({ type: "REQ_FULL_STATE" });
      });
      this.showToast("🔄 ส่งคำขอดึงข้อมูลล่าสุดจากเครื่องตรวจแล้ว...");
    },

    /**
     * Handle incoming data packet
     */
    handleIncomingData: async function (msg, senderConn) {
      if (!msg || !msg.type) return;

      if (msg.type === "REQ_FULL_STATE") {
        console.log("📥 [SyncEngine] Received REQ_FULL_STATE from:", senderConn.peer);
        this.pushFullStateToConn(senderConn);
        return;
      }

      if (msg.type === "FULL_STATE_SNAPSHOT" || (msg.type === "MUTATION" && msg.action === "SAVE_DEFECTS")) {
        console.log("📥 [SyncEngine] Applying incoming defects state...");
        const snapshot = msg.payload || msg.data;
        if (!snapshot) return;

        await this.applyIncomingSnapshot(snapshot);
        this.showToast(`✨ รับข้อมูลอัปเดตอัตโนมัติแล้ว (${window.defectList ? window.defectList.length : 0} จุด)`);
      }

      if (msg.type === "MUTATION" && msg.action === "SAVE_CONFIG") {
        if (msg.data && msg.data.projectConfig) {
          window.projectConfig = Object.assign(window.projectConfig || {}, msg.data.projectConfig);
          localStorage.setItem("condo_inspect_cfg", JSON.stringify(window.projectConfig));
          if (typeof window.updateSummaryUI === "function") window.updateSummaryUI();
          this.showToast("📝 อัปเดตข้อมูลห้องและลูกค้าอัตโนมัติแล้ว");
        }
      }
    },

    /**
     * Apply snapshot to local IndexedDB and DOM
     */
    applyIncomingSnapshot: async function (snapshot) {
      try {
        if (snapshot.projectConfig && window.projectConfig) {
          window.projectConfig = Object.assign(window.projectConfig, snapshot.projectConfig);
          localStorage.setItem("condo_inspect_cfg", JSON.stringify(window.projectConfig));
          this.fillConfigInputs(window.projectConfig);
        }

        if (Array.isArray(snapshot.defectList)) {
          window.defectList = snapshot.defectList;
          // Save to IndexedDB
          if (typeof window.openInspectorDB === "function") {
            const db = await window.openInspectorDB();
            await new Promise((resolve) => {
              const tx = db.transaction("defects", "readwrite");
              const store = tx.objectStore("defects");
              store.put({ key: "condo_defect_list", data: window.defectList });
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
            });
          }
        }

        if (snapshot.completedRooms && window.completedRooms) {
          window.completedRooms = snapshot.completedRooms;
          localStorage.setItem("condo_completed_rooms", JSON.stringify(window.completedRooms));
        }

        if (snapshot.siteAttendance && window.siteAttendance) {
          window.siteAttendance = Object.assign(window.siteAttendance, snapshot.siteAttendance);
          localStorage.setItem("condo_site_attendance", JSON.stringify(window.siteAttendance));
        }

        // Trigger UI refresh
        if (typeof window.updateSummaryUI === "function") {
          window.updateSummaryUI();
        }
        if (typeof window.flashOfflineSavedIndicator === "function") {
          window.flashOfflineSavedIndicator();
        }
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
      return {
        projectConfig: window.projectConfig || {},
        defectList: window.defectList || [],
        completedRooms: window.completedRooms || {},
        customRooms: window.customRooms || [],
        customCategories: window.customCategories || [],
        siteAttendance: window.siteAttendance || {},
        exportedAt: new Date().toISOString()
      };
    },

    /**
     * Intercept app mutations and auto-broadcast
     */
    setupAutoSyncHooks: function () {
      // 1. Hook saveDefectsToStorage
      if (typeof window.saveDefectsToStorage === "function") {
        const origSaveDefects = window.saveDefectsToStorage;
        window.saveDefectsToStorage = async (...args) => {
          const res = await origSaveDefects.apply(window, args);
          this.broadcastMutation("SAVE_DEFECTS", this.getFullSnapshot());
          return res;
        };
      }

      // 2. Hook saveConfig
      if (typeof window.saveConfig === "function") {
        const origSaveConfig = window.saveConfig;
        window.saveConfig = (...args) => {
          const res = origSaveConfig.apply(window, args);
          this.broadcastMutation("SAVE_CONFIG", { projectConfig: window.projectConfig });
          return res;
        };
      }
    },

    /**
     * 1-Click Offline Backup: Export full bundle (.json)
     */
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
      this.showToast(`💾 ส่งออกไฟล์สำรอง ${filename} เรียบร้อย!`);
    },

    /**
     * 1-Click Offline Backup: Import bundle (.json)
     */
    importOfflineBackup: function (file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          await this.applyIncomingSnapshot(data);
          // Broadcast to connected peers if any
          this.broadcastMutation("SAVE_DEFECTS", this.getFullSnapshot());
          this.showToast(`🎉 นำเข้าข้อมูลห้องสำเร็จ! (${window.defectList.length} จุด)`);
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

      if (status === "connected") {
        color = "#10b981";
        icon = "🟢";
        text = note || "ซิงก์สดเรียบร้อย";
      } else if (status === "connecting") {
        color = "#f59e0b";
        icon = "🟡";
        text = "กำลังเชื่อมต่อ...";
      } else {
        color = "#ef4444";
        icon = "⚪";
        text = note || "ยังไม่เชื่อมต่อ";
      }

      if (iconEl) iconEl.textContent = icon;
      if (labelEl) labelEl.textContent = status === "connected" ? "ซิงก์สด" : "ซิงก์";
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
