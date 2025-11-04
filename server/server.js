const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mediasoup = require('mediasoup');
const path = require('path');
const cors = require('cors');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
// app.use(express.static(path.join(__dirname, '../client')));

// MediaSoup workers và routers
let workers = [];
let nextWorkerIndex = 0;
const rooms = new Map();

// Khởi tạo MediaSoup workers
async function createWorkers() {
    const numWorkers = Object.keys(require('os').cpus()).length;
    console.log(`Creating ${numWorkers} MediaSoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            logLevel: config.worker.logLevel,
            logTags: config.worker.logTags,
            rtcMinPort: config.worker.rtcMinPort,
            rtcMaxPort: config.worker.rtcMaxPort,
        });

        worker.on('died', () => {
            console.error('MediaSoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
            setTimeout(() => process.exit(1), 2000);
        });

        workers.push(worker);
        console.log(`Worker created [pid:${worker.pid}]`);
    }
}

// Lấy worker theo round-robin
function getWorker() {
    const worker = workers[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
    return worker;
}

// Tạo room mới
async function createRoom(roomId) {
    console.log(`Creating room: ${roomId}`);

    const worker = getWorker();
    const router = await worker.createRouter({
        mediaCodecs: config.router.mediaCodecs,
    });

    const room = {
        id: roomId,
        router,
        peers: new Map(),
        createdAt: Date.now(),
    };

    rooms.set(roomId, room);
    return room;
}

// Lấy hoặc tạo room
async function getOrCreateRoom(roomId) {
    let room = rooms.get(roomId);
    if (!room) {
        room = await createRoom(roomId);
    }
    return room;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join room
    socket.on('join-room', async ({roomId, username}, callback) => {
        try {
            console.log(`Peer ${socket.id} joining room ${roomId}`);

            const room = await getOrCreateRoom(roomId);
            socket.join(roomId);

            // Tạo peer object
            const peer = {
                id: socket.id,
                username,
                roomId,
                transports: new Map(),
                producers: new Map(),
                consumers: new Map(),
            };

            room.peers.set(socket.id, peer);

            // Gửi router capabilities về client
            callback({
                rtpCapabilities: room.router.rtpCapabilities,
            });

            // Thông báo cho các peers khác
            socket.to(roomId).emit('peer-joined', {
                peerId: socket.id,
                username,
            });

        } catch (error) {
            console.error('Error joining room:', error);
            callback({error: error.message});
        }
    });

    // Tạo WebRTC transport
    socket.on('create-transport', async ({roomId, direction}, callback) => {
        try {
            const room = rooms.get(roomId);
            if (!room) {
                throw new Error('Room not found');
            }

            const transport = await room.router.createWebRtcTransport({
                ...config.webRtcTransport,
                appData: {peerId: socket.id, direction},
            });

            const peer = room.peers.get(socket.id);
            peer.transports.set(transport.id, transport);

            console.log(`Transport created [peerId:${socket.id}, direction:${direction}]`);

            transport.on('dtlsstatechange', (dtlsState) => {
                if (dtlsState === 'closed' || dtlsState === 'failed') {
                    console.log('Transport closed/failed:', transport.id);
                    transport.close();
                }
            });

            callback({
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });

        } catch (error) {
            console.error('Error creating transport:', error);
            callback({error: error.message});
        }
    });

    // Connect transport
    socket.on('connect-transport', async ({transportId, dtlsParameters}, callback) => {
        try {
            const room = Array.from(rooms.values()).find(r => r.peers.has(socket.id));
            if (!room) {
                throw new Error('Room not found');
            }

            const peer = room.peers.get(socket.id);
            const transport = peer.transports.get(transportId);

            if (!transport) {
                throw new Error('Transport not found');
            }

            await transport.connect({dtlsParameters});
            console.log(`Transport connected [peerId:${socket.id}, transportId:${transportId}]`);

            callback({success: true});

        } catch (error) {
            console.error('Error connecting transport:', error);
            callback({error: error.message});
        }
    });

    // Produce (gửi media)
    socket.on('produce', async ({transportId, kind, rtpParameters}, callback) => {
        try {
            const room = Array.from(rooms.values()).find(r => r.peers.has(socket.id));
            if (!room) {
                throw new Error('Room not found');
            }

            const peer = room.peers.get(socket.id);
            const transport = peer.transports.get(transportId);

            if (!transport) {
                throw new Error('Transport not found');
            }

            const producer = await transport.produce({
                kind,
                rtpParameters,
            });

            peer.producers.set(producer.id, producer);

            console.log(`Producer created [peerId:${socket.id}, kind:${kind}]`);

            producer.on('transportclose', () => {
                console.log('Producer transport closed:', producer.id);
                producer.close();
                peer.producers.delete(producer.id);
            });

            // Thông báo cho các peers khác
            socket.to(room.id).emit('new-producer', {
                peerId: socket.id,
                producerId: producer.id,
                kind: producer.kind,
            });

            callback({
                producerId: producer.id,
            });

        } catch (error) {
            console.error('Error producing:', error);
            callback({error: error.message});
        }
    });

    // Consume (nhận media)
    socket.on('consume', async ({rtpCapabilities, producerId}, callback) => {
        try {
            const room = Array.from(rooms.values()).find(r => r.peers.has(socket.id));
            if (!room) {
                throw new Error('Room not found');
            }

            // Kiểm tra nếu router có thể consume
            if (!room.router.canConsume({producerId, rtpCapabilities})) {
                throw new Error('Cannot consume');
            }

            const peer = room.peers.get(socket.id);

            // Tìm transport receive
            const transport = Array.from(peer.transports.values()).find(
                t => t.appData.direction === 'recv'
            );

            if (!transport) {
                throw new Error('Receive transport not found');
            }

            const consumer = await transport.consume({
                producerId,
                rtpCapabilities,
                paused: true, // Bắt đầu ở trạng thái paused
            });

            peer.consumers.set(consumer.id, consumer);

            console.log(`Consumer created [peerId:${socket.id}, producerId:${producerId}]`);

            consumer.on('transportclose', () => {
                console.log('Consumer transport closed:', consumer.id);
                peer.consumers.delete(consumer.id);
            });

            consumer.on('producerclose', () => {
                console.log('Consumer producer closed:', consumer.id);
                peer.consumers.delete(consumer.id);
                socket.emit('consumer-closed', {consumerId: consumer.id});
            });

            // callback({
            //     id: consumer.id,
            //     // TODO:
            //     producerId: producerId,
            //     kind: consumer.kind,
            //     rtpParameters: consumer.rtpParameters,
            // });

            // Tìm peerId của producer này
            const producerOwner = Array.from(room.peers.values()).find(p =>
                p.producers.has(producerId)
            );
            const producerPeerId = producerOwner ? producerOwner.id : null;

            callback({
                id: consumer.id,
                producerId: producerId,
                peerId: producerPeerId, // 👈 thêm dòng này
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            });

        } catch (error) {
            console.error('Error consuming:', error);
            callback({error: error.message});
        }
    });

    // Resume consumer
    socket.on('resume-consumer', async ({consumerId}, callback) => {
        try {
            const room = Array.from(rooms.values()).find(r => r.peers.has(socket.id));
            if (!room) {
                throw new Error('Room not found');
            }

            const peer = room.peers.get(socket.id);
            const consumer = peer.consumers.get(consumerId);

            if (!consumer) {
                throw new Error('Consumer not found');
            }

            await consumer.resume();
            console.log(`Consumer resumed [consumerId:${consumerId}]`);

            callback({success: true});

        } catch (error) {
            console.error('Error resuming consumer:', error);
            callback({error: error.message});
        }
    });

    // Get producers
    socket.on('get-producers', ({roomId}, callback) => {
        try {
            const room = rooms.get(roomId);
            if (!room) {
                return callback({producers: []});
            }

            const producers = [];
            room.peers.forEach((peer, peerId) => {
                if (peerId !== socket.id) {
                    peer.producers.forEach((producer) => {
                        producers.push({
                            peerId,
                            producerId: producer.id,
                            kind: producer.kind,
                        });
                    });
                }
            });

            callback({producers});

        } catch (error) {
            console.error('Error getting producers:', error);
            callback({error: error.message});
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Tìm room của peer
        const room = Array.from(rooms.values()).find(r => r.peers.has(socket.id));

        if (room) {
            const peer = room.peers.get(socket.id);

            // Close tất cả transports
            peer.transports.forEach(transport => transport.close());

            // Xóa peer
            room.peers.delete(socket.id);

            // Thông báo cho các peers khác
            socket.to(room.id).emit('peer-left', {
                peerId: socket.id,
            });

            // Xóa room nếu không còn ai
            if (room.peers.size === 0) {
                room.router.close();
                rooms.delete(room.id);
                console.log(`Room ${room.id} closed`);
            }
        }
    });
});

// Khởi động server
(async () => {
    try {
        await createWorkers();

        server.listen(config.port, () => {
            console.log(`Server running on http://localhost:${config.port}`);
            console.log(`MediaSoup SFU ready with ${workers.length} workers`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
})();