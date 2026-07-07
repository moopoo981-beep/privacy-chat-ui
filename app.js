// ===============================
// Privacy Chat UI - Step 6.1
// Supabase Auth + Rooms + Delete Rooms + Realtime + E2EE Text Messages
// ข้อความถูกเข้ารหัสด้วย Web Crypto API ก่อนส่งเข้า Supabase
// รูปภาพยังไม่เข้ารหัส/อัปโหลดจริง จะทำในขั้นตอนถัดไป
// ===============================

// 1) ใส่ค่าจาก Supabase Dashboard → Project Settings → API
// ใช้ Project URL + anon public key / publishable key เท่านั้น
// ห้ามใช้ service_role key, secret key, database password หรือ connection string
const SUPABASE_URL = "https://lysezxuupkylodixnnim.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5c2V6eHV1cGt5bG9kaXhubmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDQ1NTEsImV4cCI6MjA5ODk4MDU1MX0.y7UA2sKM1mVEQsMj-Il_fuKLo9LDJY_ySppwMak3TCQ";

// 2) สร้าง Supabase Client ภายหลังใน initApp()
// ห้าม createClient ทันที เพราะถ้ายังเป็นข้อความ placeholder จะทำให้เว็บ error ก่อนแสดงสถานะ
let supabaseClient = null;

function normalizeSupabaseUrl(url) {
  // ถ้าเผลอ copy API URL ที่ลงท้าย /rest/v1 มา ให้ตัดออกเหลือ Project URL
  return url.trim().replace(/\/rest\/v1\/?$/, "");
}

function isValidSupabaseUrl(url) {
  try {
    const parsed = new URL(normalizeSupabaseUrl(url));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function hasValidSupabaseConfig() {
  return (
    !SUPABASE_URL.includes("ใส่_") &&
    !SUPABASE_ANON_KEY.includes("ใส่_") &&
    isValidSupabaseUrl(SUPABASE_URL) &&
    SUPABASE_ANON_KEY.length > 20
  );
}

function withTimeout(promise, ms = 15000, label = "คำขอใช้เวลานานเกินไป") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getReadableError(error) {
  if (!error) return "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
  return error.message || String(error);
}

function finishLoggedInState(user, displayName) {
  currentUser = user;

  viewerName =
    displayName ||
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "Anonymous";

  localStorage.setItem("viewerName", viewerName);
  loadViewerSettings();
  updateMyUserIdUI();
  prefillInviteRoomFromUrl();
  hideAuthModal();

  if (user && lastLoadedUserId !== user.id) {
    addSystemMessage(`เข้าสู่ระบบแล้ว: ${viewerName}`);
    lastLoadedUserId = user.id;
  }
}

// ===============================
// DOM Elements
// ===============================

const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const imageInput = document.getElementById("imageInput");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

const viewerNameInput = document.getElementById("viewerNameInput");
const viewerIpInput = document.getElementById("viewerIpInput");
const viewerNameText = document.getElementById("viewerNameText");
const viewerIpText = document.getElementById("viewerIpText");

const authModal = document.getElementById("authModal");
const authDisplayName = document.getElementById("authDisplayName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authStatus = document.getElementById("authStatus");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const signOutBtn = document.getElementById("signOutBtn");

const currentRoomIdText = document.getElementById("currentRoomIdText");
const roomStatus = document.getElementById("roomStatus");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomInput = document.getElementById("joinRoomInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomList = document.getElementById("roomList");
const copyRoomIdBtn = document.getElementById("copyRoomIdBtn");
const copyInviteLinkBtn = document.getElementById("copyInviteLinkBtn");
const deleteRoomBtn = document.getElementById("deleteRoomBtn");
const roomListMobile = document.getElementById("roomListMobile");
const myUserIdText = document.getElementById("myUserIdText");
const copyMyUserIdBtn = document.getElementById("copyMyUserIdBtn");
const friendUserIdInput = document.getElementById("friendUserIdInput");
const addFriendBtn = document.getElementById("addFriendBtn");
const roomPassphraseInput = document.getElementById("roomPassphraseInput");
const saveRoomKeyBtn = document.getElementById("saveRoomKeyBtn");
const clearRoomKeyBtn = document.getElementById("clearRoomKeyBtn");
const encryptionStatus = document.getElementById("encryptionStatus");

let viewerName = localStorage.getItem("viewerName") || "Guest";
let viewerIp = localStorage.getItem("viewerIp") || "Demo-IP";
let currentUser = null;
let lastLoadedUserId = null;
let lastRoomSetupUserId = null;
let currentRoomId = null;
let currentRoomSalt = null;
let messagesChannel = null;
let myRooms = [];
let allowProgrammaticCopy = false;
const roomKeyCache = new Map();

// ===============================
// Auth UI Helpers
// ===============================

function showAuthModal() {
  if (!authModal) return;
  authModal.classList.remove("hidden");
  authModal.classList.add("flex");
}

function hideAuthModal() {
  if (!authModal) return;
  authModal.classList.add("hidden");
  authModal.classList.remove("flex");
}

function showAuthStatus(message, type = "info") {
  if (!authStatus) return;

  authStatus.classList.remove("hidden");

  if (type === "error") {
    authStatus.className =
      "text-sm rounded-xl px-4 py-3 bg-rose-500/15 border border-rose-400/30 text-rose-200";
  } else if (type === "success") {
    authStatus.className =
      "text-sm rounded-xl px-4 py-3 bg-emerald-500/15 border border-emerald-400/30 text-emerald-200";
  } else {
    authStatus.className =
      "text-sm rounded-xl px-4 py-3 bg-cyan-500/15 border border-cyan-400/30 text-cyan-200";
  }

  authStatus.textContent = message;
}

function setAuthLoading(isLoading) {
  if (!signInBtn || !signUpBtn) return;

  signInBtn.disabled = isLoading;
  signUpBtn.disabled = isLoading;

  signInBtn.classList.toggle("opacity-60", isLoading);
  signUpBtn.classList.toggle("opacity-60", isLoading);
}

// ===============================
// Supabase Auth Functions
// ===============================

async function signUp() {
  if (!supabaseClient) {
    showAuthStatus("กรุณาใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ให้ถูกต้องก่อน", "error");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value.trim();
  const displayName = authDisplayName.value.trim() || "Anonymous";

  if (!email || !password) {
    showAuthStatus("กรุณากรอก Email และ Password", "error");
    return;
  }

  if (password.length < 6) {
    showAuthStatus("Password ต้องมีอย่างน้อย 6 ตัวอักษร", "error");
    return;
  }

  setAuthLoading(true);
  showAuthStatus("กำลังสมัครสมาชิก...", "info");

  try {
    const { data, error } = await withTimeout(
      supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
          },
        },
      }),
      15000,
      "สมัครสมาชิกไม่สำเร็จ: การเชื่อมต่อใช้เวลานานเกินไป ลองปิด Extension หรือเช็ก Internet"
    );

    if (error) {
      showAuthStatus(getReadableError(error), "error");
      console.error("signUp error:", error);
      return;
    }

    if (data.session && data.user) {
      finishLoggedInState(data.user, displayName);
      showAuthStatus("สมัครสมาชิกสำเร็จ กำลังเข้าใช้งาน...", "success");

      ensureProfile(displayName).catch((profileError) => {
        console.warn("Profile upsert warning:", profileError);
      });
      return;
    }

    showAuthStatus(
      "สมัครสมาชิกสำเร็จ แต่ยังไม่ได้เข้าสู่ระบบ กรุณาเช็กอีเมลเพื่อยืนยัน หรือปิด Confirm email ตอนทดสอบ",
      "success"
    );
  } catch (error) {
    showAuthStatus(getReadableError(error), "error");
    console.error("signUp exception:", error);
  } finally {
    setAuthLoading(false);
  }
}

async function signIn() {
  if (!supabaseClient) {
    showAuthStatus("กรุณาใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ให้ถูกต้องก่อน", "error");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value.trim();

  if (!email || !password) {
    showAuthStatus("กรุณากรอก Email และ Password", "error");
    return;
  }

  setAuthLoading(true);
  showAuthStatus("กำลังเข้าสู่ระบบ...", "info");

  try {
    const { data, error } = await withTimeout(
      supabaseClient.auth.signInWithPassword({
        email,
        password,
      }),
      15000,
      "เข้าสู่ระบบไม่สำเร็จ: การเชื่อมต่อใช้เวลานานเกินไป ลองปิด Extension หรือเช็ก Internet"
    );

    if (error) {
      showAuthStatus(getReadableError(error), "error");
      console.error("signIn error:", error);
      return;
    }

    if (!data.user) {
      showAuthStatus("เข้าสู่ระบบไม่สำเร็จ: ไม่พบข้อมูลผู้ใช้", "error");
      return;
    }

    const displayName =
      authDisplayName.value.trim() ||
      data.user.user_metadata?.display_name ||
      data.user.email?.split("@")[0] ||
      "Anonymous";

    finishLoggedInState(data.user, displayName);
    showAuthStatus("เข้าสู่ระบบสำเร็จ", "success");

    ensureProfile(displayName).catch((profileError) => {
      console.warn("Profile upsert warning:", profileError);
    });
  } catch (error) {
    showAuthStatus(getReadableError(error), "error");
    console.error("signIn exception:", error);
  } finally {
    setAuthLoading(false);
  }
}

async function signOut() {
  if (!supabaseClient) {
    showAuthModal();
    return;
  }

  hideAllProtectedImages();

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert(error.message);
    return;
  }

  await cleanupRealtimeChannel();
  currentUser = null;
  lastLoadedUserId = null;
  lastRoomSetupUserId = null;
  currentRoomId = null;
  updateCurrentRoomUI();
  updateMyUserIdUI();
  showAuthModal();
}

async function getCurrentSession() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient.auth.getSession(),
      10000,
      "ตรวจสอบ session ไม่สำเร็จ: การเชื่อมต่อใช้เวลานานเกินไป"
    );

    if (error) {
      console.error(error);
      showAuthModal();
      return;
    }

    if (data.session?.user) {
      const user = data.session.user;
      finishLoggedInState(
        user,
        user.user_metadata?.display_name || user.email?.split("@")[0]
      );

      loadUserState().catch((profileError) => {
        console.warn("Profile load warning:", profileError);
      });
    } else {
      currentUser = null;
      showAuthModal();
    }
  } catch (error) {
    console.error("getCurrentSession exception:", error);
    showAuthModal();
    showAuthStatus(getReadableError(error), "error");
  }
}

async function ensureProfile(displayName) {
  if (!currentUser) return;

  const safeDisplayName =
    displayName ||
    currentUser.user_metadata?.display_name ||
    currentUser.email?.split("@")[0] ||
    "Anonymous";

  const { error } = await withTimeout(
    supabaseClient.from("profiles").upsert({
      id: currentUser.id,
      display_name: safeDisplayName,
    }),
    10000,
    "บันทึก profile ไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("Profile upsert error:", error);
  }
}

async function loadUserState() {
  if (!currentUser) {
    showAuthModal();
    return;
  }

  const { data, error } = await withTimeout(
    supabaseClient
      .from("profiles")
      .select("display_name")
      .eq("id", currentUser.id)
      .single(),
    10000,
    "โหลด profile ไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  const displayName =
    data?.display_name ||
    currentUser.user_metadata?.display_name ||
    currentUser.email?.split("@")[0] ||
    "Anonymous";

  if (error) {
    console.warn("Profile load warning:", error.message);
  }

  viewerName = displayName;
  localStorage.setItem("viewerName", viewerName);

  loadViewerSettings();
  hideAuthModal();

  if (lastLoadedUserId !== currentUser.id) {
    addSystemMessage(`เข้าสู่ระบบแล้ว: ${viewerName}`);
    lastLoadedUserId = currentUser.id;
  }

  setupRoomsAfterLogin().catch((error) => {
    console.error("Room setup error:", error);
    showRoomStatus(`โหลดห้องไม่สำเร็จ: ${getReadableError(error)}`, "error");
  });
}

// ===============================
// ตั้งค่าผู้ดู / Watermark
// ===============================

function loadViewerSettings() {
  viewerNameInput.value = viewerName;
  viewerIpInput.value = viewerIp;

  viewerNameText.textContent = viewerName;
  viewerIpText.textContent = `IP: ${viewerIp}`;
}

function saveViewerSettings() {
  viewerName = viewerNameInput.value.trim() || "Guest";
  viewerIp = viewerIpInput.value.trim() || "Demo-IP";

  localStorage.setItem("viewerName", viewerName);
  localStorage.setItem("viewerIp", viewerIp);

  loadViewerSettings();
  closeSettings();
}

function openSettings() {
  settingsModal.classList.remove("hidden");
  settingsModal.classList.add("flex");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
  settingsModal.classList.remove("flex");
}

settingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
saveSettingsBtn.addEventListener("click", saveViewerSettings);

settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    closeSettings();
  }
});

loadViewerSettings();

// ===============================
// Utility
// ===============================

function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getWatermarkText() {
  const now = new Date();

  const dateTime = now.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  return `${viewerName} • ${viewerIp} • ${dateTime}`;
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function addSystemMessage(text) {
  const row = document.createElement("div");
  row.className = "flex justify-center";

  row.innerHTML = `
    <div class="text-xs text-slate-400 bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-full">
      ${escapeHTML(text)}
    </div>
  `;

  chatBox.appendChild(row);
  scrollToBottom();
}


// ===============================
// Web Crypto API: E2EE Text Helpers
// ===============================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function randomBytesBase64(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function getSaltBytes(saltText) {
  const cleaned = String(saltText || "").trim();

  try {
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) && cleaned.length % 4 === 0) {
      const bytes = base64ToBytes(cleaned);
      if (bytes.length >= 8) return bytes;
    }
  } catch (error) {
    // fallback เป็น UTF-8 ด้านล่าง
  }

  return textEncoder.encode(cleaned || currentRoomId || "privacy-chat-default-salt");
}

async function deriveRoomKey(passphrase, saltText) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: getSaltBytes(saltText),
      iterations: 250000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plainText, key) {
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(ivBytes);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    textEncoder.encode(plainText)
  );

  return {
    ciphertext: bytesToBase64(encryptedBuffer),
    iv: bytesToBase64(ivBytes),
  };
}

async function decryptText(ciphertextBase64, ivBase64, key) {
  const cipherBytes = base64ToBytes(ciphertextBase64);
  const ivBytes = base64ToBytes(ivBase64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    cipherBytes
  );

  return textDecoder.decode(decryptedBuffer);
}

function getCurrentRoomKey() {
  if (!currentRoomId) return null;
  return roomKeyCache.get(currentRoomId) || null;
}

function updateEncryptionUI() {
  if (!encryptionStatus) return;

  if (!currentRoomId) {
    encryptionStatus.className = "text-xs text-slate-400 mt-2";
    encryptionStatus.textContent = "ยังไม่ได้เลือกห้อง จึงยังตั้งรหัส E2EE ไม่ได้";
    return;
  }

  if (getCurrentRoomKey()) {
    encryptionStatus.className = "text-xs text-emerald-300 mt-2";
    encryptionStatus.textContent = "เปิด E2EE แล้ว: ข้อความใหม่จะถูกเข้ารหัสก่อนส่งเข้า Supabase";
    return;
  }

  encryptionStatus.className = "text-xs text-amber-300 mt-2";
  encryptionStatus.textContent = "ยังไม่ได้ใส่รหัสห้อง: อ่านข้อความเข้ารหัสไม่ได้ และส่งข้อความใหม่ไม่ได้";
}

async function loadCurrentRoomSalt(roomId) {
  currentRoomSalt = null;

  if (!roomId || !supabaseClient) return null;

  const { data, error } = await withTimeout(
    supabaseClient
      .from("rooms")
      .select("key_salt")
      .eq("id", roomId)
      .single(),
    10000,
    "โหลดข้อมูลรหัสห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("loadCurrentRoomSalt error:", error);
    showRoomStatus(getReadableError(error), "error");
    return null;
  }

  currentRoomSalt = data?.key_salt || roomId;
  return currentRoomSalt;
}

async function saveRoomPassphrase() {
  if (!currentRoomId) {
    showRoomStatus("กรุณาสร้างห้องหรือเลือกห้องก่อนตั้งรหัส E2EE", "error");
    return;
  }

  const passphrase = (roomPassphraseInput?.value || "").trim();

  if (passphrase.length < 8) {
    showRoomStatus("รหัสห้องควรยาวอย่างน้อย 8 ตัวอักษร", "error");
    roomPassphraseInput?.focus();
    return;
  }

  showRoomStatus("กำลังสร้างกุญแจ E2EE ในเบราว์เซอร์...", "info");

  try {
    if (!currentRoomSalt) {
      await loadCurrentRoomSalt(currentRoomId);
    }

    const key = await deriveRoomKey(passphrase, currentRoomSalt || currentRoomId);
    roomKeyCache.set(currentRoomId, key);

    if (roomPassphraseInput) roomPassphraseInput.value = "";
    updateEncryptionUI();
    await loadMessages(currentRoomId);
    showRoomStatus("ใช้รหัสห้องสำเร็จ ข้อความจะแสดงหลังถอดรหัสในเบราว์เซอร์", "success");
  } catch (error) {
    console.error("saveRoomPassphrase error:", error);
    showRoomStatus(`สร้างกุญแจ E2EE ไม่สำเร็จ: ${getReadableError(error)}`, "error");
  }
}

async function clearRoomPassphrase() {
  if (!currentRoomId) return;

  roomKeyCache.delete(currentRoomId);
  updateEncryptionUI();
  await loadMessages(currentRoomId);
  showRoomStatus("ล้างรหัสห้องออกจากหน่วยความจำแล้ว", "success");
}



// ===============================
// Clipboard + Invite Helpers
// ===============================

function updateMyUserIdUI() {
  if (!myUserIdText) return;
  myUserIdText.textContent = currentUser?.id || "ยังไม่ได้เข้าสู่ระบบ";
}

function getInviteUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

function prefillInviteRoomFromUrl() {
  if (!joinRoomInput) return;
  const params = new URLSearchParams(window.location.search);
  const roomIdFromUrl = params.get("room");
  if (roomIdFromUrl && !currentRoomId) {
    joinRoomInput.value = roomIdFromUrl;
    showRoomStatus("พบ Room ID จากลิงก์เชิญแล้ว กด ‘เข้าห้อง’ เพื่อเข้าร่วม", "info");
  }
}

async function copyTextToClipboard(text, successMessage) {
  if (!text) {
    showRoomStatus("ไม่มีข้อมูลให้คัดลอก", "error");
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const tempInput = document.createElement("textarea");
      tempInput.value = text;
      tempInput.setAttribute("readonly", "");
      tempInput.style.position = "fixed";
      tempInput.style.left = "-9999px";
      document.body.appendChild(tempInput);
      tempInput.select();
      allowProgrammaticCopy = true;
      document.execCommand("copy");
      allowProgrammaticCopy = false;
      document.body.removeChild(tempInput);
    }

    showRoomStatus(successMessage, "success");
  } catch (error) {
    allowProgrammaticCopy = false;
    console.error("copy error:", error);
    showRoomStatus("คัดลอกไม่สำเร็จ ให้กดเลือกแล้วคัดลอกเอง หรือเปิดผ่าน HTTPS/GitHub Pages", "error");
  }
}

// ===============================
// Rooms + Realtime Messages
// Step 6: ข้อความเข้ารหัสด้วย Web Crypto API
// ===============================

function showRoomStatus(message, type = "info") {
  if (!roomStatus) return;

  const base = "text-xs mt-2 ";
  if (type === "error") {
    roomStatus.className = base + "text-rose-300";
  } else if (type === "success") {
    roomStatus.className = base + "text-emerald-300";
  } else {
    roomStatus.className = base + "text-slate-400";
  }

  roomStatus.textContent = message;
}

function updateCurrentRoomUI() {
  if (!currentRoomIdText) return;
  currentRoomIdText.textContent = currentRoomId || "ยังไม่ได้เลือกห้อง";
}

function renderRoomList() {
  const targets = [roomList, roomListMobile].filter(Boolean);
  if (!targets.length) return;

  targets.forEach((target) => {
    if (!myRooms.length) {
      target.innerHTML = "ยังไม่มีห้อง กดสร้างห้องใหม่";
      return;
    }

    target.innerHTML = "";

    myRooms.forEach((room) => {
      const wrapper = document.createElement("div");
      wrapper.className = "room-list-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "room-select-btn w-full text-left rounded-lg border px-3 py-2 break-all " +
        (room.room_id === currentRoomId
          ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-100"
          : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700");

      const shortRole = room.role === "owner" ? "เจ้าของ" : "สมาชิก";
      button.innerHTML = `
        <span class="block truncate">${escapeHTML(room.room_id)}</span>
        <span class="block text-[10px] opacity-70 mt-1">${shortRole}</span>
      `;
      button.addEventListener("click", () => setActiveRoom(room.room_id));
      wrapper.appendChild(button);

      if (room.role === "owner") {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className =
          "room-delete-mini-btn rounded-lg border border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 px-3 py-2 text-xs";
        deleteBtn.textContent = "ลบ";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteRoom(room.room_id).catch((error) => {
            console.error("deleteRoom exception:", error);
            showRoomStatus(getReadableError(error), "error");
          });
        });
        wrapper.appendChild(deleteBtn);
      }

      target.appendChild(wrapper);
    });
  });
}

function clearChatForRoom() {
  chatBox.innerHTML = "";
  addSystemMessage("โหลดข้อความจาก Supabase Realtime แล้ว — Step 6 ใช้ E2EE สำหรับข้อความ");
}

function getSavedRoomId() {
  if (!currentUser) return null;
  return localStorage.getItem(`currentRoomId:${currentUser.id}`);
}

function saveCurrentRoomId(roomId) {
  if (!currentUser || !roomId) return;
  localStorage.setItem(`currentRoomId:${currentUser.id}`, roomId);
}

function clearSavedRoomId(roomId = currentRoomId) {
  if (!currentUser) return;

  const key = `currentRoomId:${currentUser.id}`;
  if (!roomId || localStorage.getItem(key) === roomId) {
    localStorage.removeItem(key);
  }
}

async function setupRoomsAfterLogin() {
  if (!currentUser || !supabaseClient) return;

  if (lastRoomSetupUserId === currentUser.id && currentRoomId) {
    return;
  }

  lastRoomSetupUserId = currentUser.id;
  await loadMyRooms();

  const savedRoomId = getSavedRoomId();
  const savedRoom = myRooms.find((room) => room.room_id === savedRoomId);

  if (savedRoom) {
    await setActiveRoom(savedRoom.room_id);
    return;
  }

  if (myRooms.length > 0) {
    await setActiveRoom(myRooms[0].room_id);
    return;
  }

  clearChatForRoom();
  updateCurrentRoomUI();
  showRoomStatus("ยังไม่มีห้อง ให้กด ‘สร้างห้องใหม่’ เพื่อเริ่มทดสอบ", "info");
}

async function loadMyRooms() {
  if (!currentUser || !supabaseClient) return [];

  const { data, error } = await withTimeout(
    supabaseClient
      .from("room_members")
      .select("room_id, role, joined_at")
      .eq("user_id", currentUser.id)
      .order("joined_at", { ascending: false }),
    10000,
    "โหลดรายชื่อห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("loadMyRooms error:", error);
    throw error;
  }

  myRooms = data || [];
  renderRoomList();
  return myRooms;
}

async function createRoom() {
  if (!currentUser || !supabaseClient) {
    showAuthModal();
    return;
  }

  const roomId = crypto.randomUUID();
  const keySalt = randomBytesBase64(16);

  showRoomStatus("กำลังสร้างห้องใหม่...", "info");

  const { error: roomError } = await withTimeout(
    supabaseClient.from("rooms").insert({
      id: roomId,
      created_by: currentUser.id,
      name_ciphertext: "encrypted-room-name-not-implemented-yet",
      name_iv: "not-used-yet",
      key_salt: keySalt,
    }),
    10000,
    "สร้างห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (roomError) {
    console.error("createRoom roomError:", roomError);
    showRoomStatus(getReadableError(roomError), "error");
    return;
  }

  const { error: memberError } = await withTimeout(
    supabaseClient.from("room_members").insert({
      room_id: roomId,
      user_id: currentUser.id,
      role: "owner",
    }),
    10000,
    "เพิ่มสมาชิกห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (memberError) {
    console.error("createRoom memberError:", memberError);
    showRoomStatus(getReadableError(memberError), "error");
    return;
  }

  await loadMyRooms();
  await setActiveRoom(roomId);
  showRoomStatus("สร้างห้องสำเร็จ คัดลอก Room ID ให้คนอื่นเข้าห้องได้", "success");
}

async function deleteRoom(roomId = currentRoomId) {
  if (!currentUser || !supabaseClient) {
    showAuthModal();
    return;
  }

  if (!roomId) {
    showRoomStatus("ยังไม่มีห้องให้ลบ", "error");
    return;
  }

  const roomInfo = myRooms.find((room) => room.room_id === roomId);

  if (roomInfo?.role !== "owner") {
    showRoomStatus("ลบได้เฉพาะห้องที่คุณสร้างเองเท่านั้น", "error");
    return;
  }

  const ok = window.confirm(
    `ต้องการลบห้องนี้ถาวรหรือไม่?

${roomId}

ข้อความและสมาชิกในห้องจะถูกลบตามไปด้วย`
  );

  if (!ok) return;

  showRoomStatus("กำลังลบห้อง...", "info");

  const { error } = await withTimeout(
    supabaseClient
      .from("rooms")
      .delete()
      .eq("id", roomId)
      .eq("created_by", currentUser.id),
    10000,
    "ลบห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("deleteRoom error:", error);
    showRoomStatus(`${getReadableError(error)} — ลบได้เฉพาะเจ้าของห้อง และต้องมี RLS policy rooms_delete_creator`, "error");
    return;
  }

  if (roomId === currentRoomId) {
    await cleanupRealtimeChannel();
    roomKeyCache.delete(roomId);
    currentRoomId = null;
    currentRoomSalt = null;
    clearSavedRoomId(roomId);
    clearChatForRoom();
  }

  await loadMyRooms();

  if (myRooms.length > 0) {
    await setActiveRoom(myRooms[0].room_id);
    showRoomStatus("ลบห้องสำเร็จ และสลับไปห้องถัดไปแล้ว", "success");
  } else {
    updateCurrentRoomUI();
    updateEncryptionUI();
    showRoomStatus("ลบห้องสำเร็จ ตอนนี้ยังไม่มีห้อง ให้กดสร้างห้องใหม่", "success");
  }
}

async function joinRoom() {
  if (!currentUser || !supabaseClient) {
    showAuthModal();
    return;
  }

  const roomId = joinRoomInput.value.trim();

  if (!roomId) {
    showRoomStatus("กรุณาวาง Room ID ก่อนเข้าห้อง", "error");
    return;
  }

  showRoomStatus("กำลังเข้าห้อง...", "info");

  const { error } = await withTimeout(
    supabaseClient.from("room_members").upsert(
      {
        room_id: roomId,
        user_id: currentUser.id,
        role: "member",
      },
      {
        onConflict: "room_id,user_id",
        ignoreDuplicates: true,
      }
    ),
    10000,
    "เข้าห้องไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("joinRoom error:", error);
    showRoomStatus(
      `${getReadableError(error)} — ตรวจว่า Room ID ถูกต้อง และ SQL/RLS สร้างครบแล้ว`,
      "error"
    );
    return;
  }

  joinRoomInput.value = "";
  await loadMyRooms();
  await setActiveRoom(roomId);
  showRoomStatus("เข้าห้องสำเร็จ", "success");
}

async function setActiveRoom(roomId) {
  if (!roomId || !currentUser || !supabaseClient) return;

  currentRoomId = roomId;
  saveCurrentRoomId(roomId);
  updateCurrentRoomUI();
  renderRoomList();

  await loadCurrentRoomSalt(roomId);
  updateEncryptionUI();
  await loadMessages(roomId);
  await subscribeToRoom(roomId);
}

async function loadMessages(roomId) {
  clearChatForRoom();
  showRoomStatus("กำลังโหลดข้อความ...", "info");

  const { data, error } = await withTimeout(
    supabaseClient
      .from("messages")
      .select("id, room_id, sender_id, message_type, ciphertext, iv, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(100),
    10000,
    "โหลดข้อความไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("loadMessages error:", error);
    showRoomStatus(getReadableError(error), "error");
    return;
  }

  for (const message of data || []) {
    await renderDatabaseMessage(message);
  }
  showRoomStatus("พร้อมใช้งาน Realtime + E2EE", "success");
}

async function cleanupRealtimeChannel() {
  if (messagesChannel && supabaseClient) {
    await supabaseClient.removeChannel(messagesChannel);
  }
  messagesChannel = null;
}

async function subscribeToRoom(roomId) {
  await cleanupRealtimeChannel();

  messagesChannel = supabaseClient
    .channel(`room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        renderDatabaseMessage(payload.new).catch((error) => {
          console.error("render realtime message error:", error);
        });
      }
    )
    .subscribe((status, error) => {
      if (error) {
        console.error("Realtime subscribe error:", error);
        showRoomStatus(`Realtime error: ${getReadableError(error)}`, "error");
        return;
      }

      if (status === "SUBSCRIBED") {
        showRoomStatus("เชื่อม Realtime สำเร็จ", "success");
      }
    });
}

async function renderDatabaseMessage(message) {
  if (!message || document.querySelector(`[data-message-id="${message.id}"]`)) {
    return;
  }

  const isMine = message.sender_id === currentUser?.id;
  const senderLabel = isMine ? "คุณ" : `สมาชิก ${String(message.sender_id).slice(0, 8)}`;
  let text = "";
  let locked = false;

  if (message.message_type === "text") {
    const roomKey = getCurrentRoomKey();

    if (!roomKey) {
      locked = true;
      text = "🔒 ข้อความเข้ารหัส — ใส่รหัสห้องให้ถูกต้องเพื่ออ่านข้อความ";
    } else {
      try {
        text = await decryptText(message.ciphertext, message.iv, roomKey);
      } catch (error) {
        locked = true;
        text = "🔒 ถอดรหัสไม่ได้ — รหัสห้องไม่ถูกต้อง หรือเป็นข้อความเก่าก่อนเปิด E2EE";
        console.warn("decrypt message failed:", error);
      }
    }
  } else {
    locked = true;
    text = "🔒 ไฟล์/รูปภาพเข้ารหัสจะทำในขั้นตอนถัดไป";
  }

  const row = document.createElement("div");
  row.className = `message-row ${isMine ? "outgoing" : "incoming"}`;
  row.dataset.messageId = message.id;

  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : getCurrentTime();

  const bubbleClass = isMine ? "outgoing-bubble" : "incoming-bubble";
  const avatar = isMine ? "" : `<div class="avatar">${escapeHTML(senderLabel.charAt(0))}</div>`;
  const nameLine = isMine ? "" : `<p class="text-xs text-slate-400 mb-1">${escapeHTML(senderLabel)}</p>`;
  const lockBadge = locked
    ? `<p class="text-[10px] mt-1 opacity-70">encrypted / locked</p>`
    : `<p class="text-[10px] mt-1 opacity-70">E2EE decrypted in browser</p>`;

  row.innerHTML = `
    ${avatar}
    <div class="message-bubble ${bubbleClass}">
      ${nameLine}
      <p class="chat-text">${escapeHTML(text)}</p>
      ${lockBadge}
      <p class="message-time">${time}</p>
    </div>
  `;

  chatBox.appendChild(row);
  scrollToBottom();
}

async function sendTextMessageToSupabase(text) {
  if (!currentUser || !supabaseClient) {
    showAuthModal();
    return;
  }

  if (!currentRoomId) {
    showRoomStatus("กรุณาสร้างห้องหรือเข้าห้องก่อนส่งข้อความ", "error");
    return;
  }

  const roomKey = getCurrentRoomKey();

  if (!roomKey) {
    showRoomStatus("กรุณาใส่รหัสห้อง E2EE และกด ‘ใช้รหัสนี้’ ก่อนส่งข้อความ", "error");
    roomPassphraseInput?.focus();
    return;
  }

  const encrypted = await encryptText(text, roomKey);

  const { error } = await withTimeout(
    supabaseClient.from("messages").insert({
      room_id: currentRoomId,
      sender_id: currentUser.id,
      message_type: "text",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    }),
    10000,
    "ส่งข้อความไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("sendTextMessage error:", error);
    showRoomStatus(getReadableError(error), "error");
    return;
  }

  showRoomStatus("ส่งข้อความเข้ารหัสแล้ว Supabase เห็นเฉพาะ ciphertext", "success");
}


async function addFriendToCurrentRoom() {
  if (!currentUser || !supabaseClient) {
    showAuthModal();
    return;
  }

  if (!currentRoomId) {
    showRoomStatus("กรุณาสร้างห้องหรือเลือกห้องก่อนเพิ่มเพื่อน", "error");
    return;
  }

  const friendUserId = (friendUserIdInput?.value || "").trim();

  if (!friendUserId) {
    showRoomStatus("กรุณาวาง User ID ของเพื่อนก่อน", "error");
    return;
  }

  if (friendUserId === currentUser.id) {
    showRoomStatus("นี่คือ User ID ของคุณเอง ไม่ต้องเพิ่มซ้ำ", "error");
    return;
  }

  showRoomStatus("กำลังเพิ่มเพื่อนเข้าห้อง...", "info");

  const { error } = await withTimeout(
    supabaseClient.from("room_members").upsert(
      {
        room_id: currentRoomId,
        user_id: friendUserId,
        role: "member",
      },
      {
        onConflict: "room_id,user_id",
        ignoreDuplicates: true,
      }
    ),
    10000,
    "เพิ่มเพื่อนไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("addFriendToCurrentRoom error:", error);
    showRoomStatus(
      `${getReadableError(error)} — ต้องเป็นเจ้าของห้อง และ User ID เพื่อนต้องมีอยู่จริง`,
      "error"
    );
    return;
  }

  if (friendUserIdInput) friendUserIdInput.value = "";
  showRoomStatus("เพิ่มเพื่อนเข้าห้องสำเร็จ เพื่อนจะเห็นห้องนี้หลังล็อกอิน/รีเฟรช", "success");
}

if (createRoomBtn) {
  createRoomBtn.addEventListener("click", () => {
    createRoom().catch((error) => {
      console.error("createRoom exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    joinRoom().catch((error) => {
      console.error("joinRoom exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}

if (joinRoomInput) {
  joinRoomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinRoomBtn.click();
    }
  });
}

if (copyRoomIdBtn) {
  copyRoomIdBtn.addEventListener("click", () => {
    copyTextToClipboard(currentRoomId, "คัดลอก Room ID แล้ว");
  });
}

if (copyInviteLinkBtn) {
  copyInviteLinkBtn.addEventListener("click", () => {
    if (!currentRoomId) {
      showRoomStatus("ยังไม่มีห้องให้คัดลอกลิงก์เชิญ", "error");
      return;
    }
    copyTextToClipboard(getInviteUrl(currentRoomId), "คัดลอกลิงก์เชิญแล้ว ส่งให้เพื่อนได้เลย");
  });
}

if (deleteRoomBtn) {
  deleteRoomBtn.addEventListener("click", () => {
    deleteRoom(currentRoomId).catch((error) => {
      console.error("delete current room exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}


if (copyMyUserIdBtn) {
  copyMyUserIdBtn.addEventListener("click", () => {
    copyTextToClipboard(currentUser?.id, "คัดลอก User ID ของคุณแล้ว");
  });
}

if (addFriendBtn) {
  addFriendBtn.addEventListener("click", () => {
    addFriendToCurrentRoom().catch((error) => {
      console.error("addFriend exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}

if (friendUserIdInput) {
  friendUserIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      addFriendBtn.click();
    }
  });
}


if (saveRoomKeyBtn) {
  saveRoomKeyBtn.addEventListener("click", () => {
    saveRoomPassphrase().catch((error) => {
      console.error("saveRoomPassphrase exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}

if (clearRoomKeyBtn) {
  clearRoomKeyBtn.addEventListener("click", () => {
    clearRoomPassphrase().catch((error) => {
      console.error("clearRoomPassphrase exception:", error);
      showRoomStatus(getReadableError(error), "error");
    });
  });
}

if (roomPassphraseInput) {
  roomPassphraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRoomKeyBtn?.click();
    }
  });
}

// ===============================
// ส่งข้อความเข้ารหัสเข้า Supabase
// Step 6: ข้อความถูกเข้ารหัสก่อนบันทึก
// ===============================

function addTextMessage(text) {
  // ฟังก์ชันนี้เหลือไว้สำหรับ fallback เฉพาะกรณี debug เท่านั้น
  const safeText = escapeHTML(text);

  const row = document.createElement("div");
  row.className = "message-row outgoing";

  row.innerHTML = `
    <div class="message-bubble outgoing-bubble">
      <p class="chat-text">${safeText}</p>
      <p class="message-time">${getCurrentTime()}</p>
    </div>
  `;

  chatBox.appendChild(row);
  scrollToBottom();
}

sendBtn.addEventListener("click", async () => {
  if (!currentUser) {
    showAuthModal();
    return;
  }

  const text = messageInput.value.trim();

  if (!text) return;

  messageInput.value = "";
  messageInput.style.height = "auto";

  await sendTextMessageToSupabase(text);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendBtn.click();
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});

// ===============================
// เพิ่มรูปภาพทดลองจากเครื่อง
// ตอนนี้ยังไม่เข้ารหัสและยังไม่อัปโหลด Storage
// ===============================

imageInput.addEventListener("change", () => {
  if (!currentUser) {
    showAuthModal();
    imageInput.value = "";
    return;
  }

  const file = imageInput.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
    imageInput.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    addImageMessage(reader.result);
    imageInput.value = "";
  };

  reader.readAsDataURL(file);
});

function addImageMessage(imageSrc) {
  const row = document.createElement("div");
  row.className = "message-row outgoing";

  row.innerHTML = `
    <div class="message-bubble outgoing-bubble max-w-sm">
      <p class="text-xs opacity-80 mb-2">คุณส่งรูปภาพที่ถูกป้องกัน</p>

      <div class="secure-image-card">
        <img
          class="secure-image protected-image"
          alt="Protected upload"
          draggable="false"
          src="${imageSrc}"
        />

        <div class="blur-shield">
          <div class="text-center">
            <p class="font-bold">รูปภาพถูกเบลอ</p>
            <p class="text-xs opacity-90 mt-1">
              กดค้าง / แตะค้าง เพื่อดูภาพ
            </p>
          </div>
        </div>

        <div class="watermark-layer"></div>
      </div>

      <p class="message-time">${getCurrentTime()}</p>
    </div>
  `;

  chatBox.appendChild(row);

  const imageCard = row.querySelector(".secure-image-card");
  prepareSecureImageCard(imageCard);

  scrollToBottom();
}

// ===============================
// Secure Image: กดค้างเพื่อดู
// ===============================

function prepareSecureImageCard(card) {
  const watermarkLayer = card.querySelector(".watermark-layer");

  function renderWatermark() {
    watermarkLayer.innerHTML = "";

    const text = getWatermarkText();
    const rows = 6;
    const cols = 4;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const item = document.createElement("div");
        item.className = "watermark-item";
        item.textContent = text;

        item.style.left = `${x * 34 - 8}%`;
        item.style.top = `${y * 22 + 4}%`;

        watermarkLayer.appendChild(item);
      }
    }
  }

  function showImage() {
    renderWatermark();
    card.classList.add("viewing");
  }

  function hideImage() {
    card.classList.remove("viewing");
  }

  card.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    showImage();
  });

  card.addEventListener("pointerup", hideImage);
  card.addEventListener("pointercancel", hideImage);
  card.addEventListener("pointerleave", hideImage);

  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    hideImage();
  });

  card.addEventListener("dragstart", (event) => {
    event.preventDefault();
    hideImage();
  });
}

function prepareAllSecureImages() {
  const cards = document.querySelectorAll(".secure-image-card");
  cards.forEach(prepareSecureImageCard);
}

prepareAllSecureImages();

// ===============================
// เบลอภาพทั้งหมดทันที
// ===============================

function hideAllProtectedImages() {
  const cards = document.querySelectorAll(".secure-image-card");
  cards.forEach((card) => {
    card.classList.remove("viewing");
  });
}

window.addEventListener("blur", hideAllProtectedImages);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hideAllProtectedImages();
  }
});

// ===============================
// ป้องกันพื้นฐาน: คลิกขวา / Copy / Select
// ===============================

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  hideAllProtectedImages();
});

document.addEventListener("copy", (event) => {
  if (allowProgrammaticCopy) return;
  event.preventDefault();
});

document.addEventListener("cut", (event) => {
  event.preventDefault();
});

document.addEventListener("selectstart", (event) => {
  const target = event.target;

  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    return;
  }

  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  const key = (event.key || "").toLowerCase();

  if (
    event.key === "PrintScreen" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    hideAllProtectedImages();
  }

  if ((event.ctrlKey || event.metaKey) && ["c", "s", "p", "u"].includes(key)) {
    event.preventDefault();
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "s") {
    event.preventDefault();
    hideAllProtectedImages();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "PrintScreen") {
    hideAllProtectedImages();
  }
});

// ===============================
// เริ่มต้นระบบ
// ===============================

async function initApp() {
  if (!window.supabase) {
    showAuthStatus(
      "ยังโหลด Supabase CDN ไม่สำเร็จ ตรวจสอบ internet หรือ script ใน index.html",
      "error"
    );
    showAuthModal();
    return;
  }

  if (!hasValidSupabaseConfig()) {
    showAuthStatus(
      "ยังไม่ได้ใส่ SUPABASE_URL / SUPABASE_ANON_KEY ให้ถูกต้องใน app.js ให้ใส่ Project URL ที่ขึ้นต้นด้วย https:// และ anon public key จาก Supabase",
      "error"
    );
    showAuthModal();
    return;
  }

  supabaseClient = window.supabase.createClient(
    normalizeSupabaseUrl(SUPABASE_URL),
    SUPABASE_ANON_KEY
  );

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      const user = session.user;
      finishLoggedInState(
        user,
        user.user_metadata?.display_name || user.email?.split("@")[0]
      );

      loadUserState().catch((profileError) => {
        console.warn("Profile load warning:", profileError);
      });
    } else {
      currentUser = null;
      lastLoadedUserId = null;
      updateMyUserIdUI();
      showAuthModal();
    }
  });

  signUpBtn.addEventListener("click", signUp);
  signInBtn.addEventListener("click", signIn);
  signOutBtn.addEventListener("click", signOut);

  authPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      signIn();
    }
  });

  updateMyUserIdUI();
  prefillInviteRoomFromUrl();

  await getCurrentSession();

  console.log(
    "%cPrivacy Chat UI Step 6",
    "color:#22d3ee;font-size:18px;font-weight:bold;"
  );

  console.log("เชื่อม Supabase Auth + Rooms + Realtime แล้ว และเปิด E2EE สำหรับข้อความด้วย Web Crypto API");
}

initApp();
