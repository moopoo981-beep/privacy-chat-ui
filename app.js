// ===============================
// Privacy Chat UI - Step 5.1
// Supabase Auth + Rooms + Realtime + Invite/Friends Connected
// ยังไม่ทำ E2EE จริง
// ส่งข้อความทดลองเข้า Database จริง แต่ยังไม่เข้ารหัสจริง
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
const myUserIdText = document.getElementById("myUserIdText");
const copyMyUserIdBtn = document.getElementById("copyMyUserIdBtn");
const friendUserIdInput = document.getElementById("friendUserIdInput");
const addFriendBtn = document.getElementById("addFriendBtn");

let viewerName = localStorage.getItem("viewerName") || "Guest";
let viewerIp = localStorage.getItem("viewerIp") || "Demo-IP";
let currentUser = null;
let lastLoadedUserId = null;
let lastRoomSetupUserId = null;
let currentRoomId = null;
let messagesChannel = null;
let myRooms = [];
let allowProgrammaticCopy = false;

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
// Step 5: ข้อความยังไม่เข้ารหัสจริง
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
  if (!roomList) return;

  if (!myRooms.length) {
    roomList.innerHTML = "ยังไม่มีห้อง กดสร้างห้องใหม่";
    return;
  }

  roomList.innerHTML = "";

  myRooms.forEach((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "w-full text-left rounded-lg border px-3 py-2 break-all " +
      (room.room_id === currentRoomId
        ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-100"
        : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700");

    button.textContent = room.room_id;
    button.addEventListener("click", () => setActiveRoom(room.room_id));

    roomList.appendChild(button);
  });
}

function clearChatForRoom() {
  chatBox.innerHTML = "";
  addSystemMessage("โหลดข้อความจาก Supabase Realtime แล้ว — ขั้นนี้ยังไม่ใช่ E2EE จริง");
}

function getSavedRoomId() {
  if (!currentUser) return null;
  return localStorage.getItem(`currentRoomId:${currentUser.id}`);
}

function saveCurrentRoomId(roomId) {
  if (!currentUser || !roomId) return;
  localStorage.setItem(`currentRoomId:${currentUser.id}`, roomId);
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
  const keySalt = crypto.randomUUID();

  showRoomStatus("กำลังสร้างห้องใหม่...", "info");

  const { error: roomError } = await withTimeout(
    supabaseClient.from("rooms").insert({
      id: roomId,
      created_by: currentUser.id,
      name_ciphertext: "Demo Room - not encrypted yet",
      name_iv: "demo-no-iv",
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

  (data || []).forEach(renderDatabaseMessage);
  showRoomStatus("พร้อมใช้งาน Realtime", "success");
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
        renderDatabaseMessage(payload.new);
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

function renderDatabaseMessage(message) {
  if (!message || document.querySelector(`[data-message-id="${message.id}"]`)) {
    return;
  }

  const isMine = message.sender_id === currentUser?.id;
  const senderLabel = isMine ? "คุณ" : `สมาชิก ${String(message.sender_id).slice(0, 8)}`;
  const text = message.ciphertext || "";

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

  row.innerHTML = `
    ${avatar}
    <div class="message-bubble ${bubbleClass}">
      ${nameLine}
      <p class="chat-text">${escapeHTML(text)}</p>
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

  const { error } = await withTimeout(
    supabaseClient.from("messages").insert({
      room_id: currentRoomId,
      sender_id: currentUser.id,
      message_type: "text",
      ciphertext: text,
      iv: "demo-no-encryption-yet",
    }),
    10000,
    "ส่งข้อความไม่สำเร็จ: ใช้เวลานานเกินไป"
  );

  if (error) {
    console.error("sendTextMessage error:", error);
    showRoomStatus(getReadableError(error), "error");
    return;
  }

  showRoomStatus("ส่งข้อความแล้ว รอ Realtime แสดงในห้อง", "success");
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

// ===============================
// ส่งข้อความทดลองเข้า Supabase
// ขั้นนี้ยังไม่เข้ารหัสจริง
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
    "%cPrivacy Chat UI Step 5.1",
    "color:#22d3ee;font-size:18px;font-weight:bold;"
  );

  console.log("เชื่อม Supabase Auth + Rooms + Realtime + คัดลอกห้อง/เพิ่มเพื่อนแล้ว แต่ยังไม่ทำ E2EE จริง");
}

initApp();
