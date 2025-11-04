import {VideoProcessor} from './videoProcessor.js';
import * as mediasoupClient from "mediasoup-client";
import {io} from "socket.io-client";

// SFU Client với MediaSoup
export class SFUClient {
    constructor() {
        this.socket = null;
        this.device = null;
        this.roomId = null;
        this.username = null;

        // Transports
        this.sendTransport = null;
        this.recvTransport = null;

        // Producers & Consumers
        this.videoProducer = null;
        this.audioProducer = null;
        this.consumers = new Map();

        // Local stream
        this.localStream = null;
        this.videoProcessor = new VideoProcessor();

        // State
        this.isVideoEnabled = true;
        this.isAudioEnabled = true;

        // Callbacks
        this.onPeerJoined = null;
        this.onPeerLeft = null;
        this.onConsumerCreated = null;

        this.producerPeerMap = new Map(); // map producerId -> peerId
        this.peerUsernameMap = new Map();
    }

    /**
     * Kết nối tới server
     * @param {string} serverUrl - URL của server
     */
    connect(serverUrl = 'http://localhost:3000') {
        return new Promise((resolve, reject) => {
            if (this.socket && this.socket.connected) {
                console.warn('⚠️ Socket đã kết nối, bỏ qua connect()');
                resolve();
                return;
            }

            console.log('Connecting to server:', serverUrl);

            this.socket = io(serverUrl, {
                transports: ['websocket']
            });

            // Gắn listener một lần duy nhất
            if (!this._listenersSetup) {
                this.setupSocketListeners();
                this._listenersSetup = true;
            }

            this.socket.on('connect', () => {
                console.log('Connected to server');
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                reject(error);
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from server');
            });
            //
            // // Lắng nghe events
            // this.setupSocketListeners();
        });
    }

    /**
     * Setup các socket event listeners
     */
    // setupSocketListeners() {
    //     // Peer mới join
    //     this.socket.on('peer-joined', ({ peerId }) => {
    //         console.log('Peer joined:', peerId);
    //         if (this.onPeerJoined) {
    //             this.onPeerJoined(peerId);
    //         }
    //     });
    //
    //     // Peer rời phòng
    //     this.socket.on('peer-left', ({ peerId }) => {
    //         console.log('Peer left:', peerId);
    //
    //         // Remove consumer
    //         const consumer = this.consumers.get(peerId);
    //         if (consumer) {
    //             consumer.close();
    //             this.consumers.delete(peerId);
    //         }
    //
    //         if (this.onPeerLeft) {
    //             this.onPeerLeft(peerId);
    //         }
    //     });
    //
    //     // Producer mới từ peer khác
    //     this.socket.on('new-producer', async ({ peerId, producerId, kind }) => {
    //         console.log('New producer:', { peerId, producerId, kind });
    //
    //         // Consume producer này
    //         await this.consume(producerId, kind);
    //     });
    //
    //     // Consumer bị đóng
    //     this.socket.on('consumer-closed', ({ consumerId }) => {
    //         console.log('Consumer closed:', consumerId);
    //
    //         for (const [peerId, consumer] of this.consumers) {
    //             if (consumer.id === consumerId) {
    //                 consumer.close();
    //                 this.consumers.delete(peerId);
    //                 break;
    //             }
    //         }
    //     });
    // }

    setupSocketListeners() {
        if (!this.socket) return;

        // DEBUG: show current listeners count
        try {
            console.log('[SFUClient] listeners before setup:', {
                newProducer: this.socket.listeners('new-producer')?.length ?? 0,
                peerJoined: this.socket.listeners('peer-joined')?.length ?? 0,
                peerLeft: this.socket.listeners('peer-left')?.length ?? 0,
                consumerClosed: this.socket.listeners('consumer-closed')?.length ?? 0,
            });
        } catch (e) {
            console.warn('Cannot read listeners:', e);
        }

        // Remove previous listeners to avoid duplicates
        this.socket.off('peer-joined');
        this.socket.off('peer-left');
        this.socket.off('new-producer');
        this.socket.off('consumer-closed');

        // Peer mới join
        this.socket.on('peer-joined', ({peerId, username}) => {
            console.log('[EVENT peer-joined] peerId=%s myId=%s', peerId, this.socket.id);
            if (peerId === this.socket.id) {
                // ignore event about ourselves (just in case)
                return;
            }

            if (username) {
                this.peerUsernameMap.set(peerId, username);
            }

            if (this.onPeerJoined) {
                this.onPeerJoined(peerId);
            }
        });

        // Peer rời phòng
        this.socket.on('peer-left', ({peerId}) => {
            console.log('[EVENT peer-left] peerId=%s', peerId);

            // Remove consumer keyed by producerId if any
            // (we store consumers by producerId)
            for (const [prodId, consumer] of this.consumers) {
                if (consumer.appData && consumer.appData.peerId === peerId) {
                    consumer.close();
                    this.consumers.delete(prodId);
                    break;
                }
            }

            if (this.onPeerLeft) {
                this.onPeerLeft(peerId);
            }
        });

        // Producer mới từ peer khác
        this.socket.on('new-producer', async ({peerId, producerId, kind}) => {
            console.log('[EVENT new-producer] peerId=%s producerId=%s kind=%s myId=%s',
                peerId, producerId, kind, this.socket.id);

            this.producerPeerMap.set(producerId, peerId);

            // Ignore if the event is about ourselves (shouldn't happen if server uses socket.to)
            if (peerId === this.socket.id) {
                console.log('[new-producer] ignoring self producer', producerId);
                return;
            }

            // Guard: nếu đã consume producerId rồi thì bỏ qua
            if (this.consumers.has(producerId)) {
                console.warn('[new-producer] already consuming', producerId);
                return;
            }

            try {
                await this.consume(producerId, kind);
            } catch (err) {
                console.error('Error while consuming new-producer:', err);
            }
        });

        // Consumer bị đóng
        this.socket.on('consumer-closed', ({consumerId}) => {
            console.log('[EVENT consumer-closed] consumerId=%s', consumerId);

            for (const [prodId, consumer] of this.consumers) {
                if (consumer.id === consumerId) {
                    consumer.close();
                    this.consumers.delete(prodId);
                    break;
                }
            }
        });

        // DEBUG: show listeners after setup
        try {
            console.log('[SFUClient] listeners after setup:', {
                newProducer: this.socket.listeners('new-producer')?.length ?? 0,
                peerJoined: this.socket.listeners('peer-joined')?.length ?? 0,
            });
        } catch (e) {
        }
    }


    /**
     * Join phòng
     * @param {string} roomId - ID của phòng
     * @param {string} username - Tên người dùng
     */
    async joinRoom(roomId, username) {
        this.roomId = roomId;
        this.username = username;

        return new Promise((resolve, reject) => {
            this.socket.emit('join-room', {roomId, username}, async (response) => {
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }

                console.log('Joined room successfully');

                try {
                    // Load MediaSoup Device
                    await this.loadDevice(response.rtpCapabilities);

                    // Tạo transports
                    await this.createTransports();

                    // Start local media
                    await this.startLocalMedia();

                    // Get existing producers và consume
                    await this.getExistingProducers();

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Load MediaSoup Device
     * @param {Object} rtpCapabilities - RTP capabilities từ server
     */
    async loadDevice(rtpCapabilities) {
        console.log('Loading device...');

        this.device = new mediasoupClient.Device();
        await this.device.load({routerRtpCapabilities: rtpCapabilities});

        console.log('Device loaded:', this.device.loaded);
    }

    /**
     * Tạo send và receive transports
     */
    async createTransports() {
        console.log('Creating transports...');

        // Tạo send transport
        this.sendTransport = await this.createTransport('send');

        // Tạo receive transport
        this.recvTransport = await this.createTransport('recv');
    }

    /**
     * Tạo một transport
     * @param {string} direction - 'send' hoặc 'recv'
     */
    async createTransport(direction) {
        return new Promise((resolve, reject) => {
            this.socket.emit('create-transport',
                {roomId: this.roomId, direction},
                async (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                        return;
                    }

                    console.log(`${direction} transport created`);

                    let transport;
                    if (direction === 'send') {
                        transport = this.device.createSendTransport(response);
                    } else {
                        transport = this.device.createRecvTransport(response);
                    }

                    // Connect event
                    transport.on('connect', async ({dtlsParameters}, callback, errback) => {
                        try {
                            await this.connectTransport(transport.id, dtlsParameters);
                            callback();
                        } catch (error) {
                            errback(error);
                        }
                    });

                    // Produce event (chỉ cho send transport)
                    if (direction === 'send') {
                        transport.on('produce', async ({kind, rtpParameters}, callback, errback) => {
                            try {
                                const {producerId} = await this.produce(transport.id, kind, rtpParameters);
                                callback({id: producerId});
                            } catch (error) {
                                errback(error);
                            }
                        });
                    }

                    // Connection state change
                    transport.on('connectionstatechange', (state) => {
                        console.log(`${direction} transport state:`, state);
                    });

                    resolve(transport);
                }
            );
        });
    }

    /**
     * Connect transport
     */
    async connectTransport(transportId, dtlsParameters) {
        return new Promise((resolve, reject) => {
            this.socket.emit('connect-transport',
                {transportId, dtlsParameters},
                (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    /**
     * Produce (gửi media)
     */
    async produce(transportId, kind, rtpParameters) {
        return new Promise((resolve, reject) => {
            this.socket.emit('produce',
                {transportId, kind, rtpParameters},
                (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response);
                    }
                }
            );
        });
    }

    /**
     * Start local media (camera + mic)
     */
    async startLocalMedia() {
        console.log('Starting local media...');

        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: {ideal: 1280},
                    height: {ideal: 720},
                    frameRate: {ideal: 30}
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Lấy tracks
            const videoTrack = this.localStream.getVideoTracks()[0];
            const audioTrack = this.localStream.getAudioTracks()[0];

            // Xử lý video với WebCodecs
            console.log('Starting video processor...');
            const processedVideoTrack = await this.videoProcessor.start(videoTrack);

            // Produce video
            this.videoProducer = await this.sendTransport.produce({
                track: processedVideoTrack,
                encodings: [
                    {maxBitrate: 100000},
                    {maxBitrate: 300000},
                    {maxBitrate: 900000}
                ],
                codecOptions: {
                    videoGoogleStartBitrate: 1000
                }
            });

            console.log('Video producer created:', this.videoProducer.id);

            // Produce audio
            this.audioProducer = await this.sendTransport.produce({
                track: audioTrack
            });

            console.log('Audio producer created:', this.audioProducer.id);

            // Display local video
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = new MediaStream([processedVideoTrack, audioTrack]);

        } catch (error) {
            console.error('Error starting local media:', error);
            throw error;
        }
    }

    /**
     * Consume (nhận media từ peer khác)
     */
    // async consume(producerId, kind) {
    //     console.log('Consuming:', { producerId, kind });
    //
    //     return new Promise((resolve, reject) => {
    //         this.socket.emit('consume',
    //             {
    //                 rtpCapabilities: this.device.rtpCapabilities,
    //                 producerId
    //             },
    //             async (response) => {
    //                 if (response.error) {
    //                     reject(new Error(response.error));
    //                     return;
    //                 }
    //
    //                 const consumer = await this.recvTransport.consume({
    //                     id: response.id,
    //                     producerId: response.producerId,
    //                     kind: response.kind,
    //                     rtpParameters: response.rtpParameters
    //                 });
    //
    //                 // Store consumer
    //                 this.consumers.set(producerId, consumer);
    //
    //                 // Resume consumer
    //                 this.socket.emit('resume-consumer',
    //                     { consumerId: consumer.id },
    //                     (res) => {
    //                         if (res.error) {
    //                             console.error('Error resuming consumer:', res.error);
    //                         }
    //                     }
    //                 );
    //
    //                 // Callback
    //                 if (this.onConsumerCreated) {
    //                     this.onConsumerCreated(consumer, producerId);
    //                 }
    //
    //                 resolve(consumer);
    //             }
    //         );
    //     });
    // }

    async consume(producerId, kind) {
        console.log('Consuming:', {producerId, kind});

        // Nếu đã consume producer này rồi => trả về consumer hiện có
        if (this.consumers.has(producerId)) {
            console.warn('[consume] already consuming', producerId);
            return this.consumers.get(producerId);
        }

        return new Promise((resolve, reject) => {
            this.socket.emit('consume',
                {
                    rtpCapabilities: this.device.rtpCapabilities,
                    producerId
                },
                async (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                        return;
                    }

                    try {
                        const consumer = await this.recvTransport.consume({
                            id: response.id,
                            producerId: response.producerId,
                            kind: response.kind,
                            rtpParameters: response.rtpParameters
                        });

                        const peerId = this.producerPeerMap.get(producerId) || response.peerId || 'unknown';
                        consumer.appData = {producerId, peerId};
                        this.consumers.set(producerId, consumer);

                        // // store consumer keyed by producerId
                        // consumer.appData = { producerId, peerId: response.peerId ?? null }; // optional
                        // this.consumers.set(producerId, consumer);

                        // Resume consumer
                        this.socket.emit('resume-consumer',
                            {consumerId: consumer.id},
                            (res) => {
                                if (res.error) {
                                    console.error('Error resuming consumer:', res.error);
                                }
                            }
                        );

                        // Callback to UI
                        if (this.onConsumerCreated) {
                            this.onConsumerCreated(consumer, producerId);
                        }

                        resolve(consumer);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
    }


    /**
     * Get existing producers từ peers khác
     */
    // async getExistingProducers() {
    //     return new Promise((resolve) => {
    //         this.socket.emit('get-producers',
    //             { roomId: this.roomId },
    //             async ({ producers }) => {
    //                 console.log('Existing producers:', producers);
    //
    //                 for (const producer of producers) {
    //                     await this.consume(producer.producerId, producer.kind);
    //                 }
    //
    //                 resolve();
    //             }
    //         );
    //     });
    // }

    async getExistingProducers() {
        return new Promise((resolve) => {
            this.socket.emit('get-producers',
                {roomId: this.roomId},
                async ({producers}) => {
                    console.log('[getExistingProducers] producers:', producers);

                    for (const producer of producers) {
                        // lưu mapping producerId -> peerId trước khi consume
                        if (producer.producerId && producer.peerId) {
                            this.producerPeerMap.set(producer.producerId, producer.peerId);
                            console.log('[producerPeerMap] set', producer.producerId, '=>', producer.peerId);
                        } else {
                            console.warn('[getExistingProducers] missing peerId in producer:', producer);
                        }

                        await this.consume(producer.producerId, producer.kind);
                    }

                    resolve();
                }
            );
        });
    }


    /**
     * Toggle video on/off
     */
    async toggleVideo() {
        if (this.videoProducer) {
            if (this.isVideoEnabled) {
                this.videoProducer.pause();
            } else {
                this.videoProducer.resume();
            }
            this.isVideoEnabled = !this.isVideoEnabled;
        }
        return this.isVideoEnabled;
    }

    /**
     * Toggle audio on/off
     */
    async toggleAudio() {
        if (this.audioProducer) {
            if (this.isAudioEnabled) {
                this.audioProducer.pause();
            } else {
                this.audioProducer.resume();
            }
            this.isAudioEnabled = !this.isAudioEnabled;
        }
        return this.isAudioEnabled;
    }

    /**
     * Thay đổi filter
     */
    setFilter(filterName) {
        this.videoProcessor.setFilter(filterName);
    }

    /**
     * Leave room
     */
    async leaveRoom() {
        console.log('Leaving room...');

        // Stop video processor
        await this.videoProcessor.stop();

        // Close producers
        if (this.videoProducer) {
            this.videoProducer.close();
        }
        if (this.audioProducer) {
            this.audioProducer.close();
        }

        // Close consumers
        this.consumers.forEach(consumer => consumer.close());
        this.consumers.clear();

        // Close transports
        if (this.sendTransport) {
            this.sendTransport.close();
        }
        if (this.recvTransport) {
            this.recvTransport.close();
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }

        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
        }

        console.log('Left room successfully');
    }

    getPeerIdByProducerId(producerId) {
        return this.producerPeerMap.get(producerId) || null;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SFUClient;
}