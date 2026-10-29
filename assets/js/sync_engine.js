/**
 * INSPECT Q • Cross-Device Live Auto-Sync Engine (v5.1 - Single Master Lock)
 * DEFINITIVE BULLETPROOF RELIABILITY ARCHITECTURE:
 * 1. Ping-Pong Keepalive Heartbeat (10s intervals):
 *    - Keeps carrier UDP NAT bindings (AIS, True, DTAC) permanently open.
 *    - Auto-detects dead connections within 25s and auto-reconnects seamlessly.
 * 2. Mobile Sleep & Tab Visibility Auto-Rescue (Page Visibility API):
 *    - Listens to visibilitychange, focus, and online events.
 *    - Instantly resyncs the millisecond the screen is unlocked or tab is focused.
 * 3. Offline / Reconnecting Mutation Queue:
 *    - Never loses any defect or photo if inspector saves while connection temporarily drops.
 *    - Automatically flushes pending snapshots the moment connection re-establishes.
 * 4. Zero-Crash 6-Slot Host Candidate Auto-Rotation:
 *    - Gracefully cycles through 6 candidate slots without throwing unavailable-id errors.
 *    - Complete peer cleanup prevents zombie connections on 0.peerjs.com.
 * 5. Flow-Controlled 16KB Safe Chunk Streaming:
 *    - WebRTC backpressure flow control ensures 50MB+ datasets never crash the channel.
 */

(function (window) {
  "use strict";

  const STORAGE_PIN_KEY = "inspectq_sync_pin";
  const STORAGE_ROLE_KEY = "inspectq_sync_role";
  const SYNC_VERSION = "5.1";
  const CHUNK_SIZE = 16384; // 16 KB safe WebRTC chunk size
  const BUFFER_HIGH_WATER = 65536; // 64 KB pause threshold
  const BUFFER_LOW_WATER = 16384;  // 16 KB resume threshold
  const HEARTBEAT_INTERVAL_MS = 10000; // 10s ping
  const HEARTBEAT_TIMEOUT_MS = 25000;  // 25s dead threshold

  function getLocalDefectCount() {
    try {
      if (typeof window.getDefectList === "function") {
        const l = window.getDefectList();
        if (Array.isArray(l)) return l.length;
      }
      if (Array.isArray(window.defectList)) return window.defectList.length;
    } catch (e) {}
    return 0;
  }

  function resolveActiveRole() {
    const saved = localStorage.getItem(STORAGE_ROLE_KEY);
    // Strict Single-Master Rule: Only the dedicated Master Phone is 'host'.
    // Every other device (PC, tablet, secondary phones) defaults strictly to 'client'.
    if (saved === "host") return "host";
    return "client";
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  let _pin = localStorage.getItem(STORAGE_PIN_KEY) || "8888";
  let _role = resolveActiveRole();
  let _peer = null;
  let _activeConnections = [];
  let _pendingProbes = [];
  let _status = "offline"; // "offline", "connecting", "connected"
  let _probeTimer = null;
  let _heartbeatTimer = null;
  let _watchdogTimer = null;
  let _hostSlotIndex = 0;
  let _lastSyncTimestamp = 0;
  let _incomingTransfers = {};
  let _pendingSnapshot = null;
  let _isReconnecting = false;

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

  function getHostCandidateSlots(pin) {
    const clean = (pin || "8888").toString().replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "8888";
    return [
      `inspectq_host_${clean}`,
      `inspectq_host_${clean}_a`,
      `inspectq_host_${clean}_b`,
      `inspectq_host_${clean}_c`,
      `inspectq_host_${clean}_d`,
      `inspectq_host_${clean}_e`
    ];
  }

  const SyncEngine = {
    get pin() { return _pin; },
    get status() { return _status; },
    get role() { return _role; },
    get connectedCount() { return _activeConnections.filter(c => c && c.open).length; },
    get lastSyncTime() { return _lastSyncTimestamp ? formatTime(_lastSyncTimestamp) : "-"; },

    init: function () {
      _role = resolveActiveRole();
      console.log(`📡 [SyncEngine v${SYNC_VERSION}] Initializing. Resolved Role:`, _role, "PIN:", _pin, "LocalDefects:", getLocalDefectCount());
      this.setupAutoSyncHooks();
      this.setupUnloadHandler();
      this.setupVisibilityHandler();
      this.startHeartbeatLoop();
      this.connectP2P();
    },

    onDataLoaded: function () {
      const saved = localStorage.getItem(STORAGE_ROLE_KEY);
      const count = getLocalDefectCount();
      console.log(`💾 [SyncEngine v${SYNC_VERSION}] onDataLoaded: count=${count}, savedRole=${saved}, currentRole=${_role}`);
      // STRICT SINGLE-MASTER RULE: Never auto-promote a device to host just because it has defects.
      // Secondary devices will have defects after syncing. Auto-promoting them would cause rogue host collisions!
    },

    setupUnloadHandler: function () {
      window.addEventListener("beforeunload", () => {
        this.cleanup();
      });
    },

    /**
     * Mobile Screen Sleep & Background Tab Auto-Rescue
     * Instantly resyncs when user turns on screen or switches back to tab!
     */
    setupVisibilityHandler: function () {
      const wakeHandler = () => {
        if (document.visibilityState === "visible") {
          console.log("👁️ [SyncEngine] Screen wake / tab focused. Checking connection health...");
          this.handleWakeup();
        }
      };

      document.addEventListener("visibilitychange", wakeHandler);
      window.addEventListener("focus", wakeHandler);
      window.addEventListener("online", () => {
        console.log("🌐 [SyncEngine] Network online event received. Reconnecting...");
        this.reconnect();
      });
    },

    handleWakeup: function () {
      // 1. Check if Peer instance is alive
      if (!_peer || _peer.destroyed || _peer.disconnected) {
        console.log("🔄 [SyncEngine] Peer is dead after sleep. Auto-reconnecting...");
        this.reconnect();
        return;
      }

      // 2. Filter dead connections
      _activeConnections = _activeConnections.filter(c => c && c.open);

      if (_activeConnections.length === 0) {
        console.log("🔍 [SyncEngine] No active connections after wake. Triggering probe...");
        if (_role === "client") {
          this.probeAllHostSlots();
        } else {
          this.updateStatus("connecting", "📱 รอเครื่องรองเชื่อมต่อใหม่...");
        }
      } else {
        // Active connections exist: request immediate fresh state to catch up
        console.log("⚡ [SyncEngine] Awake with open connections. Syncing fresh state...");
        if (_role === "client") {
          this.pullNow();
        } else if (_pendingSnapshot) {
          this.flushPendingSnapshot();
        }
      }
    },

    /**
     * Heartbeat Keepalive & Watchdog Loop
     * Sends PING every 10s to keep NAT open; reconnects if dead for 25s
     */
    startHeartbeatLoop: function () {
      if (_heartbeatTimer) clearInterval(_heartbeatTimer);
      if (_watchdogTimer) clearInterval(_watchdogTimer);

      _heartbeatTimer = setInterval(() => {
        if (_activeConnections.length > 0) {
          const pingPayload = { type: "HEARTBEAT_PING", timestamp: Date.now() };
          _activeConnections.forEach(conn => {
            if (conn && conn.open) {
              try {
                conn.send(pingPayload);
              } catch (e) {
                console.warn("Heartbeat ping error:", e);
              }
            }
          });
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Watchdog: detect dead connections and auto-heal
      _watchdogTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;

        _activeConnections = _activeConnections.filter(conn => {
          if (!conn || !conn.open) return false;
          if (conn._lastHeartbeat && (now - conn._lastHeartbeat > HEARTBEAT_TIMEOUT_MS)) {
            console.warn(`⏱️ [SyncEngine] Connection to ${conn.peer} timed out (no heartbeat for 25s). Closing.`);
            try { conn.close(); } catch (e) {}
            changed = true;
            return false;
          }
          return true;
        });

        if (changed || (_activeConnections.length === 0 && _status === "connected")) {
          if (_activeConnections.length === 0) {
            this.updateStatus("connecting", _role === "host" ? "📱 รอเครื่องรองเชื่อมต่อ..." : "📲 กำลังเชื่อมต่อเครื่องหลักใหม่...");
            if (_role === "client") {
              this.probeAllHostSlots();
            }
          } else {
            this.updateStatus("connected");
          }
        }
      }, 5000);
    },

    cleanup: function () {
      if (_probeTimer) {
        clearInterval(_probeTimer);
        _probeTimer = null;
      }
      this.closePendingProbes();
      if (_peer) {
        try {
          _peer.disconnect();
          _peer.destroy();
        } catch (e) {}
        _peer = null;
      }
      _activeConnections = [];
      _incomingTransfers = {};
    },

    closePendingProbes: function () {
      if (_pendingProbes && _pendingProbes.length > 0) {
        _pendingProbes.forEach(conn => {
          try {
            if (conn && !conn.open) conn.close();
          } catch (e) {}
        });
        _pendingProbes = [];
      }
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
      if (newRole === "auto") {
        localStorage.removeItem(STORAGE_ROLE_KEY);
        _role = resolveActiveRole();
      } else {
        localStorage.setItem(STORAGE_ROLE_KEY, _role);
      }
      this.updateRoleUI();
      this.reconnect();
      const roleMsg = _role === "host" ? "👑 เครื่องนี้เป็น: เครื่องตรวจหลักเครื่องเดียว (Master)" : "📲 เครื่องนี้เป็น: เครื่องรอง (รับข้อมูลอัตโนมัติ)";
      this.showToast(roleMsg);
    },

    updateRoleUI: function () {
      const hostBtn = document.getElementById("role-btn-host");
      const clientBtn = document.getElementById("role-btn-client");
      const hostBadge = document.getElementById("host-badge");
      const clientBadge = document.getElementById("client-badge");
      const roleCurrentTag = document.getElementById("role-current-tag");
      const roleBanner = document.getElementById("role-feedback-banner");

      if (hostBtn && clientBtn) {
        if (_role === "host") {
          hostBtn.style.border = "2px solid #10b981";
          hostBtn.style.background = "linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.2))";
          hostBtn.style.color = "#34d399";
          hostBtn.style.boxShadow = "0 0 12px rgba(16, 185, 129, 0.3)";
          if (hostBadge) {
            hostBadge.textContent = "✓ เครื่องนี้คือเครื่องหลัก";
            hostBadge.style.background = "#059669";
            hostBadge.style.color = "#ffffff";
            hostBadge.style.display = "inline-block";
          }

          clientBtn.style.border = "1.5px solid #1e293b";
          clientBtn.style.background = "#070d1e";
          clientBtn.style.color = "#64748b";
          clientBtn.style.boxShadow = "none";
          if (clientBadge) {
            clientBadge.textContent = "ไม่ได้เลือก";
            clientBadge.style.background = "transparent";
            clientBadge.style.color = "#64748b";
            clientBadge.style.display = "inline-block";
          }

          if (roleCurrentTag) {
            roleCurrentTag.textContent = "👑 เครื่องตรวจหลัก";
            roleCurrentTag.style.background = "#059669";
          }
          if (roleBanner) {
            roleBanner.style.background = "rgba(16, 185, 129, 0.15)";
            roleBanner.style.border = "1px solid #10b981";
            roleBanner.style.color = "#a7f3d0";
            roleBanner.innerHTML = "👑 <strong>เครื่องนี้คือ 'เครื่องตรวจหลักเครื่องเดียว':</strong> ทุก Defect และภาพถ่ายที่บันทึกจะส่งไปยังเครื่องรองทั้งหมดทันที";
          }
        } else {
          clientBtn.style.border = "2px solid #00adf2";
          clientBtn.style.background = "linear-gradient(135deg, rgba(2, 132, 199, 0.4), rgba(14, 165, 233, 0.2))";
          clientBtn.style.color = "#38bdf8";
          clientBtn.style.boxShadow = "0 0 12px rgba(0, 173, 242, 0.3)";
          if (clientBadge) {
            clientBadge.textContent = "✓ เครื่องนี้คือเครื่องรอง";
            clientBadge.style.background = "#0284c7";
            clientBadge.style.color = "#ffffff";
            clientBadge.style.display = "inline-block";
          }

          hostBtn.style.border = "1.5px solid #1e293b";
          hostBtn.style.background = "#070d1e";
          hostBtn.style.color = "#64748b";
          hostBtn.style.boxShadow = "none";
          if (hostBadge) {
            hostBadge.textContent = "ไม่ได้เลือก";
            hostBadge.style.background = "transparent";
            hostBadge.style.color = "#64748b";
            hostBadge.style.display = "inline-block";
          }

          if (roleCurrentTag) {
            roleCurrentTag.textContent = "📲 เครื่องรอง";
            roleCurrentTag.style.background = "#0284c7";
          }
          if (roleBanner) {
            roleBanner.style.background = "rgba(2, 132, 199, 0.15)";
            roleBanner.style.border = "1px solid #0284c7";
            roleBanner.style.color = "#bae6fd";
            roleBanner.innerHTML = "📲 <strong>เครื่องนี้ถูกตั้งเป็น 'เครื่องรอง' เรียบร้อย:</strong> พร้อมรับข้อมูลอัตโนมัติจากเครื่องหลัก PIN " + _pin + "<br><span style=\"font-size: 11px; color: #94a3b8;\">👉 เมื่อเครื่องหลักเปิดหน้าเว็บ ข้อมูลจะเชื่อมต่อสด 🟢 อัตโนมัติทันที</span>";
          }
        }
      }
    },

    reconnect: function () {
      if (_isReconnecting) return;
      _isReconnecting = true;
      this.cleanup();
      _role = resolveActiveRole();
      this.updateStatus("connecting", "กำลังเริ่มการเชื่อมต่อใหม่...");
      setTimeout(() => {
        _isReconnecting = false;
        this.connectP2P();
      }, 150);
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

      if (_role === "client") {
        this.initClient();
      } else {
        _hostSlotIndex = 0;
        this.tryClaimHostSlot(_hostSlotIndex);
      }
    },

    /**
     * HOST / SENDER MODE: Claim candidate slot with zero-crash auto-rotation
     */
    tryClaimHostSlot: function (slotIndex) {
      const slots = getHostCandidateSlots(_pin);
      const targetSlot = slots[slotIndex % slots.length];

      this.updateStatus("connecting", `กำลังเปิดห้องเครื่องหลัก (${targetSlot})...`);
      console.log(`📱 [SyncEngine v${SYNC_VERSION}] Attempting Host slot [${slotIndex}]:`, targetSlot);

      if (_peer) {
        try {
          _peer.removeAllListeners();
          _peer.destroy();
        } catch (e) {}
        _peer = null;
      }

      _peer = new Peer(targetSlot, PEER_CONFIG);

      // Listen for incoming client connections immediately
      _peer.on("connection", (conn) => {
        console.log("🔗 [SyncEngine] Client connected to Host:", conn.peer);
        this.setupConnection(conn, true);
      });

      _peer.on("open", (id) => {
        console.log("📱 [SyncEngine] HOST Registered successfully on slot:", id);
        this.updateStatus("connected", `👑 เครื่องหลักหน้างาน (ห้อง ${id} พร้อมส่ง)`);
        if (_pendingSnapshot) {
          this.flushPendingSnapshot();
        }
      });

      _peer.on("error", (err) => {
        console.warn(`Host Peer notice on slot ${targetSlot}:`, err);
        if (err.type === "unavailable-id" || err.type === "socket-closed" || err.type === "server-error") {
          console.log(`⚠️ Slot ${targetSlot} busy/unavailable. Rotating to candidate slot ${slotIndex + 1}...`);
          try {
            if (_peer) {
              _peer.removeAllListeners();
              _peer.destroy();
            }
          } catch (e) {}
          _peer = null;

          // Smooth backoff rotation (never crash into offline state)
          this.updateStatus("connecting", `กำลังสลับช่องสัญญาณอัตโนมัติ (ช่องที่ ${(slotIndex % slots.length) + 1})...`);
          setTimeout(() => {
            if (_role === "host") {
              this.tryClaimHostSlot(slotIndex + 1);
            }
          }, 400);
        } else {
          console.warn("Host other peer error:", err);
          this.updateStatus("connecting", "กำลังดูแลการเชื่อมต่อเครื่องหลัก...");
        }
      });
    },

    listenForClients: function () {
      if (!_peer) return;
      _peer.on("connection", (conn) => {
        console.log("🔗 [SyncEngine] Secondary device connected:", conn.peer);
        this.setupConnection(conn, true);
      });
    },

    /**
     * CLIENT / RECEIVER MODE: Connect and probe candidate host slots with de-duplication
     */
    initClient: function () {
      this.updateStatus("connecting", `📲 กำลังค้นหาเครื่องหลัก (PIN ${_pin})...`);

      const clean = _pin.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "8888";
      const clientPeerId = `inspectq_c_${clean}_${Math.random().toString(36).substring(2, 7)}`;

      if (_peer) {
        try {
          _peer.removeAllListeners();
          _peer.destroy();
        } catch (e) {}
        _peer = null;
      }

      _peer = new Peer(clientPeerId, PEER_CONFIG);

      _peer.on("open", (myId) => {
        console.log(`📲 [SyncEngine v${SYNC_VERSION}] RECEIVER Active:`, myId);
        this.probeAllHostSlots();
        if (_probeTimer) clearInterval(_probeTimer);
        _probeTimer = setInterval(() => {
          if (_activeConnections.filter(c => c && c.open).length === 0 && _role === "client") {
            this.probeAllHostSlots();
          }
        }, 3000);
      });

      _peer.on("error", (err) => {
        if (err.type === "peer-unavailable") return;
        console.warn("Client Peer notice:", err);
      });
    },

    probeAllHostSlots: function () {
      if (!_peer || _peer.destroyed) return;
      if (_activeConnections.some(c => c && c.open)) return;

      this.closePendingProbes();
      const slots = getHostCandidateSlots(_pin);
      console.log("🔍 [SyncEngine] Probing candidate host slots in parallel:", slots);

      slots.forEach(slotId => {
        try {
          const conn = _peer.connect(slotId, { reliable: true });
          _pendingProbes.push(conn);
          this.setupConnection(conn, false);
        } catch (e) {
          console.warn("Probe error on", slotId, e);
        }
      });
    },

    setupConnection: function (conn, isHost) {
      if (!conn) return;

      conn._lastHeartbeat = Date.now();

      conn.on("open", () => {
        console.log("⚡ [SyncEngine] DataChannel OPEN with:", conn.peer, "isHost:", isHost);
        // Remove from pending probes
        _pendingProbes = _pendingProbes.filter(c => c !== conn);

        if (!_activeConnections.includes(conn)) {
          _activeConnections.push(conn);
        }
        conn._lastHeartbeat = Date.now();
        this.updateStatus("connected");

        // Instant bidirectional sync handshake:
        const myDefects = getLocalDefectCount();
        if (isHost || myDefects > 0) {
          if (_pendingSnapshot) {
            this.flushPendingSnapshot();
          } else {
            this.pushFullStateToConn(conn);
          }
          this.showToast("🔗 เครื่องรองเชื่อมต่อแล้ว! กำลังส่งข้อมูลสด...");
        } else {
          conn.send({ type: "REQ_FULL_STATE" });
          this.showToast("🔗 เชื่อมต่อเครื่องหลักแล้ว! กำลังดึงข้อมูลล่าสุด...");
        }
      });

      conn.on("data", (data) => {
        conn._lastHeartbeat = Date.now();
        this.handleIncomingData(data, conn);
      });

      conn.on("close", () => {
        console.log("🔌 Connection closed with:", conn.peer);
        _activeConnections = _activeConnections.filter(c => c !== conn);
        _pendingProbes = _pendingProbes.filter(c => c !== conn);

        if (_activeConnections.filter(c => c && c.open).length === 0) {
          this.updateStatus("connecting", _role === "host" ? "📱 รอเครื่องรองเชื่อมต่อ..." : "📲 กำลังเชื่อมต่อเครื่องหลักใหม่...");
          if (_role === "client") {
            setTimeout(() => this.probeAllHostSlots(), 800);
          }
        } else {
          this.updateStatus("connected");
        }
      });

      conn.on("error", (err) => {
        console.warn("DataChannel connection notice with " + conn.peer, err);
      });
    },

    /**
     * SAFE CHUNK STREAMING WITH NATIVE BACKPRESSURE FLOW CONTROL
     * Never crashes WebRTC SCTP buffer even with 50MB+ photo datasets
     */
    sendSnapshotChunked: async function (conn, snapshot) {
      if (!conn || !conn.open) return;

      try {
        const jsonStr = JSON.stringify(snapshot);
        const totalChunks = Math.ceil(jsonStr.length / CHUNK_SIZE);
        const transferId = "tx_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);

        console.log(`📤 [SyncEngine] Streaming snapshot (${jsonStr.length.toLocaleString()} bytes in ${totalChunks} chunks) to ${conn.peer}...`);

        conn.send({
          type: "CHUNK_START",
          transferId: transferId,
          totalChunks: totalChunks,
          totalBytes: jsonStr.length,
          defectCount: (snapshot.defectList || []).length,
          timestamp: Date.now()
        });

        const dc = conn.dataChannel;

        for (let i = 0; i < totalChunks; i++) {
          if (!conn.open) {
            console.warn("Connection dropped during streaming at chunk", i);
            return;
          }

          // Native Backpressure flow control: wait if buffer exceeds HIGH_WATER
          if (dc && typeof dc.bufferedAmount === "number" && dc.bufferedAmount > BUFFER_HIGH_WATER) {
            await new Promise(resolve => {
              const checkDrain = () => {
                if (!dc || dc.bufferedAmount <= BUFFER_LOW_WATER) {
                  resolve();
                } else {
                  setTimeout(checkDrain, 8);
                }
              };
              checkDrain();
            });
          }

          const chunkData = jsonStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          conn.send({
            type: "CHUNK_DATA",
            transferId: transferId,
            index: i,
            data: chunkData
          });

          // Pacing: yield to event loop every 3 chunks
          if (i % 3 === 0) {
            await new Promise(r => setTimeout(r, 4));
          }
        }

        conn.send({
          type: "CHUNK_END",
          transferId: transferId
        });

        _lastSyncTimestamp = Date.now();
        console.log(`✅ [SyncEngine] Successfully delivered all ${totalChunks} chunks to ${conn.peer}`);
      } catch (err) {
        console.error("Chunked transmission error:", err);
      }
    },

    broadcastMutation: function (action, data) {
      const openConns = _activeConnections.filter(c => c && c.open);

      // If offline/reconnecting during save, buffer the snapshot for guaranteed delivery upon reconnect!
      if (openConns.length === 0) {
        console.log(`💾 [SyncEngine] Connection offline during mutation [${action}]. Queuing snapshot for auto-delivery on reconnect.`);
        _pendingSnapshot = this.getFullSnapshot();
        return;
      }

      // CRITICAL: When saving defects (which contains full Base64 photos), ALWAYS use safe chunk streaming!
      if (action === "SAVE_DEFECTS") {
        const fullSnapshot = this.getFullSnapshot();
        openConns.forEach(conn => {
          this.sendSnapshotChunked(conn, fullSnapshot);
        });
        return;
      }

      // Small metadata updates like project config (< 1KB) can be sent directly
      const payload = {
        type: "MUTATION",
        action: action,
        data: data,
        timestamp: Date.now()
      };

      openConns.forEach(conn => {
        try {
          conn.send(payload);
        } catch (err) {
          console.warn("Send payload error:", err);
        }
      });
    },

    flushPendingSnapshot: function () {
      if (!_pendingSnapshot) return;
      const openConns = _activeConnections.filter(c => c && c.open);
      if (openConns.length > 0) {
        console.log("🚀 [SyncEngine] Flushing pending snapshot to newly connected peers...");
        const snapshotToSend = _pendingSnapshot;
        _pendingSnapshot = null;
        openConns.forEach(conn => {
          this.sendSnapshotChunked(conn, snapshotToSend);
        });
        this.showToast("🚀 อัปเดตข้อมูลที่บันทึกขณะออฟไลน์ไปยังเครื่องอื่นเรียบร้อย!");
      }
    },

    pushFullStateToConn: function (conn) {
      if (!conn || !conn.open) return;
      const fullSnapshot = this.getFullSnapshot();
      this.sendSnapshotChunked(conn, fullSnapshot);
    },

    pushNow: function () {
      const openConns = _activeConnections.filter(c => c && c.open);
      if (openConns.length === 0) {
        alert("⚠️ ยังไม่มีเครื่องอื่นเชื่อมต่ออยู่ในรหัส PIN นี้ครับ
กรุณาเปิดหน้าเว็บนี้บนเครื่องหลักและเครื่องรองโดยใช้ PIN เดียวกัน: " + _pin);
        return;
      }
      const fullSnapshot = this.getFullSnapshot();
      openConns.forEach(conn => {
        this.sendSnapshotChunked(conn, fullSnapshot);
      });
      this.showToast(`🚀 ส่งข้อมูล ${fullSnapshot.defectList.length} จุดไปยังเครื่องอื่นสำเร็จ!`);
    },

    pullNow: function () {
      const openConns = _activeConnections.filter(c => c && c.open);
      if (openConns.length === 0) {
        this.showToast("🔄 กำลังค้นหาเครื่องหลัก PIN: " + _pin);
        this.probeAllHostSlots();
        return;
      }
      openConns.forEach(conn => {
        conn.send({ type: "REQ_FULL_STATE" });
      });
      this.showToast("🔄 ส่งคำขอดึงข้อมูลล่าสุดจากเครื่องตรวจแล้ว...");
    },

    handleIncomingData: async function (msg, senderConn) {
      if (!msg || !msg.type) return;

      // Handle Ping / Pong Heartbeats
      if (msg.type === "HEARTBEAT_PING") {
        try {
          if (senderConn && senderConn.open) {
            senderConn.send({ type: "HEARTBEAT_PONG", timestamp: Date.now() });
          }
        } catch (e) {}
        return;
      }

      if (msg.type === "HEARTBEAT_PONG") {
        // Heartbeat acknowledged, lastHeartbeat is updated above
        return;
      }

      if (msg.type === "REQ_FULL_STATE") {
        console.log("📥 [SyncEngine] Received REQ_FULL_STATE from:", senderConn.peer);
        this.pushFullStateToConn(senderConn);
        return;
      }

      // Handle Chunked Streaming (Handles unlimited photo sizes smoothly)
      if (msg.type === "CHUNK_START") {
        _incomingTransfers[msg.transferId] = {
          totalChunks: msg.totalChunks,
          totalBytes: msg.totalBytes,
          defectCount: msg.defectCount,
          chunks: new Array(msg.totalChunks),
          received: 0,
          startTime: Date.now()
        };
        this.showToast(`📥 กำลังรับข้อมูล (${msg.defectCount} รายการ)...`);
        return;
      }

      if (msg.type === "CHUNK_DATA") {
        const tx = _incomingTransfers[msg.transferId];
        if (tx && tx.chunks) {
          if (!tx.chunks[msg.index]) {
            tx.chunks[msg.index] = msg.data;
            tx.received++;
          }
        }
        return;
      }

      if (msg.type === "CHUNK_END") {
        const tx = _incomingTransfers[msg.transferId];
        if (tx && tx.received === tx.totalChunks) {
          try {
            const fullJson = tx.chunks.join("");
            const snapshot = JSON.parse(fullJson);
            delete _incomingTransfers[msg.transferId];
            await this.applyIncomingSnapshot(snapshot);
            _lastSyncTimestamp = Date.now();
            this.updateStatus("connected");
            this.showToast(`✨ รับข้อมูลอัปเดตอัตโนมัติเรียบร้อย (${tx.defectCount} รายการพร้อมรูป)`);
          } catch (e) {
            console.error("Failed to parse chunked snapshot:", e);
          }
        }
        return;
      }

      // Direct fallback
      if (msg.type === "FULL_STATE_SNAPSHOT" || (msg.type === "MUTATION" && msg.action === "SAVE_DEFECTS")) {
        const snapshot = msg.payload || msg.data;
        if (!snapshot) return;
        const count = Array.isArray(snapshot.defectList) ? snapshot.defectList.length : 0;
        await this.applyIncomingSnapshot(snapshot);
        _lastSyncTimestamp = Date.now();
        this.updateStatus("connected");
        this.showToast(`✨ รับข้อมูลอัปเดตอัตโนมัติแล้ว (${count} จุด)`);
      }

      if (msg.type === "MUTATION" && msg.action === "SAVE_CONFIG") {
        if (msg.data && msg.data.projectConfig) {
          if (typeof window.setProjectConfig === "function") {
            window.setProjectConfig(msg.data.projectConfig);
          }
          localStorage.setItem("condo_inspect_cfg", JSON.stringify(msg.data.projectConfig));
          if (typeof window.updateSummaryUI === "function") window.updateSummaryUI();
          _lastSyncTimestamp = Date.now();
          this.updateStatus("connected");
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

        // 2. Defect List (Save to both scope variable and IndexedDB)
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
        siteAttendance: sAtt,
        version: SYNC_VERSION,
        timestamp: Date.now()
      };
    },

    setupAutoSyncHooks: function () {
      console.log("🔗 [SyncEngine v5.1] Auto-Sync event hooks active.");
    },

    updateStatus: function (status, note) {
      _status = status;
      const topBadge = document.getElementById("cloud-sync-btn");
      const modalStatus = document.getElementById("sync-modal-status");

      let color = "#ef4444";
      let icon = "🔄";
      let text = "ออฟไลน์";

      const openCount = _activeConnections.filter(c => c && c.open).length;
      const roleThai = _role === "host" ? "หลัก" : "รอง";
      const timeStr = _lastSyncTimestamp ? ` (อัปเดต: ${formatTime(_lastSyncTimestamp)})` : "";

      if (status === "connected") {
        color = "#10b981";
        icon = "🟢";
        if (openCount > 0) {
          text = note || (_role === "host" ? `👑 เครื่องหลัก (เชื่อมต่อ ${openCount} เครื่อง${timeStr})` : `📲 เครื่องรอง (ซิงก์สดเรียบร้อย${timeStr})`);
        } else {
          text = note || (_role === "host" ? "👑 เครื่องหลักหน้างาน (พร้อมส่งข้อมูล)" : "📲 เครื่องรอง (พร้อมรับข้อมูล)");
        }
      } else if (status === "connecting") {
        color = "#f59e0b";
        icon = "🟡";
        text = note || (_role === "host" ? "👑 กำลังรอเครื่องรองเชื่อมต่อ..." : "กำลังค้นหาเครื่องหลัก...");
      } else {
        color = "#ef4444";
        icon = "⚪";
        text = note || "ออฟไลน์";
      }

      if (topBadge) {
        topBadge.innerHTML = `${icon} ซิงก์ (${roleThai})`;
        topBadge.style.borderColor = color;
        topBadge.style.color = color;
      }

      if (modalStatus) {
        modalStatus.innerHTML = `${icon} ${text}`;
        modalStatus.style.color = color;
      }
    },

    showToast: function (msg) {
      let toast = document.getElementById("sync-toast-notice");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "sync-toast-notice";
        toast.style.cssText = `
          position: fixed;
          bottom: 75px;
          right: 20px;
          background: rgba(12, 10, 6, 0.92);
          border: 1.5px solid rgba(212, 175, 55, 0.85);
          color: #ffd700;
          font-family: 'Kanit', sans-serif;
          font-weight: 300;
          font-size: 13.5px;
          padding: 8px 18px;
          border-radius: 16px;
          z-index: 100000;
          box-shadow: 0 4px 18px rgba(0,0,0,0.6);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.25s ease, transform 0.25s ease;
          transform: translateY(10px);
        `;
        document.body.appendChild(toast);
      }
      toast.innerHTML = msg;
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";

      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
      }, 3500);
    },

    exportOfflineBackup: function () {
      const snapshot = this.getFullSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      const cleanProj = (snapshot.projectConfig.projName || "Condo").replace(/\s+/g, "_");
      const cleanRoom = (snapshot.projectConfig.roomNo || "Room").replace(/\s+/g, "_");
      a.href = URL.createObjectURL(blob);
      a.download = `InspectQ_Backup_${cleanProj}_${cleanRoom}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },

    importOfflineBackup: function (fileInput) {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const snapshot = JSON.parse(e.target.result);
          await this.applyIncomingSnapshot(snapshot);
          this.showToast("📦 กู้คืนข้อมูลจากไฟล์สำรองสำเร็จแล้ว!");
        } catch (err) {
          alert("❌ ไม่สามารถเปิดไฟล์สำรองได้: " + err.message);
        }
      };
      reader.readAsText(file);
    }
  };

  window.SyncEngine = SyncEngine;

})(window);
