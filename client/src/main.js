import {SFUClient} from './sfuClient.js';

// Main application logic
let sfuClient = null;
let currentRoomId = null;
let currentUsername = null;

// DOM elements
const joinSection = document.getElementById('joinSection');
const videoSection = document.getElementById('videoSection');
const roomIdInput = document.getElementById('roomIdInput');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const filterButtons = document.querySelectorAll('.filter-btn');
const remoteVideos = document.getElementById('remoteVideos');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const participantsCount = document.getElementById('participantsCount');
const localUsername = document.getElementById('localUsername');

// Khởi tạo
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkWebCodecsSupport();
});

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Join button
    joinBtn.addEventListener('click', handleJoinRoom);

    // Leave button
    leaveBtn.addEventListener('click', handleLeaveRoom);

    // Toggle video
    toggleVideoBtn.addEventListener('click', handleToggleVideo);

    // Toggle audio
    toggleAudioBtn.addEventListener('click', handleToggleAudio);

    // Filter buttons
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const filterName = btn.dataset.filter;
            handleFilterChange(filterName);

            // Update active state
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Enter key to join
    roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleJoinRoom();
    });
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleJoinRoom();
    });
}

/**
 * Kiểm tra WebCodecs support
 */
function checkWebCodecsSupport() {
    if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator) {
        showStatus('⚠️ WebCodecs API không được hỗ trợ. Filters có thể không hoạt động.', 'error');
        console.warn('WebCodecs API not supported');
    } else {
        console.log('✓ WebCodecs API supported');
    }
}

/**
 * Handle join room
 */
async function handleJoinRoom() {
    const roomId = roomIdInput.value.trim();
    const username = usernameInput.value.trim();

    if (!roomId) {
        showStatus('Vui lòng nhập Room ID', 'error');
        return;
    }

    if (!username) {
        showStatus('Vui lòng nhập tên của bạn', 'error');
        return;
    }

    try {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Đang kết nối...';
        showStatus('Đang kết nối...', 'info');

        // Khởi tạo SFU client
        sfuClient = new SFUClient();

        // Setup callbacks
        sfuClient.onPeerJoined = handlePeerJoined;
        sfuClient.onPeerLeft = handlePeerLeft;
        sfuClient.onConsumerCreated = handleConsumerCreated;

        // Kết nối tới server
        await sfuClient.connect('http://localhost:3000');

        // Join room
        await sfuClient.joinRoom(roomId, username);

        // Update UI
        currentRoomId = roomId;
        currentUsername = username;
        joinSection.style.display = 'none';
        videoSection.style.display = 'block';
        roomIdDisplay.textContent = `Room: ${roomId}`;
        localUsername.textContent = username;
        updateParticipantsCount();

        showStatus('✓ Đã tham gia phòng thành công!', 'success');

    } catch (error) {
        console.error('Error joining room:', error);
        showStatus('❌ Không thể tham gia phòng: ' + error.message, 'error');
        joinBtn.disabled = false;
        joinBtn.textContent = 'Tham gia phòng';
    }
}

/**
 * Handle leave room
 */
async function handleLeaveRoom() {
    if (!sfuClient) return;

    try {
        leaveBtn.disabled = true;
        showStatus('Đang rời phòng...', 'info');

        await sfuClient.leaveRoom();

        // Reset UI
        joinSection.style.display = 'block';
        videoSection.style.display = 'none';
        remoteVideos.innerHTML = '';
        roomIdDisplay.textContent = 'Room: -';
        participantsCount.textContent = 'Participants: 0';

        // Reset state
        sfuClient = null;
        currentRoomId = null;
        currentUsername = null;

        joinBtn.disabled = false;
        joinBtn.textContent = 'Tham gia phòng';
        leaveBtn.disabled = false;

        showStatus('✓ Đã rời phòng', 'success');

    } catch (error) {
        console.error('Error leaving room:', error);
        showStatus('❌ Lỗi khi rời phòng: ' + error.message, 'error');
        leaveBtn.disabled = false;
    }
}

/**
 * Handle toggle video
 */
async function handleToggleVideo() {
    if (!sfuClient) return;

    const isEnabled = await sfuClient.toggleVideo();

    if (isEnabled) {
        toggleVideoBtn.textContent = '📹';
        toggleVideoBtn.classList.remove('muted');
        showStatus('✓ Camera đã bật', 'success');
    } else {
        toggleVideoBtn.textContent = '📹❌';
        toggleVideoBtn.classList.add('muted');
        showStatus('Camera đã tắt', 'info');
    }
}

/**
 * Handle toggle audio
 */
async function handleToggleAudio() {
    if (!sfuClient) return;

    const isEnabled = await sfuClient.toggleAudio();

    if (isEnabled) {
        toggleAudioBtn.textContent = '🎤';
        toggleAudioBtn.classList.remove('muted');
        showStatus('✓ Mic đã bật', 'success');
    } else {
        toggleAudioBtn.textContent = '🎤❌';
        toggleAudioBtn.classList.add('muted');
        showStatus('Mic đã tắt', 'info');
    }
}

/**
 * Handle filter change
 */
function handleFilterChange(filterName) {
    if (!sfuClient) return;

    console.log('Changing filter to:', filterName);
    sfuClient.setFilter(filterName);

    const filterNames = {
        'none': 'Không filter',
        'blackwhite': 'Đen trắng',
        'blur': 'Làm mờ',
        'sepia': 'Sepia',
        'invert': 'Đảo màu',
        'brightness': 'Sáng'
    };

    showStatus(`✓ Đã áp dụng filter: ${filterNames[filterName]}`, 'success');
}

/**
 * Handle peer joined
 */
function handlePeerJoined(peerId) {
    console.log('UI: Peer joined', peerId);
    updateParticipantsCount();
    showStatus(`👤 Có người mới tham gia`, 'info');
}

/**
 * Handle peer left
 */
function handlePeerLeft(peerId) {
    console.log('UI: Peer left', peerId);

    // Remove video element
    const videoElement = document.getElementById(`remote-${peerId}`);
    if (videoElement) {
        videoElement.remove();
    }

    updateParticipantsCount();
    showStatus(`👤 Có người đã rời phòng`, 'info');
}

/**
 * Handle consumer created (nhận stream từ peer khác)
 */
// function handleConsumerCreated(consumer, producerId) {
//     console.log('UI: Consumer created', { consumerId: consumer.id, producerId, kind: consumer.kind });
//
//     // Tìm hoặc tạo video element cho peer này
//     let videoWrapper = document.getElementById(`remote-${producerId}`);
//
//     if (!videoWrapper) {
//         videoWrapper = createRemoteVideoElement(producerId);
//     }
//
//     const videoElement = videoWrapper.querySelector('video');
//
//     // Add track vào video element
//     if (consumer.kind === 'video') {
//         const stream = new MediaStream([consumer.track]);
//         videoElement.srcObject = stream;
//     } else if (consumer.kind === 'audio') {
//         // Add audio track vào existing stream
//         if (videoElement.srcObject) {
//             videoElement.srcObject.addTrack(consumer.track);
//         } else {
//             const stream = new MediaStream([consumer.track]);
//             videoElement.srcObject = stream;
//         }
//     }
//
//     updateParticipantsCount();
// }

function handleConsumerCreated(consumer, producerId) {
    // Lấy peerId tương ứng từ SFUClient
    const peerId = sfuClient.getPeerIdByProducerId(producerId);
    if (!peerId) {
        console.warn('Không tìm thấy peerId cho producerId', producerId);
        return;
    }

    console.log('UI: Consumer created', {consumerId: consumer.id, peerId, kind: consumer.kind});

    // Dựa theo peerId, không phải producerId
    let videoWrapper = document.getElementById(`remote-${peerId}`);

    if (!videoWrapper) {
        videoWrapper = createRemoteVideoElement(peerId);
    }

    const videoElement = videoWrapper.querySelector('video');

    // Add track vào stream hiện có hoặc tạo mới
    if (!videoElement.srcObject) {
        videoElement.srcObject = new MediaStream();
    }
    videoElement.srcObject.addTrack(consumer.track);

    updateParticipantsCount();
}


/**
 * Tạo remote video element
 */
function createRemoteVideoElement(peerId) {
    const wrapper = document.createElement('div');
    wrapper.id = `remote-${peerId}`;
    wrapper.className = 'remote-video-wrapper';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;

    const username = sfuClient.peerUsernameMap.get(peerId) || peerId;
    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerHTML = `
        <span>${username.substring(0, 8)}</span>
        <span class="status-indicator">🟢</span>
    `;

    wrapper.appendChild(video);
    wrapper.appendChild(label);
    remoteVideos.appendChild(wrapper);

    return wrapper;
}

/**
 * Update participants count
 */
// function updateParticipantsCount() {
//     if (!sfuClient) {
//         participantsCount.textContent = 'Participants: 0';
//         return;
//     }
//
//     const count = 1 + sfuClient.consumers.size; // 1 (self) + remote peers
//     participantsCount.textContent = `Participants: ${count}`;
// }

function updateParticipantsCount() {
    if (!sfuClient) {
        participantsCount.textContent = 'Participants: 0';
        return;
    }

    const peerIds = new Set();

    // Mỗi consumer có appData.peerId
    sfuClient.consumers.forEach(consumer => {
        if (consumer.appData && consumer.appData.peerId) {
            peerIds.add(consumer.appData.peerId);
        }
    });

    const count = 1 + peerIds.size; // 1 (mình) + số peer khác thực tế
    participantsCount.textContent = `Participants: ${count}`;
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message show ${type}`;

    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 3000);
}

/**
 * Handle errors
 */
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});